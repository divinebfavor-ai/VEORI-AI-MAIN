// ─── Deal monitoring: continuous Deal Death Prevention ──────────────────────
// Every under-contract deal is re-checked on an interval with deterministic rules
// (no model calls). Alerts are opened once per (deal, alert_key) - the partial
// unique index makes that hold across servers - refreshed while the condition
// persists, and resolved automatically when it clears. A newly opened critical or
// high alert also becomes an in-app notification.

const supabaseDefault = require('../../config/supabase');
const audit = require('../audit');
const dealGraph = require('../dealGraph');
const { deathPreventionAlerts, POST_CONTRACT } = require('../agents/autonomous');

const AGENT_ID = 'deal_death_prevention';
const INTERVAL_MINUTES = Number(process.env.DEAL_MONITOR_INTERVAL_MINUTES) || 30;
const NOTIFY = new Set(['critical', 'high']);

/**
 * Reconcile a deal's open alerts with what the rules see right now.
 * @returns {{ opened: object[], refreshed: number, resolved: number, alerts: object[] }}
 */
async function reconcileAlerts({ userId, dealId, alerts, db = supabaseDefault, address = null }) {
  const now = new Date().toISOString();
  const { data: open, error } = await db.from('deal_alerts').select('id, alert_key, severity')
    .eq('user_id', userId).eq('deal_id', dealId).eq('agent_id', AGENT_ID).eq('status', 'open');
  if (error) throw error;
  const openByKey = new Map((open || []).map(a => [a.alert_key, a]));
  const opened = [];
  let refreshed = 0;

  for (const a of alerts) {
    const existing = openByKey.get(a.key);
    if (existing) {
      await db.from('deal_alerts').update({ severity: a.severity, message: a.message, recommended_action: a.recommended_action, last_seen_at: now })
        .eq('id', existing.id).eq('user_id', userId);
      refreshed++;
      openByKey.delete(a.key);
      continue;
    }
    const { data: row, error: insErr } = await db.from('deal_alerts').insert({
      user_id: userId, deal_id: dealId, agent_id: AGENT_ID, alert_key: a.key, severity: a.severity,
      message: a.message, recommended_action: a.recommended_action, status: 'open', last_seen_at: now,
    }).select('*').single();
    if (insErr) {
      if (insErr.code === '23505') { refreshed++; continue; } // another server opened it first
      throw insErr;
    }
    opened.push(row);
  }

  // Whatever is still open but no longer detected has cleared.
  const clearedIds = [...openByKey.values()].map(a => a.id);
  if (clearedIds.length) {
    const { error: resErr } = await db.from('deal_alerts').update({ status: 'resolved', resolved_at: now })
      .in('id', clearedIds).eq('user_id', userId).eq('status', 'open');
    if (resErr) throw resErr;
  }

  const notify = opened.filter(a => NOTIFY.has(a.severity));
  if (notify.length) {
    const { error: nErr } = await db.from('notifications').insert(notify.map(a => ({
      operator_id: userId, type: 'deal_alert', deal_id: dealId, link: `/deals/${dealId}/room`, is_read: false,
      title: `${a.severity === 'critical' ? 'Critical' : 'High'} risk${address ? `: ${address}` : ''}`.slice(0, 200),
      message: `${a.message} ${a.recommended_action || ''}`.trim().slice(0, 1000),
    })));
    if (nErr) console.error('[DealMonitor] notification insert failed:', nErr.message);
  }

  if (opened.length || clearedIds.length) {
    await audit.record({ userId, dealId, agentId: AGENT_ID, actionType: 'monitor.alerts_changed',
      inputs: { checked: alerts.length }, outputs: { opened: opened.map(a => a.alert_key), resolved: clearedIds.length, notified: notify.length } });
  }
  return { opened, refreshed, resolved: clearedIds.length, alerts };
}

/** Check one deal now. */
async function checkDeal({ userId, dealId, db = supabaseDefault, now = Date.now() }) {
  const rep = await dealGraph.build(userId, dealId, { refreshProviders: false, recordAudit: false });
  if (!rep) return null;
  const res = deathPreventionAlerts(rep, now);
  const out = await reconcileAlerts({ userId, dealId, alerts: res.applicable ? res.alerts : [], db, address: rep.property.address.value });
  await db.from('deals').update({ last_monitored_at: new Date(now).toISOString() }).eq('id', dealId).eq('user_id', userId);
  return { ...out, applicable: res.applicable, days_to_close: res.days_to_close ?? null };
}

