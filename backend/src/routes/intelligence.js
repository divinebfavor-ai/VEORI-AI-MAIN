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
const monitor = require('../intelligence/engines/monitor');
const autopilot = require('../intelligence/engines/autopilot');
const { AGENTS } = require('../intelligence/agents');

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
  'rate_pct', 'down_payment_pct', 'amortization_months', 'balloon_month',
  'holding_months', 'monthly_holding', 'sell_cost_pct', 'buy_closing_pct', 'loan_amount', 'loan_rate_pct', 'loan_points_pct',
  'monthly_taxes', 'monthly_insurance', 'vacancy_pct', 'management_pct', 'maintenance_pct', 'capex_pct', 'hold_years', 'exit_value',
  'refi_ltv_pct', 'refi_rate_pct', 'refi_closing_costs', 'monthly_operating_expenses', 'adr', 'str_occupancy_pct', 'str_expense_pct',
  'section8_payment_standard', 'rooms', 'rent_per_room', 'mtr_monthly_rent', 'emd', 'transactional_funding_fee_pct', 'ab_closing_costs',
  'bc_closing_costs', 'option_fee', 'monthly_rent_credit', 'option_months', 'retail_value', 'listing_cost_pct', 'min_dscr', 'max_ltv_pct']);
function cleanInputs(raw) {
  if (raw == null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw Object.assign(new Error('inputs must be an object'), { status: 400 });
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'lender_terms' || k === 'lead_source_spend') {
      if (v && typeof v === 'object' && !Array.isArray(v) && JSON.stringify(v).length <= 5000) out[k] = v;
      else if (v != null) throw Object.assign(new Error(`${k} must be a small object`), { status: 400 });
      continue;
    }
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

// ── Phase 3 engines ─────────────────────────────────────────────────────────
const scenarios = require('../intelligence/engines/scenarios');
const optimizer = require('../intelligence/engines/optimizer');
const scorecard = require('../intelligence/engines/scorecard');
const timeline = require('../intelligence/engines/timeline');

async function loadUnderstanding(req, res) {
  const dealId = dealIdOr404(req, res); if (!dealId) return null;
  const row = await dealGraph.get(req.user.id, dealId);
  if (!row) { res.status(404).json({ success: false, error: 'Deal not found' }); return null; }
  const rep = row.understanding || await dealGraph.build(req.user.id, dealId, { refreshProviders: false, actorUserId: req.user.actorId });
  return { dealId, rep };
}
const v = (rep, p) => { const c = dealGraph.getPath(rep, p); return c && c.value != null && typeof c.value === 'number' ? c.value : undefined; };
const numericObject = (o, name) => {
  if (o == null) return {};
  if (typeof o !== 'object' || Array.isArray(o)) throw Object.assign(new Error(`${name} must be an object`), { status: 400 });
  if (JSON.stringify(o).length > 20000) throw Object.assign(new Error(`${name} is too large`), { status: 413 });
  return o;
};
// Deal figures used when the request doesn't supply them; reported back so the source is visible.
function seedFrom(rep, strategy) {
  const price = v(rep, 'transaction.contract_price') ?? v(rep, 'transaction.asking_price') ?? v(rep, 'transaction.offer_price');
  if (strategy === 'fix_flip') return { purchase_price: price, sale_price: v(rep, 'financial.arv'), rehab: v(rep, 'financial.repairs') };
  if (strategy === 'wholesale') return { arv: v(rep, 'financial.arv'), repairs: v(rep, 'financial.repairs'), contract_price: v(rep, 'transaction.contract_price') };
  if (strategy === 'buy_hold') return { purchase_price: price, monthly_rent: v(rep, 'financial.market_rent'), property_value: v(rep, 'financial.as_is_value') };
  return {};
}
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined && x !== null && x !== ''));

router.post('/deals/:id/scenarios', wrap(async (req, res) => {
  const ctx = await loadUnderstanding(req, res); if (!ctx) return;
  const strategy = req.body?.strategy;
  const seeded = clean(seedFrom(ctx.rep, strategy));
  const base = { ...seeded, ...clean(numericObject(req.body?.base, 'base')) };
  const result = scenarios.run({ strategy, base, scenarios: numericObject(req.body?.scenarios, 'scenarios') });
  result.inputs_from_deal = Object.keys(seeded).filter(k => req.body?.base?.[k] == null);
  await audit.record({ userId: req.user.id, dealId: ctx.dealId, actorUserId: req.user.actorId, agentId: 'scenario_engine', actionType: 'engine.scenarios', inputs: { strategy, base }, outputs: { summary: result.summary } });
  res.json({ success: true, data: result });
}));

