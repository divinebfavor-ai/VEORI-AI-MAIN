// ─────────────────────────────────────────────────────────────────────────────
// analyticsRollup — nightly per-operator daily rollup into operator_daily_stats.
//
// Run by the RUN_CRON-gated "analytics-rollup" repeatable job (~00:15) once per day.
// It aggregates the PREVIOUS calendar day's volume per operator and UPSERTs one row
// per (user_id, stat_date). Reporting endpoints then sum these historical rows and
// only live-count "today" — so a 30/90-day window stays O(days), not O(messages).
//
// Idempotent: re-running a date overwrites that date's row. Additive — reads the
// raw event tables (sms_messages, calls, buyer_campaigns, deals) exactly as the live
// endpoints do, using only verified columns; writes only to operator_daily_stats.
// ─────────────────────────────────────────────────────────────────────────────

const supabase = require('../config/supabase');

// Build [startISO, endISO) for a given YYYY-MM-DD in UTC.
function dayBounds(dateStr) {
  const start = new Date(`${dateStr}T00:00:00.000Z`);
  const end   = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

function yesterdayStr() {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return d.toISOString().split('T')[0];
}

// Roll up a single calendar day (default: yesterday) for every operator that had
// activity. Returns the number of operator rows written.
async function rollupDay(dateStr = yesterdayStr()) {
  if (!supabase) {
    console.warn('[Rollup] supabase unavailable — skipping');
    return 0;
  }
  const { startISO, endISO } = dayBounds(dateStr);

  // Pull the day's raw events once each, then fold per-operator in memory. Volumes
  // for a single day are bounded, so this is a thin scan compared to a live N-day sum.
  const [smsRes, callsRes, campaignsRes, dealsRes] = await Promise.all([
    supabase.from('sms_messages').select('user_id, direction, sent_at, created_at')
      .gte('created_at', startISO).lt('created_at', endISO),
    supabase.from('calls').select('user_id, duration_seconds, outcome, created_at')
      .gte('created_at', startISO).lt('created_at', endISO),
    supabase.from('buyer_campaigns').select('user_id, buyers_called, created_at')
      .gte('created_at', startISO).lt('created_at', endISO),
    supabase.from('deals').select('user_id, status, assignment_fee, created_at')
      .gte('created_at', startISO).lt('created_at', endISO),
  ]);

  for (const r of [smsRes, callsRes, campaignsRes, dealsRes]) {
    if (r.error) throw r.error;
  }

  const acc = new Map(); // user_id → stats row
  const row = (uid) => {
    if (!acc.has(uid)) {
      acc.set(uid, {
        user_id: uid, stat_date: dateStr,
        sms_sent: 0, sms_replies: 0,
        calls_made: 0, call_minutes: 0, appointments: 0, offers_made: 0,
        buyers_blasted: 0, deals_closed: 0, assignment_revenue: 0,
      });
    }
    return acc.get(uid);
  };

  (smsRes.data || []).forEach((m) => {
    if (!m.user_id) return;
    const s = row(m.user_id);
    if (m.direction === 'outbound') s.sms_sent += 1;
    else if (m.direction === 'inbound') s.sms_replies += 1;
  });

  (callsRes.data || []).forEach((c) => {
    if (!c.user_id) return;
    const s = row(c.user_id);
    s.calls_made   += 1;
    s.call_minutes += Math.round((c.duration_seconds || 0) / 60);
    if (c.outcome === 'appointment') s.appointments += 1;
    if (c.outcome === 'offer_made')  s.offers_made  += 1;
  });

  (campaignsRes.data || []).forEach((c) => {
    if (!c.user_id) return;
    row(c.user_id).buyers_blasted += (c.buyers_called || 0);
  });

  (dealsRes.data || []).forEach((d) => {
    if (!d.user_id) return;
    if (d.status === 'closed') {
      const s = row(d.user_id);
      s.deals_closed += 1;
      s.assignment_revenue += (d.assignment_fee || 0);
    }
  });

  const rows = Array.from(acc.values()).map((r) => ({ ...r, updated_at: new Date().toISOString() }));
  if (!rows.length) {
    console.log(`[Rollup] ${dateStr}: no operator activity`);
    return 0;
  }

  const { error } = await supabase
    .from('operator_daily_stats')
    .upsert(rows, { onConflict: 'user_id,stat_date' });
  if (error) throw error;

  console.log(`[Rollup] ${dateStr}: wrote ${rows.length} operator row(s)`);
  return rows.length;
}

// Convenience wrapper used by the cron job.
async function rollupYesterday() {
  return rollupDay(yesterdayStr());
}

module.exports = { rollupDay, rollupYesterday, dayBounds, yesterdayStr };
