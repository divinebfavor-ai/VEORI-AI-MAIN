// ─── Immutable audit trail ──────────────────────────────────────────────────
// Every agent action and every human decision writes one append-only row to
// audit_events (the table refuses updates and deletes). record() never throws -
// it returns { ok, error } so callers that must not proceed without an audit row
// can check it.

const supabase = require('../config/supabase');

const MAX_JSON_CHARS = 60000;
function bounded(obj) {
  if (obj === undefined || obj === null) return {};
  let text;
  try { text = JSON.stringify(obj); } catch { return { unserializable: true }; }
  if (text.length <= MAX_JSON_CHARS) return obj;
  return { truncated: true, size: text.length, preview: text.slice(0, MAX_JSON_CHARS) };
}

async function record({ userId, dealId = null, runId = null, agentId = null, actorUserId = null, actionType, inputs, outputs, confidence = null, sources = [], humanApproved = null, approvalId = null }) {
  if (!userId || !actionType) return { ok: false, error: 'userId and actionType are required' };
  try {
    const { error } = await supabase.from('audit_events').insert({
      user_id: userId, deal_id: dealId, run_id: runId, agent_id: agentId, actor_user_id: actorUserId,
      action_type: actionType, inputs: bounded(inputs), outputs: bounded(outputs),
      confidence: confidence == null ? null : Math.max(0, Math.min(100, Math.round(confidence))),
      sources: Array.isArray(sources) ? sources.slice(0, 100) : [],
      human_approved: humanApproved, approval_id: approvalId,
    });
    if (error) { console.error('[Audit] write failed:', error.message); return { ok: false, error: error.message }; }
    return { ok: true };
  } catch (err) {
    console.error('[Audit] write error:', err.message);
    return { ok: false, error: err.message };
  }
}

async function list(userId, { dealId = null, limit = 100 } = {}) {
  let q = supabase.from('audit_events')
    .select('id, deal_id, run_id, agent_id, actor_user_id, action_type, inputs, outputs, confidence, sources, human_approved, approval_id, created_at')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(Math.min(Math.max(1, limit), 500));
  if (dealId) q = q.eq('deal_id', dealId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

module.exports = { record, list };