router.post('/deals/:id/optimize', wrap(async (req, res) => {
  const ctx = await loadUnderstanding(req, res); if (!ctx) return;
  const rep = ctx.rep;
  const dealSeed = clean({ arv: v(rep, 'financial.arv'), repairs: v(rep, 'financial.repairs'), as_is_value: v(rep, 'financial.as_is_value'), monthly_rent: v(rep, 'financial.market_rent'), existing_loan_balance: v(rep, 'property.financing.loan_balance'), existing_monthly_payment: v(rep, 'property.financing.monthly_payment') });
  const input = {
    objective: req.body?.objective,
    deal: { ...dealSeed, ...clean(numericObject(req.body?.deal, 'deal')) },
    seller: numericObject(req.body?.seller, 'seller'), operator: numericObject(req.body?.operator, 'operator'),
    terms: numericObject(req.body?.terms, 'terms'), costs: numericObject(req.body?.costs, 'costs'),
  };
  const result = optimizer.optimize(input);
  result.deal_inputs_from_record = Object.keys(dealSeed).filter(k => req.body?.deal?.[k] == null);
  await audit.record({ userId: req.user.id, dealId: ctx.dealId, actorUserId: req.user.actorId, agentId: 'deal_optimizer', actionType: 'engine.optimize', inputs: input, outputs: { objective: result.objective, best: result.best ? { structure: result.best.structure, price: result.best.price } : null, feasible: result.all_feasible_count } });
  res.json({ success: true, data: result });
}));

router.get('/deals/:id/scorecard', wrap(async (req, res) => {
  const ctx = await loadUnderstanding(req, res); if (!ctx) return;
  const { data: outs, error } = await supabase.from('agent_outputs').select('agent_id, data, created_at').eq('user_id', req.user.id).eq('deal_id', ctx.dealId).order('created_at', { ascending: false }).limit(200);
  if (error) throw error;
  const latest = {};
  for (const o of outs || []) if (!latest[o.agent_id]) latest[o.agent_id] = o.data;
  res.json({ success: true, data: scorecard.build({ understanding: ctx.rep, outputs: latest }) });
}));

router.post('/deals/:id/timeline', wrap(async (req, res) => {
  const ctx = await loadUnderstanding(req, res); if (!ctx) return;
  const b = req.body || {};
  const result = timeline.simulate({
    strategy: b.strategy, start_date: b.start_date || null,
    durations: numericObject(b.durations, 'durations'), delays: numericObject(b.delays, 'delays'),
    monthly_carrying_cost: b.monthly_carrying_cost,
  });
  res.json({ success: true, data: result });
}));

// ── Verified knowledge (Real Estate Law Intelligence) ───────────────────────
const PLATFORM_ADMINS = (process.env.ADMIN_EMAILS || 'divineqflash@gmail.com').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

router.get('/knowledge', wrap(async (req, res) => {
  let q = supabase.from('knowledge_items').select('id, topic, jurisdiction, content, source, source_url, effective_date, last_verified_at, review_by, confidence, user_id, created_at')
    .or(`user_id.is.null,user_id.eq.${req.user.id}`).order('created_at', { ascending: false }).limit(500);
  if (req.query.jurisdiction && /^(US|[A-Z]{2})$/.test(String(req.query.jurisdiction))) q = q.eq('jurisdiction', req.query.jurisdiction);
  const { data, error } = await q;
  if (error) throw error;
  res.json({ success: true, data: (data || []).map(k => ({ ...k, scope: k.user_id ? 'workspace' : 'platform', user_id: undefined })) });
}));

router.post('/knowledge', wrap(async (req, res) => {
  const b = req.body || {};
  const scope = b.scope === 'platform' ? 'platform' : 'workspace';
  if (scope === 'platform' && !PLATFORM_ADMINS.includes(String(req.user.actorEmail || '').toLowerCase())) return res.status(403).json({ success: false, error: 'Only platform administrators can add platform-wide knowledge' });
  if (scope === 'workspace' && !canDecide(req)) return res.status(403).json({ success: false, error: 'Only the owner or a team admin can add workspace knowledge' });
  const errors = [];
  const topic = typeof b.topic === 'string' ? b.topic.trim() : '';
  if (!topic || topic.length > 120) errors.push('topic is required (max 120 characters)');
  if (!/^(US|[A-Z]{2})$/.test(String(b.jurisdiction || ''))) errors.push('jurisdiction must be US or a 2-letter state code');
  const summary = typeof b.summary === 'string' ? b.summary.trim() : '';
  if (!summary || summary.length > 4000) errors.push('summary is required (max 4000 characters)');
  if (typeof b.source !== 'string' || !b.source.trim() || b.source.length > 300) errors.push('source is required (e.g. statute section or regulator guidance)');
  let url = null;
  try { url = new URL(String(b.source_url)); if (url.protocol !== 'https:') throw new Error(); } catch { errors.push('source_url must be an https link to the source'); }
  if (!DATE_RE.test(String(b.effective_date || ''))) errors.push('effective_date must be YYYY-MM-DD');
  if (!DATE_RE.test(String(b.review_by || ''))) errors.push('review_by must be YYYY-MM-DD (when this must be re-verified)');
  const confidence = Number(b.confidence);
  if (!Number.isInteger(confidence) || confidence < 0 || confidence > 100) errors.push('confidence must be a whole number 0-100');
  if (errors.length) return res.status(400).json({ success: false, error: errors.join('; ') });
  const { data, error } = await supabase.from('knowledge_items').insert({
    user_id: scope === 'platform' ? null : req.user.id, topic, jurisdiction: b.jurisdiction, content: { summary },
    source: b.source.trim(), source_url: url.toString(), effective_date: b.effective_date, review_by: b.review_by,
    last_verified_at: new Date().toISOString(), confidence,
  }).select('*').single();
  if (error) throw error;
  await audit.record({ userId: req.user.id, actorUserId: req.user.actorId, agentId: 'real_estate_law', actionType: 'knowledge.added', inputs: { scope, topic, jurisdiction: b.jurisdiction, source: b.source }, humanApproved: true });
  res.status(201).json({ success: true, data });
}));