/**
 * One sweep across tenants: claim due post-contract deals (conditional update so
 * two servers never check the same deal in the same interval), check each, and
 * close out alerts on deals that are no longer under contract.
 */
async function sweep({ limit = Number(process.env.DEAL_MONITOR_BATCH) || 200, db = supabaseDefault } = {}) {
  const cutoff = new Date(Date.now() - INTERVAL_MINUTES * 60000).toISOString();
  const { data: due, error } = await db.from('deals').select('id, user_id, last_monitored_at')
    .in('status', POST_CONTRACT)
    .or(`last_monitored_at.is.null,last_monitored_at.lt.${cutoff}`)
    .order('last_monitored_at', { ascending: true, nullsFirst: true }).limit(limit);
  if (error) throw error;

  const stats = { due: (due || []).length, checked: 0, opened: 0, resolved: 0, failed: 0, closed_out: 0 };
  for (const d of due || []) {
    const claimAt = new Date().toISOString();
    let claim = db.from('deals').update({ last_monitored_at: claimAt }).eq('id', d.id);
    claim = d.last_monitored_at ? claim.eq('last_monitored_at', d.last_monitored_at) : claim.is('last_monitored_at', null);
    const { data: claimed } = await claim.select('id');
    if (!claimed?.length) continue; // another server took it
    try {
      const r = await checkDeal({ userId: d.user_id, dealId: d.id, db });
      stats.checked++;
      if (r) { stats.opened += r.opened.length; stats.resolved += r.resolved; }
    } catch (err) {
      stats.failed++;
      console.error(`[DealMonitor] deal ${d.id} failed:`, err.message);
    }
  }

  // Deals that left the contract stages (closed, lost, moved back) keep no open monitor alerts.
  const { data: openAlerts } = await db.from('deal_alerts').select('id, deal_id').eq('agent_id', AGENT_ID).eq('status', 'open').limit(1000);
  const dealIds = [...new Set((openAlerts || []).map(a => a.deal_id))];
  if (dealIds.length) {
    const { data: deals } = await db.from('deals').select('id, status').in('id', dealIds);
    const active = new Set((deals || []).filter(x => POST_CONTRACT.includes(x.status)).map(x => x.id));
    const stale = (openAlerts || []).filter(a => !active.has(a.deal_id)).map(a => a.id);
    if (stale.length) {
      await db.from('deal_alerts').update({ status: 'resolved', resolved_at: new Date().toISOString() }).in('id', stale).eq('status', 'open');
      stats.closed_out = stale.length;
    }
  }
  return stats;
}

async function listAlerts(userId, { dealId = null, status = 'open', limit = 100, db = supabaseDefault } = {}) {
  let q = db.from('deal_alerts').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(Math.min(Math.max(1, limit), 500));
  if (dealId) q = q.eq('deal_id', dealId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  const rank = { critical: 0, high: 1, medium: 2, low: 3 };
  return (data || []).sort((a, b) => rank[a.severity] - rank[b.severity]);
}

async function closeAlert({ userId, alertId, actorUserId, status, db = supabaseDefault }) {
  if (!['resolved', 'dismissed'].includes(status)) throw Object.assign(new Error('status must be resolved or dismissed'), { status: 400 });
  const { data, error } = await db.from('deal_alerts').update({ status, resolved_at: new Date().toISOString(), resolved_by: actorUserId })
    .eq('id', alertId).eq('user_id', userId).eq('status', 'open').select('*');
  if (error) throw error;
  if (!data?.length) throw Object.assign(new Error('Alert not found or already closed'), { status: 404 });
  await audit.record({ userId, dealId: data[0].deal_id, actorUserId, agentId: AGENT_ID, actionType: `monitor.alert_${status}`, inputs: { alert_id: alertId }, outputs: { alert_key: data[0].alert_key }, humanApproved: true });
  return data[0];
}

module.exports = { reconcileAlerts, checkDeal, sweep, listAlerts, closeAlert, INTERVAL_MINUTES };
