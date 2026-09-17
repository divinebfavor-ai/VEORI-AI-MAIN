// Run with:  node --test src/__tests__/
//
// Super-Agent orchestration (routing, waves, disagreements, missing info, BNA) and
// the Phase 2 agents run against a deal fixture without the database.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const file = require.resolve(path.join(__dirname, '..', 'config/supabase.js'));
require.cache[file] = { id: file, filename: file, loaded: true, exports: { from: () => ({ select: () => ({ eq: () => ({ in: async () => ({ data: [] }) }) }) }) } };
delete process.env.ANTHROPIC_API_KEY; // agents must work without the model

const G = require('../intelligence/dealGraph');
const SA = require('../intelligence/superAgent');
const { AGENTS } = require('../intelligence/agents');
const registry = require('../intelligence/registry');
const bna = require('../intelligence/engines/bestNextAction');

const records = (over = {}) => ({
  deal: { id: 'd1', lead_id: 'l1', property_address: '12 Oak St', property_city: 'Austin', property_state: 'TX', property_zip: '78701', status: 'negotiating', arv: 300000, repair_estimate: 40000, offer_price: 160000, seller_name: 'Sam Seller', mao: 150000, closing_date: null, ...over.deal },
  lead: { id: 'l1', first_name: 'Sam', last_name: 'Seller', phone: '+15125550100', property_address: '12 Oak St', estimated_value: 210000, mortgage_balance: 90000, est_monthly_payment: 900, probate_case: true, years_owned: 22, consent: false, ...over.lead },
  buyer: null, owner: { company_name: 'Acme' }, lastCall: { motivation_score: 70, created_at: '2026-09-10T00:00:00Z' },
  contracts: [], titleLogs: [], followUps: [], comps: over.comps || [],
});
const understanding = (over) => {
  const rep = G.compose(records(over), { record: null, value: null, rent: null, market: null }, over?.overrides || {});
  rep.unknowns = G.collectUnknowns(rep);
  rep.data_gaps = [];
  return rep;
};
const ctx = (rep, extra = {}) => ({ userId: 'u1', dealId: 'd1', understanding: rep, inputs: {}, priorOutputs: {}, useModel: false, ...extra });

test('routing: rules pick intents; amounts parse from commands', async () => {
  assert.strictEqual((await SA.classify('Can I wholesale this deal?')).intent, 'wholesale_check');
  assert.strictEqual((await SA.classify('What happens if the seller wants $350k?')).intent, 'what_if_price');
  assert.strictEqual((await SA.classify('What creative-finance options exist?')).intent, 'creative_finance');
  assert.strictEqual((await SA.classify('Find the biggest risk in this transaction.')).intent, 'biggest_risk');
  assert.strictEqual((await SA.classify('What information are we missing?')).intent, 'missing_information');
  assert.strictEqual((await SA.classify('Find buyers for this property.')).intent, 'find_buyers');
  assert.strictEqual((await SA.classify('Why is this deal not working?')).intent, 'deal_not_working');
  assert.strictEqual((await SA.classify('Build me the complete acquisition strategy.')).intent, 'full_analysis');
  assert.strictEqual((await SA.classify('Find five potential exit strategies.')).intent, 'exit_strategies');
  assert.strictEqual((await SA.classify('zzz')).intent, 'full_analysis', 'no model, no rule: safe default');
  assert.strictEqual(SA.parseAmount('seller wants $350k'), 350000);
  assert.strictEqual(SA.parseAmount('what if 275,000'), 275000);
  assert.strictEqual(SA.parseAmount('$1.2m'), 1200000);
  assert.strictEqual(SA.parseAmount('no number'), null);
});

test('waves: independent agents run together, dependents after their inputs, challenger last', () => {
  const waves = SA.planWaves(SA.INTENTS.full_analysis.agents);
  const waveOf = (id) => waves.findIndex(w => w.includes(id));
  assert.ok(waveOf('arv') < waveOf('wholesale'));
  assert.ok(waveOf('wholesale') < waveOf('buyer_matching'));
  assert.ok(waveOf('wholesale') < waveOf('risk'));
  assert.strictEqual(waves[waves.length - 1].join(), 'challenger');
  assert.ok(waves[0].length >= 8, 'most agents run in parallel in the first wave');
  for (const intent of Object.values(SA.INTENTS)) for (const a of intent.agents) assert.ok(AGENTS[a], `intent references undeclared agent ${a}`);
});

test('every agent is registered with a valid declaration', () => {
  const ids = registry.list().map(a => a.id);
  for (const id of Object.keys(AGENTS)) assert.ok(ids.includes(id));
  assert.ok(ids.includes('compliance_spine'));
  assert.deepStrictEqual(registry.validateHandoffs(), []);
});

test('wholesale: MAO from the calc engine, flags unverified ARV, needs approval to offer', async () => {
  const rep = understanding();
  const out = await AGENTS.wholesale.run(ctx(rep), { persist: false });
  assert.strictEqual(out.status, 'complete');
  assert.strictEqual(out.data.mao, 170000);
  assert.strictEqual(out.positions['offer.max_price'], 170000);
  assert.ok(out.risks.some(r => /ARV is unverified/.test(r.risk)));
  const offerRec = out.recommendations.find(r => r.action_type === 'submit_offer');
  assert.ok(offerRec && offerRec.payload.max_price === 170000);
  assert.strictEqual(out.attorney_review, true);
});

test('wholesale says it cannot confirm when inputs are missing', async () => {
  const rep = understanding({ deal: { arv: null, repair_estimate: null }, lead: { estimated_arv: null } });
  const out = await AGENTS.wholesale.run(ctx(rep), { persist: false });
  assert.strictEqual(out.status, 'insufficient_data');
  assert.match(out.summary, /cannot calculate/);
  assert.strictEqual(out.confidence.score, 0);
  assert.strictEqual(out.missing.length, 2);
});

