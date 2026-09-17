// ─── Permissions, approval gates and Copilot/Autopilot settings ─────────────
// Two independent checks decide whether an agent may act:
//   1. Agent permission level (from its registry declaration) must cover the action.
//   2. The action class: some actions ALWAYS need a human (offers, signing, money,
//      legal filings, material term changes); contact actions (SMS, calls) and
//      drafting run automatically only when the workspace turned that on.
// Contact actions that are allowed still go through the Compliance spine
// (agents/complianceGate) at send time - permission never bypasses compliance.

const supabase = require('../config/supabase');
const audit = require('./audit');
const { PERMISSION_LEVELS } = require('./registry');

const LEVEL = Object.fromEntries(PERMISSION_LEVELS.map((l, i) => [l, i]));

const ACTIONS = Object.freeze({
  // Always require explicit human approval.
  submit_offer:           { level: 'HIGH_RISK', approval: 'always', label: 'Submit an offer' },
  sign_contract:          { level: 'HIGH_RISK', approval: 'always', label: 'Sign a contract' },
  move_money:             { level: 'HIGH_RISK', approval: 'always', label: 'Move money' },
  legal_filing:           { level: 'HIGH_RISK', approval: 'always', label: 'File a legal document' },
  change_material_terms:  { level: 'HIGH_RISK', approval: 'always', label: 'Change material transaction terms' },
  // Configurable per workspace.
  send_sms:               { level: 'EXECUTE', approval: 'setting', setting: 'auto_send_sms', label: 'Send an SMS' },
  place_call:             { level: 'EXECUTE', approval: 'setting', setting: 'auto_place_calls', label: 'Place a phone call' },
  draft_message:          { level: 'DRAFT', approval: 'setting', setting: 'auto_draft', label: 'Draft a message' },
  // Analysis never needs approval.
  analyze:                { level: 'READ', approval: 'never', label: 'Analyze' },
  recommend:              { level: 'RECOMMEND', approval: 'never', label: 'Recommend' },
});

const DEFAULT_SETTINGS = Object.freeze({ mode: 'copilot', auto_send_sms: false, auto_place_calls: false, auto_draft: true });

async function getSettings(userId) {
  const { data, error } = await supabase.from('agent_settings')
    .select('mode, auto_send_sms, auto_place_calls, auto_draft, updated_at').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data ? { ...DEFAULT_SETTINGS, ...data } : { ...DEFAULT_SETTINGS, updated_at: null };
}

