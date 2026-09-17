// ─── Veori intelligence API ─────────────────────────────────────────────────
// Deal Room data, "Ask Veori" (streamed), approvals, autopilot settings, agent
// registry, data connectors, audit trail and the deterministic calculation engine.
// Every query is scoped to req.user.id (the workspace); decisions and settings
// changes are limited to the owner or a team admin.

const express = require('express');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const registry = require('../intelligence/registry');
const connectors = require('../intelligence/connectors');
const perms = require('../intelligence/permissions');
const audit = require('../intelligence/audit');
const dealGraph = require('../intelligence/dealGraph');
const superAgent = require('../intelligence/superAgent');
const core = require('../intelligence/calc/core');
const strategies = require('../intelligence/calc/strategies');
const breakEven = require('../intelligence/calc/breakEven');

const router = express.Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const canDecide = (req) => ['owner', 'admin', 'self'].includes(req.user.teamRole);

function wrap(handler) {
  return async (req, res, next) => {
    try { await handler(req, res); }
    catch (e) {
      if (e instanceof core.CalcError) return res.status(400).json({ success: false, error: e.message, field: e.field });
      if (e.status && e.status < 500) return res.status(e.status).json({ success: false, error: e.message });
      next(e);
    }
  };
}

function dealIdOr404(req, res) {
  if (!UUID_RE.test(req.params.id)) { res.status(404).json({ success: false, error: 'Deal not found' }); return null; }
  return req.params.id;
}

// Numeric overrides a request may pass to agents. Anything else is rejected.
const INPUT_KEYS = new Set(['arv', 'repairs', 'asking_price', 'contract_price', 'buyer_price', 'purchase_price', 'flip_factor_pct', 'assignment_fee', 'target_fee',
  'closing_holding_buffer', 'loan_balance', 'monthly_payment', 'market_value', 'interest_rate', 'arrears', 'monthly_rent', 'annual_noi', 'cap_rate_pct',
  'rate_pct', 'down_payment_pct', 'amortization_months', 'balloon_month']);
function cleanInputs(raw) {
  if (raw == null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw Object.assign(new Error('inputs must be an object'), { status: 400 });
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'lender_terms') { if (v && typeof v === 'object') out.lender_terms = v; continue; }
    if (!INPUT_KEYS.has(k)) throw Object.assign(new Error(`Unknown input "${k}"`), { status: 400 });
    if (v === null || v === '') continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw Object.assign(new Error(`${k} must be a positive number`), { status: 400 });
    out[k] = n;
  }
  return out;
}

// ── Registry, connectors, settings ──────────────────────────────────────────
router.get('/registry', wrap(async (_req, res) => {
  res.json({ success: true, data: registry.list() });
}));

router.get('/connectors', wrap(async (_req, res) => {
  res.json({ success: true, data: connectors.status() });
}));

router.get('/settings', wrap(async (req, res) => {
  res.json({ success: true, data: await perms.getSettings(req.user.id) });
}));

router.patch('/settings', wrap(async (req, res) => {
  if (!canDecide(req)) return res.status(403).json({ success: false, error: 'Only the owner or a team admin can change autonomy settings' });
  res.json({ success: true, data: await perms.updateSettings(req.user.id, req.user.actorId, req.body || {}) });
}));

// ── Approvals ───────────────────────────────────────────────────────────────
router.get('/approvals', wrap(async (req, res) => {
  const status = req.query.status === 'all' ? null : (req.query.status || 'pending');
  if (status && !['pending', 'approved', 'rejected', 'expired', 'executed', 'failed'].includes(status)) return res.status(400).json({ success: false, error: 'Invalid status' });
  const dealId = req.query.deal_id && UUID_RE.test(req.query.deal_id) ? req.query.deal_id : null;
  res.json({ success: true, data: await perms.listApprovals(req.user.id, { status, dealId }) });
}));

router.post('/approvals/:approvalId/decide', wrap(async (req, res) => {
  if (!canDecide(req)) return res.status(403).json({ success: false, error: 'Only the owner or a team admin can approve agent actions' });
  if (!UUID_RE.test(req.params.approvalId)) return res.status(404).json({ success: false, error: 'Approval request not found' });
  const { decision, note } = req.body || {};
  res.json({ success: true, data: await perms.decide({ userId: req.user.id, approvalId: req.params.approvalId, actorUserId: req.user.actorId, decision, note }) });
}));