router.get('/worksheets', (_req, res) => res.json({ success: true, data: dealGraph.WORKSHEETS }));

router.put('/deals/:id/worksheets/:name', wrap(async (req, res) => {
  const dealId = dealIdOr404(req, res); if (!dealId) return;
  const data = req.body?.data === undefined ? undefined : req.body.data;
  if (data === undefined) return res.status(400).json({ success: false, error: 'data is required (null clears the worksheet)' });
  const saved = await dealGraph.setWorksheet(req.user.id, dealId, req.user.actorId, req.params.name, data);
  if (!saved.found) return res.status(404).json({ success: false, error: 'Deal not found' });
  res.json({ success: true, data: saved.worksheet });
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

// ── Monitoring, Autopilot, Opportunities ────────────────────────────────────
router.get('/alerts', wrap(async (req, res) => {
  const status = req.query.status === 'all' ? null : (req.query.status || 'open');
  if (status && !['open', 'resolved', 'dismissed'].includes(status)) return res.status(400).json({ success: false, error: 'Invalid status' });
  res.json({ success: true, data: await monitor.listAlerts(req.user.id, { status, limit: parseInt(req.query.limit, 10) || 100 }) });
}));

router.get('/deals/:id/alerts', wrap(async (req, res) => {
  const dealId = dealIdOr404(req, res); if (!dealId) return;
  const status = req.query.status === 'all' ? null : (req.query.status || 'open');
  if (status && !['open', 'resolved', 'dismissed'].includes(status)) return res.status(400).json({ success: false, error: 'Invalid status' });
  res.json({ success: true, data: await monitor.listAlerts(req.user.id, { dealId, status }) });
}));

// Re-check a deal now instead of waiting for the sweep.
router.post('/deals/:id/monitor', wrap(async (req, res) => {
  const dealId = dealIdOr404(req, res); if (!dealId) return;
  const r = await monitor.checkDeal({ userId: req.user.id, dealId });
  if (!r) return res.status(404).json({ success: false, error: 'Deal not found' });
  res.json({ success: true, data: { applicable: r.applicable, days_to_close: r.days_to_close, opened: r.opened.length, resolved: r.resolved, alerts: await monitor.listAlerts(req.user.id, { dealId }) } });
}));

router.post('/alerts/:alertId/:action(resolve|dismiss)', wrap(async (req, res) => {
  if (!UUID_RE.test(req.params.alertId)) return res.status(404).json({ success: false, error: 'Alert not found' });
  const status = req.params.action === 'resolve' ? 'resolved' : 'dismissed';
  res.json({ success: true, data: await monitor.closeAlert({ userId: req.user.id, alertId: req.params.alertId, actorUserId: req.user.actorId, status }) });
}));

router.post('/deals/:id/autopilot/run', wrap(async (req, res) => {
  const dealId = dealIdOr404(req, res); if (!dealId) return;
  if (!canDecide(req)) return res.status(403).json({ success: false, error: 'Only the owner or a team admin can run Autopilot' });
  res.json({ success: true, data: await autopilot.run({ userId: req.user.id, actorUserId: req.user.actorId, dealId, triggeredBy: 'operator' }) });
}));

router.get('/deals/:id/autopilot/runs', wrap(async (req, res) => {
  const dealId = dealIdOr404(req, res); if (!dealId) return;
  res.json({ success: true, data: await autopilot.listRuns(req.user.id, dealId, { limit: parseInt(req.query.limit, 10) || 20 }) });
}));

router.get('/opportunities', wrap(async (req, res) => {
  const out = await AGENTS.opportunity_discovery.run({ userId: req.user.id, actorUserId: req.user.actorId, command: 'Opportunity discovery' });
  if (out.status === 'error') return res.status(500).json({ success: false, error: out.summary });
  res.json({ success: true, data: out });
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