async function updateSettings(userId, actorUserId, patch = {}) {
  const row = {};
  if (patch.mode !== undefined) {
    if (!['copilot', 'autopilot'].includes(patch.mode)) throw Object.assign(new Error('mode must be copilot or autopilot'), { status: 400 });
    row.mode = patch.mode;
  }
  for (const k of ['auto_send_sms', 'auto_place_calls', 'auto_draft']) {
    if (patch[k] !== undefined) {
      if (typeof patch[k] !== 'boolean') throw Object.assign(new Error(`${k} must be true or false`), { status: 400 });
      row[k] = patch[k];
    }
  }
  if (!Object.keys(row).length) throw Object.assign(new Error('Nothing to update'), { status: 400 });
  const before = await getSettings(userId);
  const { data, error } = await supabase.from('agent_settings')
    .upsert({ user_id: userId, ...before, ...row, updated_by: actorUserId, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    .select('mode, auto_send_sms, auto_place_calls, auto_draft, updated_at').single();
  if (error) throw error;
  await audit.record({ userId, actorUserId, actionType: 'settings.agent_autonomy_changed', inputs: { before, patch: row }, outputs: data, humanApproved: true });
  return data;
}

// Pure decision: may this agent take this action right now, and does it need a human?
function authorize({ agent, actionType, settings }) {
  const action = ACTIONS[actionType];
  if (!action) return { allowed: false, requiresApproval: true, reason: `Unknown action type "${actionType}"` };
  if (!agent) return { allowed: false, requiresApproval: true, reason: 'Unknown agent' };
  if (LEVEL[agent.permissions] < LEVEL[action.level]) {
    return { allowed: false, requiresApproval: true, reason: `${agent.name} has ${agent.permissions} permission; "${action.label}" needs ${action.level}` };
  }
  if (action.approval === 'always') {
    return { allowed: true, requiresApproval: true, reason: `"${action.label}" always requires human approval` };
  }
  if (action.approval === 'setting') {
    const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
    if (s.mode !== 'autopilot' && action.level !== 'DRAFT') {
      return { allowed: true, requiresApproval: true, reason: `Copilot mode: "${action.label}" waits for the operator` };
    }
    return s[action.setting]
      ? { allowed: true, requiresApproval: false, reason: `Workspace allows "${action.label}" automatically` }
      : { allowed: true, requiresApproval: true, reason: `Automatic "${action.label}" is turned off for this workspace` };
  }
  return { allowed: true, requiresApproval: false, reason: 'Analysis only' };
}

// ── Approval requests ───────────────────────────────────────────────────────
const APPROVAL_TTL_HOURS = 72;

async function requestApproval({ userId, dealId = null, runId = null, agentId, actionType, payload, reason }) {
  if (!ACTIONS[actionType]) throw Object.assign(new Error(`Unknown action type ${actionType}`), { status: 400 });
  const { data, error } = await supabase.from('agent_approvals').insert({
    user_id: userId, deal_id: dealId, run_id: runId, agent_id: agentId, action_type: actionType,
    payload: payload || {}, reason: String(reason || ACTIONS[actionType].label).slice(0, 1000),
    expires_at: new Date(Date.now() + APPROVAL_TTL_HOURS * 3600000).toISOString(),
  }).select('*').single();
  if (error) throw error;
  await audit.record({ userId, dealId, runId, agentId, actionType: `approval.requested.${actionType}`, inputs: payload, outputs: { approval_id: data.id }, humanApproved: false, approvalId: data.id });
  return data;
}

async function listApprovals(userId, { status = 'pending', dealId = null, limit = 50 } = {}) {
  // Expire stale requests before listing so nothing old can be approved.
  await supabase.from('agent_approvals').update({ status: 'expired' })
    .eq('user_id', userId).eq('status', 'pending').lt('expires_at', new Date().toISOString());
  let q = supabase.from('agent_approvals').select('*').eq('user_id', userId)
    .order('requested_at', { ascending: false }).limit(Math.min(Math.max(1, limit), 200));
  if (status) q = q.eq('status', status);
  if (dealId) q = q.eq('deal_id', dealId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function decide({ userId, approvalId, actorUserId, decision, note = null }) {
  if (!['approved', 'rejected'].includes(decision)) throw Object.assign(new Error('decision must be approved or rejected'), { status: 400 });
  const now = new Date().toISOString();
  // Conditional update: only a pending, unexpired request of this workspace can be decided, once.
  const { data, error } = await supabase.from('agent_approvals')
    .update({ status: decision, decided_at: now, decided_by: actorUserId, decision_note: note ? String(note).slice(0, 1000) : null })
    .eq('id', approvalId).eq('user_id', userId).eq('status', 'pending').gt('expires_at', now)
    .select('*');
  if (error) throw error;
  if (!data?.length) throw Object.assign(new Error('Approval request not found, already decided, or expired'), { status: 409 });
  const row = data[0];
  await audit.record({ userId, dealId: row.deal_id, runId: row.run_id, agentId: row.agent_id, actorUserId, actionType: `approval.${decision}.${row.action_type}`, inputs: { approval_id: approvalId, note }, outputs: { status: decision }, humanApproved: decision === 'approved', approvalId });
  return row;
}

module.exports = { ACTIONS, DEFAULT_SETTINGS, getSettings, updateSettings, authorize, requestApproval, listApprovals, decide };
