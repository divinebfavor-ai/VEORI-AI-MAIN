// ─── Veori Super-Agent ──────────────────────────────────────────────────────
// UNDERSTAND → VERIFY → ANALYZE → EXPLORE → SIMULATE → OPTIMIZE → EXECUTE → MONITOR
//
// Takes a natural-language command about a deal, decides which agents to run,
// runs independent agents concurrently (dependents wait for their inputs), then:
//   - surfaces disagreements between agents instead of hiding them
//   - merges what is missing, with why it matters and how to get it
//   - runs the Challenger against every recommendation
//   - marks actions that need human approval (and, in Autopilot, requests it)
//   - computes the Best Next Action
// Every stage is streamed through onEvent and every run is audited.

const supabase = require('../config/supabase');
const registry = require('./registry');
const audit = require('./audit');
const perms = require('./permissions');
const dealGraph = require('./dealGraph');
const bna = require('./engines/bestNextAction');
const llm = require('./llm');
const { cleanText, detectInjection } = require('./sanitize');
const { AGENTS } = require('./agents');

const INTENTS = {
  full_analysis: { label: 'Complete acquisition analysis', agents: ['lead_intelligence', 'motivated_seller', 'valuation', 'arv', 'wholesale', 'creative_finance', 'subject_to', 'seller_finance', 'financing', 'title_intelligence', 'transaction_coordinator', 'disposition', 'buyer_matching', 'risk', 'challenger'] },
  wholesale_check: { label: 'Can this be wholesaled?', agents: ['valuation', 'arv', 'wholesale', 'title_intelligence', 'disposition', 'buyer_matching', 'risk', 'challenger'] },
  creative_finance: { label: 'Creative finance options', agents: ['creative_finance', 'subject_to', 'seller_finance', 'financing', 'title_intelligence', 'risk', 'challenger'] },
  biggest_risk: { label: 'Biggest risks', agents: ['valuation', 'arv', 'wholesale', 'title_intelligence', 'transaction_coordinator', 'financing', 'buyer_matching', 'risk', 'challenger'] },
  exit_strategies: { label: 'Exit strategies', agents: ['valuation', 'arv', 'wholesale', 'creative_finance', 'subject_to', 'seller_finance', 'financing', 'disposition', 'buyer_matching', 'challenger'] },
  deal_not_working: { label: 'Why the deal is not working', agents: ['valuation', 'arv', 'wholesale', 'title_intelligence', 'transaction_coordinator', 'buyer_matching', 'risk', 'challenger'] },
  missing_information: { label: 'Missing information', agents: ['lead_intelligence', 'valuation', 'arv', 'wholesale', 'subject_to', 'title_intelligence'] },
  what_if_price: { label: 'What if the price changes', agents: ['wholesale', 'creative_finance', 'subject_to', 'seller_finance', 'challenger'] },
  find_buyers: { label: 'Find buyers', agents: ['arv', 'wholesale', 'disposition', 'buyer_matching'] },
  seller_motivation: { label: 'Seller motivation', agents: ['lead_intelligence', 'motivated_seller'] },
  valuation: { label: 'Valuation', agents: ['valuation', 'arv', 'challenger'] },
  financing: { label: 'Financing options', agents: ['financing', 'creative_finance', 'subject_to', 'seller_finance'] },
  title: { label: 'Title and closing', agents: ['title_intelligence', 'transaction_coordinator', 'due_diligence'] },
  fix_flip: { label: 'Fix and flip analysis', agents: ['comparable_sales', 'arv', 'rehab_estimation', 'fix_flip', 'hard_money', 'risk', 'challenger'] },
  rental: { label: 'Rental analysis', agents: ['buy_hold', 'rental_property', 'brrrr', 'dscr', 'risk', 'challenger'] },
  lease_option_novation: { label: 'Lease option and novation', agents: ['lease_option', 'novation', 'real_estate_law', 'challenger'] },
  double_close_assignment: { label: 'Assignment vs double close', agents: ['wholesale', 'arv', 'contract_assignment', 'double_close', 'real_estate_law', 'challenger'] },
  land: { label: 'Land analysis', agents: ['land_acquisition', 'land_development', 'due_diligence', 'real_estate_law', 'risk', 'challenger'] },
  income_property: { label: 'Income property analysis', agents: ['multifamily', 'commercial', 'self_storage', 'dscr', 'underwriting', 'risk', 'challenger'] },
  negotiation: { label: 'Negotiation strategy', agents: ['motivated_seller', 'arv', 'wholesale', 'negotiation_intelligence'] },
  lead_scoring: { label: 'Lead scoring and sourcing', agents: ['lead_scoring', 'lead_generation', 'motivated_seller'] },
  rehab: { label: 'Rehab and construction', agents: ['rehab_estimation', 'construction_management', 'risk'] },
  legal: { label: 'Legal and compliance intelligence', agents: ['real_estate_law', 'contract_assignment', 'due_diligence'] },
  underwriting: { label: 'Underwriting package', agents: ['comparable_sales', 'valuation', 'arv', 'wholesale', 'fix_flip', 'buy_hold', 'financing', 'title_intelligence', 'risk', 'underwriting', 'challenger'] },
  portfolio: { label: 'Portfolio overview', agents: ['portfolio', 'buyer_intelligence'] },
  due_diligence: { label: 'Due diligence', agents: ['due_diligence', 'title_intelligence', 'real_estate_law'] },
};