// Operator asks for approval of a recommended action from the Deal Room.
router.post('/deals/:id/approvals', wrap(async (req, res) => {
  const dealId = dealIdOr404(req, res); if (!dealId) return;
  const { agent_id, action_type, payload, reason } = req.body || {};
  const decl = registry.get(agent_id);
  if (!decl) return res.status(400).json({ success: false, error: 'Unknown agent' });
  if (!perms.ACTIONS[action_type]) return res.status(400).json({ success: false, error: 'Unknown action type' });
  const decision = perms.authorize({ agent: decl, actionType: action_type, settings: await perms.getSettings(req.user.id) });
  if (!decision.allowed) return res.status(403).json({ success: false, error: decision.reason });
  const { data: deal } = await supabase.from('deals').select('id').eq('id', dealId).eq('user_id', req.user.id).maybeSingle();
  if (!deal) return res.status(404).json({ success: false, error: 'Deal not found' });
  const text = typeof reason === 'string' && reason.trim() ? reason.trim() : perms.ACTIONS[action_type].label;
  const row = await perms.requestApproval({ userId: req.user.id, dealId, agentId: agent_id, actionType: action_type, payload: payload && typeof payload === 'object' ? payload : {}, reason: text });
  res.status(201).json({ success: true, data: row });
}));

// ── Deal Room ───────────────────────────────────────────────────────────────
router.get('/deals/:id/room', wrap(async (req, res) => {
  const dealId = dealIdOr404(req, res); if (!dealId) return;
  const { data: deal, error } = await supabase.from('deals')
    .select('id, property_address, property_city, property_state, property_zip, status, deal_type, lead_id, understanding, understanding_updated_at, updated_at')
    .eq('id', dealId).eq('user_id', req.user.id).maybeSingle();
  if (error) throw error;
  if (!deal) return res.status(404).json({ success: false, error: 'Deal not found' });
  let understanding = deal.understanding;
  if (!understanding || !deal.understanding_updated_at) {
    understanding = await dealGraph.build(req.user.id, dealId, { refreshProviders: true, actorUserId: req.user.actorId });
  }
  const [runsRes, bnaRes, outputsRes, approvals, auditRows, settings] = await Promise.all([
    supabase.from('agent_runs').select('id, command, intent, status, synthesis, started_at, completed_at').eq('user_id', req.user.id).eq('deal_id', dealId).order('started_at', { ascending: false }).limit(10),
    supabase.from('best_next_actions').select('*').eq('user_id', req.user.id).eq('deal_id', dealId).eq('status', 'current').order('calculated_at', { ascending: false }).limit(1),
    supabase.from('agent_outputs').select('id, agent_id, agent_version, output_type, data, confidence, confidence_reasoning, created_at').eq('user_id', req.user.id).eq('deal_id', dealId).order('created_at', { ascending: false }).limit(200),
    perms.listApprovals(req.user.id, { status: null, dealId, limit: 50 }),
    audit.list(req.user.id, { dealId, limit: 50 }),
    perms.getSettings(req.user.id),
  ]);
  // Latest output per agent.
  const latest = {};
  for (const o of outputsRes.data || []) if (!latest[o.agent_id]) latest[o.agent_id] = o;
  const { understanding: _omit, ...dealFields } = deal;
  res.json({
    success: true,
    data: {
      deal: dealFields, understanding, settings,
      best_next_action: bnaRes.data?.[0] || null,
      runs: (runsRes.data || []).map(r => ({ id: r.id, command: r.command, intent: r.intent, status: r.status, started_at: r.started_at, completed_at: r.completed_at, answer: r.synthesis?.answer || null, confidence: r.synthesis?.confidence || null })),
      latest_synthesis: (runsRes.data || []).find(r => r.synthesis)?.synthesis || null,
      agent_outputs: latest, approvals, audit: auditRows,
      agents: registry.list(),
    },
  });
}));

router.post('/deals/:id/understanding/refresh', wrap(async (req, res) => {
  const dealId = dealIdOr404(req, res); if (!dealId) return;
  const rep = await dealGraph.build(req.user.id, dealId, { refreshProviders: true, actorUserId: req.user.actorId });
  if (!rep) return res.status(404).json({ success: false, error: 'Deal not found' });
  res.json({ success: true, data: rep });
}));

router.patch('/deals/:id/understanding', wrap(async (req, res) => {
  const dealId = dealIdOr404(req, res); if (!dealId) return;
  const patch = req.body?.overrides;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return res.status(400).json({ success: false, error: 'overrides must be an object of field -> value' });
  if (Object.keys(patch).length > 40) return res.status(400).json({ success: false, error: 'Too many fields in one update' });
  const rep = await dealGraph.setOverrides(req.user.id, dealId, req.user.actorId, patch);
  if (!rep) return res.status(404).json({ success: false, error: 'Deal not found' });
  res.json({ success: true, data: rep });
}));