test('valuation and ARV never treat listings as sales', async () => {
  const comps = [1, 2, 3, 4].map(i => ({ address: `${i} A St`, price: 250000 + i * 1000, price_type: 'listed', sqft: 1500, source: 'RentCast', retrieved_at: '2026-09-17' }));
  const rep = understanding({ comps, overrides: { 'property.sqft': { value: 1500, set_at: '2026-09-17' } } });
  rep.property.sqft = { value: 1500, status: 'USER_PROVIDED', source: 'operator', confidence: null };
  const v = await AGENTS.valuation.run(ctx(rep), { persist: false });
  assert.ok(v.data.methods.find(m => m.method === 'comparable_sales').not_available);
  assert.strictEqual(v.data.methods.find(m => m.method === 'listing_prices').status, 'ESTIMATED');
  const a = await AGENTS.arv.run(ctx(rep), { persist: false });
  assert.strictEqual(a.data.status, 'UNVERIFIED', 'falls back to the record ARV, labelled unverified');
});

test('motivated seller PMI uses documented property evidence only', async () => {
  const out = await AGENTS.motivated_seller.run(ctx(understanding()), { persist: false });
  const drivers = out.data.drivers.map(d => d.driver);
  assert.ok(drivers.includes('Probate / estate'));
  assert.ok(drivers.includes('Owned 10+ years'));
  assert.strictEqual(out.data.pmi, 20 + 10 + 5 + 18, 'probate 20 + high equity 10 + long ownership 5 + call score 70×0.25');
  assert.ok(out.confidence.reasoning.includes('property and financial signals only'));
});

test('subject-to, seller finance, title and risk agents', async () => {
  const rep = understanding();
  const st = await AGENTS.subject_to.run(ctx(rep), { persist: false });
  assert.strictEqual(st.status, 'complete');
  assert.ok(st.risks.some(r => /Due-on-sale/.test(r.risk)));
  const sf = await AGENTS.seller_finance.run(ctx(rep), { persist: false });
  assert.strictEqual(sf.data.structures.length, 3);
  assert.strictEqual(sf.data.illustrative, true);
  const t = await AGENTS.title_intelligence.run(ctx(rep), { persist: false });
  assert.ok(t.risks.some(r => /Probate/.test(r.risk)));
  assert.match(t.summary, /cannot be confirmed clear/);
  const risk = await AGENTS.risk.run(ctx(rep, { priorOutputs: { subject_to: st, title_intelligence: t } }), { persist: false });
  assert.ok(risk.data.register.length >= 3);
  assert.ok(['critical', 'high'].includes(risk.data.register[0].severity));
});

test('buyer matching names only this operator\'s buyers', async () => {
  const tools = { matchBuyers: async () => ([
    { id: 'b1', user_id: 'u1', name: 'Mine', buy_box_states: ['TX'], property_cities: ['Austin'], proof_of_funds: true },
    { id: 'b2', user_id: 'someone-else', name: 'Pool Buyer', buy_box_states: [] },
  ]), supabase: { from: () => ({ select: () => ({ eq: () => ({ in: async () => ({ data: [] }) }) }) }) } };
  const out = await AGENTS.buyer_matching.run(ctx(understanding(), { tools }), { persist: false });
  assert.strictEqual(out.data.ranked.length, 1);
  assert.strictEqual(out.data.ranked[0].name, 'Mine');
  assert.deepStrictEqual(out.data.ranked[0].matched_criteria, ['state: TX', 'city: Austin']);
  assert.strictEqual(out.data.pool_buyer_count, 1);
  assert.ok(!JSON.stringify(out).includes('Pool Buyer'));
});

test('disagreements are surfaced, missing items merged, challenger questions weak evidence', async () => {
  const rep = understanding();
  const w = await AGENTS.wholesale.run(ctx(rep), { persist: false });
  const d = SA.detectDisagreements({ wholesale: w }, rep);
  const mao = d.find(x => x.key === 'offer.max_price');
  assert.ok(mao, 'calculated MAO 170k vs 150k on record');
  assert.strictEqual(mao.material, true);
  const missing = SA.mergeMissing(rep, { wholesale: w });
  assert.ok(missing.every(m => m.why_it_matters && m.how_to_get));
  const ch = await AGENTS.challenger.run(ctx(rep, { priorOutputs: { wholesale: w }, disagreements: d }), { persist: false });
  assert.ok(ch.data.challenges.some(c => /sold comparables/.test(c.question)));
  assert.ok(ch.data.challenges.some(c => /disagree/.test(c.question)));
});

test('best next action: pending approval first, then stage blockers, then recommendations', () => {
  const rep = understanding();
  const withApproval = bna.compute({ understanding: rep, outputs: {}, pendingApprovals: [{ agent_id: 'wholesale', action_type: 'submit_offer', reason: 'Offer up to $170,000' }] });
  assert.match(withApproval.action, /Review and decide/);
  const blocked = bna.compute({ understanding: understanding({ deal: { repair_estimate: null } }), outputs: {} });
  assert.strictEqual(blocked.source_agent, 'deal_understanding_engine');
  assert.match(blocked.action, /repairs/i);
  assert.match(blocked.why, /repair budget/i);
  assert.strictEqual(bna.compute({ understanding: rep, outputs: {} }).source_agent, 'stage_default', 'nothing blocking and no recommendations');
  const critical = bna.compute({ understanding: rep, outputs: { t: { agent_id: 'title_intelligence', risks: [{ risk: 'Foreclosure sale date', severity: 'critical', mitigation: 'Get the sale date' }] } } });
  assert.strictEqual(critical.urgency, 'critical');
});