// Agent → agents whose output it reads (only enforced when both are in the plan).
const DEPENDS_ON = {
  wholesale: ['arv'],
  arv: ['comparable_sales'],
  fix_flip: ['arv', 'rehab_estimation'],
  hard_money: ['fix_flip'],
  negotiation_intelligence: ['wholesale'],
  contract_assignment: ['real_estate_law'],
  underwriting: ['wholesale', 'fix_flip', 'buy_hold', 'brrrr', 'subject_to', 'seller_finance', 'disposition', 'risk'],
  disposition: ['wholesale', 'arv'],
  buyer_matching: ['wholesale'],
  creative_finance: ['wholesale'],
  risk: ['*'],
  challenger: ['*'],
};

const RULES = [
  [/\b(portfolio|all (my|of my) deals|what needs attention)\b/i, 'portfolio'],
  [/\b(underwrit|sources and uses)/i, 'underwriting'],
  [/\b(due diligence|diligence|checklist)\b/i, 'due_diligence'],
  [/\b(legal|law|laws|regulation|licens|attorney|allowed to|legal to)\b/i, 'legal'],
  [/\b(double close|assignment vs|assign or double)\b/i, 'double_close_assignment'],
  [/\b(lease[ -]?option|rent to own|novation)\b/i, 'lease_option_novation'],
  [/\b(land|lot|acre|acreage|parcel|develop)/i, 'land'],
  [/\b(multifamily|apartment|units|commercial|retail|office|industrial|self[ -]?storage|cap rate|noi)\b/i, 'income_property'],
  [/\b(negotiat|counteroffer|counter offer|talking points|what do i say)/i, 'negotiation'],
  [/\b(lead scor|probabilit|likely to (respond|close)|lead source|where .*leads|more leads|lead gen)/i, 'lead_scoring'],
  [/\b(rehab|renovat|repairs? (budget|estimate|scope)|construction|contractor|change order)/i, 'rehab'],
  [/\b(flip|fix and flip|fix & flip|fix-and-flip)\b/i, 'fix_flip'],
  [/\b(rental|rent it|buy and hold|buy & hold|brrrr|cash flow|airbnb|short[ -]term|section 8|dscr)\b/i, 'rental'],
  [/\b(what (happens|if)|if the seller wants|seller wants|at a price of|counter(ed)? at)\b.*\d/i, 'what_if_price'],
  [/\b(not working|failing|stuck|dying|falling apart|why (is|isn't|is not).*(deal|working))\b/i, 'deal_not_working'],
  [/\b(missing|what (info|information|data)|unknowns?|what do we (not )?know)\b/i, 'missing_information'],
  [/\b(risks?|red flags?|what could go wrong|downside)\b/i, 'biggest_risk'],
  [/\b(exit|exits|exit strateg)/i, 'exit_strategies'],
  [/\b(creative|subject[ -]?to|sub2|seller financ|owner financ|lease[ -]?option|novation|wrap)\b/i, 'creative_finance'],
  [/\b(wholesale|wholesal|assign(ment)?|double close|flip the contract)\b/i, 'wholesale_check'],
  [/\b(buyers?|dispo|disposition)\b/i, 'find_buyers'],
  [/\b(title|liens?|closing|close date|deadlines?)\b/i, 'title'],
  [/\b(financ|loan|lender|dscr|hard money|mortgage)\b/i, 'financing'],
  [/\b(motivat|distress|pmi)\b/i, 'seller_motivation'],
  [/\b(value|valuation|arv|worth|comps?|comparables?)\b/i, 'valuation'],
  [/\b(analy[sz]e|strategy|everything|full|complete|overview|look at this)\b/i, 'full_analysis'],
];

function parseAmount(text) {
  const m = String(text).match(/\$\s*([\d,]+(?:\.\d+)?)\s*([km])?\b|\b([\d,]{2,}(?:\.\d+)?)\s*([km])\b|\b(\d{1,3}(?:,\d{3})+)\b/i);
  if (!m) return null;
  const raw = (m[1] || m[3] || m[5]).replace(/,/g, '');
  const unit = (m[2] || m[4] || '').toLowerCase();
  const n = Number(raw) * (unit === 'k' ? 1000 : unit === 'm' ? 1000000 : 1);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function classify(command) {
  for (const [re, intent] of RULES) if (re.test(command)) return { intent, method: 'rules' };
  const res = await llm.json({
    agentId: 'super_agent_router',
    rolePrompt: 'You route a real estate operator\'s request to exactly one analysis intent.',
    facts: { intents: Object.fromEntries(Object.entries(INTENTS).map(([k, v]) => [k, v.label])) },
    untrusted: { 'operator command': command },
    task: 'Pick the single best intent for the operator command.',
    schema: '{"intent":"one of the intent keys"}',
    maxTokens: 60,
  });
  if (res.ok && INTENTS[res.data.intent]) return { intent: res.data.intent, method: 'model' };
  return { intent: 'full_analysis', method: 'default' };
}

// Order agents into waves: each wave runs concurrently after its dependencies finish.
function planWaves(agentIds) {
  const inPlan = new Set(agentIds);
  const deps = (id) => {
    const d = DEPENDS_ON[id] || [];
    if (d.includes('*')) {
      // "After everything" skips agents that themselves wait on this one (e.g. underwriting reads risk),
      // and the Challenger always goes last.
      return agentIds.filter(a => a !== id && !(DEPENDS_ON[a] || []).includes(id) && !(id !== 'challenger' && a === 'challenger'));
    }
    return d.filter(x => inPlan.has(x));
  };
  const done = new Set();
  const waves = [];
  let remaining = [...agentIds];
  while (remaining.length) {
    const ready = remaining.filter(id => deps(id).every(d => done.has(d)));
    if (!ready.length) throw new Error(`Circular agent dependencies among: ${remaining.join(', ')}`);
    waves.push(ready);
    ready.forEach(id => done.add(id));
    remaining = remaining.filter(id => !ready.includes(id));
  }
  return waves;
}

function detectDisagreements(outputs, understanding) {
  const byKey = {};
  const add = (key, agent, value, basis) => {
    if (value == null || !Number.isFinite(Number(value))) return;
    (byKey[key] = byKey[key] || []).push({ agent, value: Number(value), basis });
  };
  for (const o of Object.values(outputs)) {
    for (const [k, v] of Object.entries(o.positions || {})) add(k, o.agent_id, v, o.summary);
  }
  const rec = understanding?.financial;
  if (rec?.arv?.value != null) add('value.arv', 'deal_record', rec.arv.value, `${rec.arv.status} (${rec.arv.source})`);
  if (rec?.mao_on_record?.value != null) add('offer.max_price', 'deal_record', rec.mao_on_record.value, `${rec.mao_on_record.status} (${rec.mao_on_record.source})`);
  const out = [];
  for (const [key, positions] of Object.entries(byKey)) {
    const distinctAgents = new Set(positions.map(p => p.agent));
    if (distinctAgents.size < 2) continue;
    const values = positions.map(p => p.value);
    const min = Math.min(...values), max = Math.max(...values);
    if (min <= 0) continue;
    const spread = ((max - min) / min) * 100;
    if (spread <= 10) continue;
    out.push({
      key, positions, spread_pct: Math.round(spread * 10) / 10, material: spread > 20 || max - min >= 10000,
      why_they_differ: 'Different sources or assumptions - compare the basis of each figure.',
      resolution: 'Check which figure rests on stronger evidence (sold comparables or a bid beat records or estimates) and correct the other.',
    });
  }
  return out;
}

function mergeMissing(understanding, outputs) {
  const map = new Map();
  for (const u of understanding?.unknowns || []) map.set(u.field, { item: u.field, why_it_matters: u.why_it_matters, how_to_get: u.how_to_get, raised_by: ['deal_understanding_engine'] });
  for (const o of Object.values(outputs)) {
    for (const m of o.missing || []) {
      const key = m.item;
      const e = map.get(key) || { ...m, raised_by: [] };
      e.raised_by = [...new Set([...(e.raised_by || []), o.agent_id])];
      map.set(key, e);
    }
  }
  // Items several agents need come first.
  return [...map.values()].sort((a, b) => b.raised_by.length - a.raised_by.length);
}

function overallConfidence(outputs, disagreements) {
  const scored = Object.values(outputs).filter(o => o.status !== 'error' && o.agent_id !== 'challenger');
  if (!scored.length) return { score: 0, reasoning: 'No agent completed.' };
  const sorted = scored.map(o => o.confidence.score).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const penalty = Math.min(30, disagreements.filter(d => d.material).length * 10);
  const errors = Object.values(outputs).filter(o => o.status === 'error').length;
  const insufficient = scored.filter(o => o.status === 'insufficient_data').length;
  return {
    score: Math.max(0, median - penalty - errors * 5),
    reasoning: `Median of ${scored.length} agent confidences is ${median}.${penalty ? ` −${penalty} for material disagreements.` : ''}${errors ? ` ${errors} agent(s) failed.` : ''}${insufficient ? ` ${insufficient} agent(s) lacked data.` : ''}`,
  };
}

async function persistBna(userId, dealId, runId, action) {
  await supabase.from('best_next_actions').update({ status: 'superseded' }).eq('user_id', userId).eq('deal_id', dealId).eq('status', 'current');
  const { data, error } = await supabase.from('best_next_actions').insert({
    user_id: userId, deal_id: dealId, run_id: runId, action: String(action.action).slice(0, 1000), why: String(action.why).slice(0, 2000),
    urgency: action.urgency, impact: String(action.impact).slice(0, 1000), dependencies: action.dependencies || [],
    assigned_to: action.assigned_to || 'operator', source_agent: action.source_agent || null,
  }).select('*').single();
  if (error) console.error('[SuperAgent] BNA persist failed:', error.message);
  return data || action;
}

/**
 * @param {object} p
 * @param {string} p.userId       workspace owner (tenant)
 * @param {string} [p.actorUserId]
 * @param {string} p.dealId
 * @param {string} p.command      natural-language request
 * @param {object} [p.inputs]     numeric overrides for this request (USER_PROVIDED)
 * @param {boolean} [p.refresh]   force provider refresh of the understanding
 * @param {function} [p.onEvent]  stream callback
 */
async function run({ userId, actorUserId = null, dealId, command, inputs = {}, refresh = false, onEvent = () => {}, tools = null, useModel = true }) {
  if (!userId) throw new Error('userId is required');
  const emit = (type, payload = {}) => { try { onEvent({ type, at: new Date().toISOString(), ...payload }); } catch { /* stream closed */ } };
  const cmd = cleanText(command || 'Analyze this deal', 1000);
  const injection = detectInjection(cmd);
  emit('stage', { stage: 'understand', message: 'Analyzing deal...' });

  const { intent, method } = await classify(cmd);
  const intentDef = INTENTS[intent];
  const requestInputs = { ...(inputs || {}) };
  if (intent === 'what_if_price' && requestInputs.asking_price == null) {
    const amt = parseAmount(cmd);
    if (amt) requestInputs.asking_price = amt;
  }

  const { data: runRow, error: runErr } = await supabase.from('agent_runs').insert({
    user_id: userId, deal_id: dealId, actor_user_id: actorUserId, command: cmd, intent,
    plan: { intent, method, agents: intentDef.agents, inputs: requestInputs, injection_flags: injection },
  }).select('id').single();
  if (runErr) throw runErr;
  const runId = runRow.id;
  emit('plan', { run_id: runId, intent, intent_label: intentDef.label, routed_by: method, agents: intentDef.agents, inputs: requestInputs, injection_flags: injection });

  // UNDERSTAND / VERIFY
  const existing = await dealGraph.get(userId, dealId);
  if (!existing) {
    await supabase.from('agent_runs').update({ status: 'failed', error: 'Deal not found', completed_at: new Date().toISOString() }).eq('id', runId).eq('user_id', userId);
    const e = new Error('Deal not found'); e.status = 404; throw e;
  }
  const stale = !existing.understanding_updated_at || Date.now() - new Date(existing.understanding_updated_at).getTime() > 24 * 3600000;
  const understanding = await dealGraph.build(userId, dealId, { refreshProviders: refresh || stale, actorUserId, runId });
  emit('understanding', {
    unknown_count: understanding.unknowns.length, conflicts: understanding.conflicts.length, data_gaps: understanding.data_gaps,
    headline: {
      address: understanding.property.address.value, stage: understanding.transaction.stage.value,
      arv: understanding.financial.arv, as_is_value: understanding.financial.as_is_value, repairs: understanding.financial.repairs,
      equity: understanding.financial.equity, contract_price: understanding.transaction.contract_price,
    },
  });

  // ANALYZE / EXPLORE - waves of concurrent agents
  const settings = await perms.getSettings(userId);
  const outputs = {};
  const waves = planWaves(intentDef.agents);
  let disagreements = [];
  for (const wave of waves) {
    emit('stage', { stage: wave.includes('challenger') ? 'challenge' : 'analyze', agents: wave });
    const isFinal = wave.includes('challenger');
    if (isFinal) disagreements = detectDisagreements(outputs, understanding);
    await Promise.all(wave.map(async (agentId) => {
      emit('agent_started', { agent: agentId, name: registry.get(agentId)?.name });
      const out = await AGENTS[agentId].run({
        userId, actorUserId, dealId, runId, command: cmd, understanding, inputs: requestInputs,
        priorOutputs: { ...outputs }, settings, tools, disagreements, useModel,
      });
      outputs[agentId] = out;
      emit('agent_completed', { agent: agentId, name: registry.get(agentId)?.name, status: out.status, summary: out.summary, confidence: out.confidence, positions: out.positions, output_id: out.output_id || null });
    }));
  }
  if (!intentDef.agents.includes('challenger')) disagreements = detectDisagreements(outputs, understanding);

  // SYNTHESIZE
  const missing = mergeMissing(understanding, outputs);
  const risks = outputs.risk ? outputs.risk.data.register : Object.values(outputs).flatMap(o => (o.risks || []).map(r => ({ ...r, identified_by: o.agent_id })));
  const recommendations = [];
  for (const o of Object.values(outputs)) {
    for (const r of o.recommendations || []) {
      const decl = registry.get(o.agent_id);
      const decision = r.action_type ? perms.authorize({ agent: decl, actionType: r.action_type, settings }) : { allowed: true, requiresApproval: false, reason: 'Advice only' };
      recommendations.push({ ...r, agent: o.agent_id, allowed: decision.allowed, requires_approval: decision.requiresApproval, permission_reason: decision.reason });
    }
  }

  // EXECUTE gate: in Autopilot, approval-required actions become pending approval requests (deduplicated).
  const createdApprovals = [];
  if (settings.mode === 'autopilot') {
    const { data: pendingNow } = await supabase.from('agent_approvals').select('action_type').eq('user_id', userId).eq('deal_id', dealId).eq('status', 'pending');
    const pendingTypes = new Set((pendingNow || []).map(p => p.action_type));
    for (const r of recommendations.filter(x => x.requires_approval && x.allowed && x.action_type && perms.ACTIONS[x.action_type]?.approval === 'always')) {
      if (pendingTypes.has(r.action_type)) continue;
      const a = await perms.requestApproval({ userId, dealId, runId, agentId: r.agent, actionType: r.action_type, payload: r.payload || { action: r.action }, reason: r.action });
      createdApprovals.push(a); pendingTypes.add(r.action_type);
    }
  }
  const { data: pending } = await supabase.from('agent_approvals').select('id, agent_id, action_type, reason, requested_at').eq('user_id', userId).eq('deal_id', dealId).eq('status', 'pending').gt('expires_at', new Date().toISOString()).order('requested_at', { ascending: true });

  const next = bna.compute({ understanding, outputs, pendingApprovals: pending || [] });
  const savedNext = await persistBna(userId, dealId, runId, next);
  const confidence = overallConfidence(outputs, disagreements);
  const challenges = outputs.challenger?.data?.challenges || [];

  const synthesis = {
    run_id: runId, intent, intent_label: intentDef.label, command: cmd,
    answer: buildAnswer({ intent, outputs, understanding, disagreements, missing, next, requestInputs }),
    best_next_action: savedNext,
    confidence, disagreements, challenges,
    risks: risks.slice(0, 50), missing: missing.slice(0, 50), recommendations,
    approvals_requested: createdApprovals.map(a => ({ id: a.id, action_type: a.action_type, reason: a.reason })),
    pending_approvals: pending || [],
    agents: Object.values(outputs).map(o => ({ agent: o.agent_id, name: registry.get(o.agent_id)?.name, status: o.status, summary: o.summary, confidence: o.confidence, attorney_review: o.attorney_review, output_id: o.output_id || null, duration_ms: o.duration_ms })),
    data_gaps: understanding.data_gaps, mode: settings.mode,
  };
  const failed = Object.values(outputs).filter(o => o.status === 'error').length;
  await supabase.from('agent_runs').update({ synthesis, status: failed ? (failed === Object.keys(outputs).length ? 'failed' : 'partial') : 'completed', completed_at: new Date().toISOString() }).eq('id', runId).eq('user_id', userId);
  await audit.record({ userId, dealId, runId, actorUserId, agentId: 'super_agent', actionType: 'super_agent.run', inputs: { command: cmd, intent, method, inputs: requestInputs }, outputs: { agents: synthesis.agents.map(a => `${a.agent}:${a.status}`), disagreements: disagreements.length, best_next_action: next.action, approvals_requested: createdApprovals.length }, confidence: confidence.score });
  emit('synthesis', { synthesis });
  emit('done', { run_id: runId });
  return synthesis;
}

// Plain-language answer assembled from agent outputs - no new facts introduced.
function buildAnswer({ intent, outputs, understanding, disagreements, missing, next, requestInputs }) {
  const lines = [];
  const pick = (id) => outputs[id];
  const summaryOf = (id) => (pick(id) ? `${registry.get(id)?.name}: ${pick(id).summary}` : null);
  const order = {
    wholesale_check: ['wholesale', 'arv', 'buyer_matching', 'title_intelligence'],
    creative_finance: ['creative_finance', 'subject_to', 'seller_finance', 'financing'],
    biggest_risk: ['risk', 'title_intelligence', 'wholesale'],
    exit_strategies: ['disposition', 'wholesale', 'creative_finance', 'buyer_matching'],
    deal_not_working: ['risk', 'wholesale', 'transaction_coordinator', 'buyer_matching'],
    missing_information: [],
    what_if_price: ['wholesale', 'subject_to', 'seller_finance'],
    find_buyers: ['buyer_matching', 'disposition'],
    seller_motivation: ['motivated_seller', 'lead_intelligence'],
    valuation: ['valuation', 'arv'],
    financing: ['financing', 'creative_finance', 'subject_to', 'seller_finance'],
    title: ['title_intelligence', 'transaction_coordinator'],
    full_analysis: ['wholesale', 'valuation', 'arv', 'motivated_seller', 'creative_finance', 'buyer_matching', 'title_intelligence', 'risk'],
  }[intent] || [];
  if (intent === 'what_if_price' && requestInputs.asking_price) lines.push(`Under a seller price of $${Math.round(requestInputs.asking_price).toLocaleString('en-US')}:`);
  for (const id of order) { const s = summaryOf(id); if (s) lines.push(s); }
  if (intent === 'missing_information' || !lines.length) {
    lines.push(`${missing.length} item(s) are missing. Most needed: ${missing.slice(0, 5).map(m => m.item).join(', ') || 'none'}.`);
  }
  if (disagreements.length) lines.push(`Agents disagree on ${disagreements.map(d => `${d.key} (${d.spread_pct}% apart)`).join(', ')} - see the comparison before relying on either figure.`);
  if ((understanding.data_gaps || []).length) lines.push(`Data not available: ${understanding.data_gaps.map(g => g.reason).join('; ')}.`);
  lines.push(`Best next action: ${next.action}`);
  return lines.join('\n');
}

module.exports = { run, classify, planWaves, detectDisagreements, mergeMissing, overallConfidence, parseAmount, INTENTS, buildAnswer };