// POST /deals/:id/ask - streamed with Accept: text/event-stream, otherwise JSON.
router.post('/deals/:id/ask', wrap(async (req, res) => {
  const dealId = dealIdOr404(req, res); if (!dealId) return;
  const command = typeof req.body?.command === 'string' ? req.body.command.trim() : '';
  if (!command) return res.status(400).json({ success: false, error: 'command is required' });
  if (command.length > 1000) return res.status(400).json({ success: false, error: 'command must be 1000 characters or fewer' });
  const inputs = cleanInputs(req.body?.inputs);
  const refresh = req.body?.refresh === true;
  const { data: deal } = await supabase.from('deals').select('id').eq('id', dealId).eq('user_id', req.user.id).maybeSingle();
  if (!deal) return res.status(404).json({ success: false, error: 'Deal not found' });

  const wantsStream = String(req.headers.accept || '').includes('text/event-stream');
  if (!wantsStream) {
    const synthesis = await superAgent.run({ userId: req.user.id, actorUserId: req.user.actorId, dealId, command, inputs, refresh });
    return res.json({ success: true, data: synthesis });
  }
  res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders?.();
  let closed = false;
  req.on('close', () => { closed = true; });
  const send = (event) => { if (!closed) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`); };
  const heartbeat = setInterval(() => { if (!closed) res.write(': keep-alive\n\n'); }, 15000);
  try {
    await superAgent.run({ userId: req.user.id, actorUserId: req.user.actorId, dealId, command, inputs, refresh, onEvent: send });
  } catch (err) {
    console.error('[Intelligence] ask failed:', err.message);
    send({ type: 'error', error: err.status && err.status < 500 ? err.message : 'Analysis failed. Please try again.' });
  } finally {
    clearInterval(heartbeat);
    if (!closed) res.end();
  }
}));

router.get('/deals/:id/runs/:runId', wrap(async (req, res) => {
  const dealId = dealIdOr404(req, res); if (!dealId) return;
  if (!UUID_RE.test(req.params.runId)) return res.status(404).json({ success: false, error: 'Run not found' });
  const { data, error } = await supabase.from('agent_runs').select('*').eq('id', req.params.runId).eq('deal_id', dealId).eq('user_id', req.user.id).maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ success: false, error: 'Run not found' });
  res.json({ success: true, data });
}));

router.get('/audit', wrap(async (req, res) => {
  const dealId = req.query.deal_id && UUID_RE.test(req.query.deal_id) ? req.query.deal_id : null;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
  res.json({ success: true, data: await audit.list(req.user.id, { dealId, limit }) });
}));

// ── Calculation engine (What-If) ────────────────────────────────────────────
const CALCS = {
  monthly_payment: core.monthlyPayment, amortization_schedule: core.amortizationSchedule, remaining_balance: core.remainingBalance,
  noi: core.noi, cap_rate: core.capRate, value_from_cap_rate: core.valueFromCapRate, dscr: core.dscr, ltv: core.ltv, ltc: core.ltc,
  cash_on_cash: core.cashOnCash, roi: core.roi, npv: core.npv, irr: core.irr,
  wholesale_mao: strategies.wholesaleMao, assignment_fee: strategies.assignmentFee, double_close: strategies.doubleClose,
  holding_costs: strategies.holdingCosts, closing_costs: strategies.closingCosts, fix_flip: strategies.fixFlip, buy_hold: strategies.buyHold,
  brrrr: strategies.brrrr, seller_finance: strategies.sellerFinance, subject_to: strategies.subjectTo, lease_option: strategies.leaseOption,
  hard_money: strategies.hardMoney, dscr_max_loan: strategies.dscrLoan, equity_waterfall: strategies.equityWaterfall,
  fix_flip_break_even: (i) => breakEven.fixFlipBreakEven(i, { target_profit: i.target_profit }),
  buy_hold_break_even: (i) => breakEven.buyHoldBreakEven(i, { target_monthly_cash_flow: i.target_monthly_cash_flow }),
  wholesale_break_even: breakEven.wholesaleBreakEven,
};

router.get('/calc', (_req, res) => res.json({ success: true, data: Object.keys(CALCS) }));

router.post('/calc/:name', wrap(async (req, res) => {
  const fn = Object.prototype.hasOwnProperty.call(CALCS, req.params.name) ? CALCS[req.params.name] : null;
  if (!fn) return res.status(404).json({ success: false, error: 'Unknown calculation' });
  const inputs = req.body?.inputs;
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) return res.status(400).json({ success: false, error: 'inputs must be an object' });
  if (JSON.stringify(inputs).length > 20000) return res.status(413).json({ success: false, error: 'inputs too large' });
  res.json({ success: true, data: fn(inputs) });
}));

module.exports = router;
