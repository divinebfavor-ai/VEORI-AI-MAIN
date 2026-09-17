// Run with:  node --test src/__tests__/
//
// Phase 4 agents: each either computes through the calculation engine from the
// inputs it has, or refuses with the specific missing items. None throws.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const file = require.resolve(path.join(__dirname, '..', 'config/supabase.js'));
require.cache[file] = { id: file, filename: file, loaded: true, exports: { from: () => ({}) } };
delete process.env.ANTHROPIC_API_KEY;

const G = require('../intelligence/dealGraph');
const S = require('../intelligence/calc/strategies');
const { AGENTS } = require('../intelligence/agents');
const { wilson } = require('../intelligence/agents/pipeline');
const { checklistFor } = require('../intelligence/agents/diligence');

const rep = (over = {}, worksheets = {}) => {
  const r = G.compose({
    deal: { id: 'd1', lead_id: 'l1', property_address: '1 Test St', property_city: 'Austin', property_state: 'TX', status: 'negotiating', arv: 300000, repair_estimate: 40000, seller_agreed_price: 150000, buyer_price: 175000, ...over.deal },
    lead: { id: 'l1', estimated_value: 220000, mortgage_balance: 120000, est_monthly_payment: 1100, property_type: 'single family', primary_tag: 'probate', ...over.lead },
    buyer: null, owner: null, lastCall: null, contracts: [], titleLogs: [], followUps: [], comps: over.comps || [],
  }, { record: null, value: null, rent: null, market: null }, over.overrides || {});
  r.unknowns = G.collectUnknowns(r);
  r.data_gaps = [];
  r.worksheets = Object.fromEntries(Object.entries(worksheets).map(([k, v]) => [k, { data: v, status: 'USER_PROVIDED' }]));
  return r;
};
const run = (id, r, extra = {}) => AGENTS[id].run({ userId: 'u1', dealId: 'd1', understanding: r, inputs: {}, priorOutputs: {}, useModel: false, ...extra }, { persist: false });

test('all 46 agents are registered and none throws on a sparse deal', async () => {
  assert.strictEqual(Object.keys(AGENTS).length, 46);
  const sparse = rep({ deal: { arv: null, repair_estimate: null, seller_agreed_price: null, buyer_price: null }, lead: { estimated_value: null, mortgage_balance: null, est_monthly_payment: null } });
  const dbTools = { supabase: { rpc: async () => ({ data: { leads: 0 }, error: null }), from: () => ({ select() { return this; }, eq() { return this; }, in() { return this; }, or() { return this; }, not() { return this; }, order() { return this; }, limit: async () => ({ data: [], error: null }), then: undefined }) }, matchBuyers: async () => [] };
  for (const id of Object.keys(AGENTS)) {
    const out = await run(id, sparse, { tools: dbTools });
    assert.notStrictEqual(out.status, 'error', `${id}: ${out.summary}`);
    assert.ok(out.confidence.reasoning, `${id} explains confidence`);
    if (out.status === 'insufficient_data') assert.ok(out.missing.length || /cannot|No /.test(out.summary), `${id} says what is missing`);
  }
});

test('fix & flip: exact profit, break-even and overrun scenario; refuses without holding months', async () => {
  const r = rep();
  const none = await run('fix_flip', r);
  assert.strictEqual(none.status, 'insufficient_data');
  assert.ok(none.missing.some(m => m.item === 'holding_months'));
  const out = await run('fix_flip', r, { inputs: { holding_months: 6, monthly_holding: 1000, sell_cost_pct: 8 } });
  const expected = S.fixFlip({ purchase_price: 150000, sale_price: 300000, rehab: 40000, holding_months: 6, monthly_holding: 1000, sell_cost_pct: 8 }).output.profit;
  assert.strictEqual(out.data.profit, expected);
  assert.strictEqual(out.data.scenarios.length, 10);
  assert.ok(out.risks.some(x => /Purchase closing costs not supplied/.test(x.risk)));
});

test('buy & hold: taxes from the understanding, IRR only with hold years and exit value', async () => {
  const r = rep({ overrides: { 'property.taxes.annual': { value: 3000 }, 'property.insurance.annual': { value: 1200 }, 'financial.market_rent': { value: 2000 } } });
  const inputs = { down_payment_pct: 25, loan_rate_pct: 7, vacancy_pct: 5 };
  const out = await run('buy_hold', r, { inputs });
  const expected = S.buyHold({ purchase_price: 150000, monthly_rent: 2000, down_payment_pct: 25, loan_rate_pct: 7, vacancy_pct: 5, monthly_taxes: 250, monthly_insurance: 100 }).output;
  assert.strictEqual(out.data.monthly_cash_flow, expected.monthly_cash_flow);
  assert.strictEqual(out.data.irr_annual_pct, null);
  const withIrr = await run('buy_hold', r, { inputs: { ...inputs, hold_years: 5, exit_value: 250000 } });
  assert.ok(Number.isFinite(withIrr.data.irr_annual_pct));
});

test('contract assignment and double close: fee vs net after double-close costs', async () => {
  const a = await run('contract_assignment', rep());
  assert.strictEqual(a.calculations[0].output.assignment_fee, 25000);
  assert.strictEqual(a.data.legal_requirements_verified, false);
  const d = await run('double_close', rep(), { inputs: { ab_closing_costs: 2000, bc_closing_costs: 3000, transactional_funding_fee_pct: 2 } });
  assert.strictEqual(d.data.net_profit, 25000 - 2000 - 3000 - 3000);
  assert.strictEqual(d.data.extra_cost_vs_assignment, 8000);
});

test('rehab estimation: line items, range, contingency; refuses without scope', async () => {
  const none = await run('rehab_estimation', rep());
  assert.match(none.summary, /will not guess/);
  const out = await run('rehab_estimation', rep({}, { rehab_scope: { contingency_pct: 10, items: [
    { item: 'Roof', quantity: 20, unit_cost: 450, unit_cost_low: 400, unit_cost_high: 500 },
    { item: 'Paint', quantity: 1500, unit_cost: 3, unit_cost_low: 2.5, unit_cost_high: 3.5 },
  ] } }));
  assert.strictEqual(out.data.subtotal, 9000 + 4500);
  assert.strictEqual(out.data.total, 14850);
  assert.match(out.summary, /range \$12,925-\$16,775/);
  assert.ok(out.risks.some(r => /differs from this scope/.test(r.risk)), 'deal repairs 40k vs scope 14.85k flagged');
});

test('construction management: overrun and schedule slip alerts', async () => {
  const start = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  const end = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
  const out = await run('construction_management', rep({}, { construction_budget: { start_date: start, planned_end_date: end, percent_complete: 30, lines: [{ name: 'Kitchen', budget: 20000, spent: 15000, committed: 9000 }], change_orders: [{ amount: 2000 }] } }));
  assert.strictEqual(out.data.projected, 26000);
  assert.ok(out.risks.some(r => /Kitchen is over budget by \$4,000/.test(r.risk)));
  assert.ok(out.risks.some(r => /Schedule slipping/.test(r.risk)));
});

test('multifamily: NOI, cap rate and rent roll loss-to-lease from worksheets', async () => {
  const out = await run('multifamily', rep({}, {
    operating_statement: { income: [{ name: 'Rent', annual_amount: 120000 }], expenses: [{ name: 'All', annual_amount: 48000 }], vacancy_pct: 5, market_cap_rate_pct: 7, cap_rate_source: 'broker survey Q3' },
    rent_roll: { units: [{ beds: 2, rent: 1000, market_rent: 1100, status: 'occupied' }, { beds: 2, rent: 0, market_rent: 1100, status: 'vacant' }] },
  }));
  assert.strictEqual(out.data.noi, 66000);
  assert.strictEqual(out.data.income_value, 942857.14);
  assert.strictEqual(out.data.occupancy_pct, 50);
  assert.strictEqual(out.data.monthly_loss_to_lease, 1200);
});

test('land: landlocked parcel is critical; residual land value computed from the plan', async () => {
  const acq = await run('land_acquisition', rep({}, { land: { acreage: 10, zoning: 'R-1', road_access: false, flood_zone: 'AE' } }));
  assert.ok(acq.risks.some(r => r.severity === 'critical' && /landlocked/.test(r.risk)));
  assert.ok(acq.risks.some(r => /special flood hazard/.test(r.risk)));
  const dev = await run('land_development', rep({}, { land: { zoning: 'R-1', development: { units: 20, sale_price_per_unit: 300000, hard_cost_per_unit: 180000, soft_cost_pct: 15, developer_profit_pct: 15, infrastructure_cost: 400000 } } }));
  assert.strictEqual(dev.data.residual_land_value, 6000000 - 3600000 - 540000 - 400000 - 900000);
});

test('real estate law: no verified items means "cannot confirm"; stale items marked', async () => {
  const empty = { from: () => ({ select() { return this; }, in() { return this; }, or() { return this; }, limit: async () => ({ data: [], error: null }) }) };
  const none = await run('real_estate_law', rep(), { tools: { supabase: empty } });
  assert.match(none.summary, /cannot confirm the legal requirements for TX/);
  assert.strictEqual(none.attorney_review, true);
  const items = [{ topic: 'wholesaling', jurisdiction: 'TX', content: { summary: 'Rule text' }, source: 'Statute', source_url: 'https://example.gov', effective_date: '2020-01-01', last_verified_at: '2026-01-01', review_by: '2020-06-01', confidence: 80, user_id: null }];
  const stale = { from: () => ({ select() { return this; }, in() { return this; }, or() { return this; }, limit: async () => ({ data: items, error: null }) }) };
  const out = await run('real_estate_law', rep(), { tools: { supabase: stale } });
  assert.strictEqual(out.findings[0].claim.status, 'UNVERIFIED');
  assert.strictEqual(out.data.verified_items, 0);
});

test('lead scoring uses history with Wilson intervals; zero events are not dressed up', async () => {
  const w = wilson(0, 1972);
  assert.strictEqual(w.rate_pct, 0);
  assert.ok(w.high_pct > 0 && w.high_pct < 0.3);
  const r2 = wilson(20, 100);
  assert.ok(r2.low_pct < 20 && r2.high_pct > 20);
  const tools = { supabase: { rpc: async () => ({ data: { leads: 1972, responded: 0, appointment: 0, offer: 0, contract: 0, closed: 0 }, error: null }) } };
  const out = await run('lead_scoring', rep(), { tools });
  assert.match(out.summary, /no recorded responses/);
  assert.strictEqual(out.confidence.score, 15);
});

test('due diligence: lead paint item only for pre-1978 homes, with its federal source', () => {
  const old = checklistFor({ propertyType: 'single family', yearBuilt: 1965 });
  assert.ok(old.find(i => i.key === 'lead_paint').source.includes('42 U.S.C. 4852d'));
  assert.ok(!checklistFor({ propertyType: 'single family', yearBuilt: 1995 }).find(i => i.key === 'lead_paint'));
  assert.ok(checklistFor({ structure: 'subject_to' }).find(i => i.key === 'loan_documents'));
});

test('equity JV waterfall from worksheet; DSCR sizing from saved quote', async () => {
  const jv = await run('equity_jv', rep({}, { jv_terms: { investor_equity: 900000, sponsor_equity: 100000, total_distributions: 1400000, hold_years: 2, preferred_return_pct: 8, sponsor_promote_pct: 20 } }));
  assert.strictEqual(jv.data.investor_total, 1228320);
  const r = rep({ overrides: { 'financial.market_rent': { value: 2000 } } }, { loan_quotes: [{ type: 'dscr', rate_pct: 0, min_dscr: 1.25, term_months: 360 }] });
  const d = await run('dscr', r, { inputs: { monthly_operating_expenses: 500, vacancy_pct: 0 } });
  assert.strictEqual(d.data.annual_noi, 18000);
  assert.strictEqual(d.data.max_loan, 432000);
});

test('fix & flip uses the itemised rehab scope over the unverified repair figure on record', async () => {
  const r = rep();
  const scopeOut = { status: 'complete', data: { total: 14850 } };
  const out = await run('fix_flip', r, { inputs: { holding_months: 6 }, priorOutputs: { rehab_estimation: scopeOut } });
  assert.strictEqual(out.data.profit, S.fixFlip({ purchase_price: 150000, sale_price: 300000, rehab: 14850, holding_months: 6 }).output.profit);
  const explicit = await run('fix_flip', r, { inputs: { holding_months: 6, repairs: 50000 }, priorOutputs: { rehab_estimation: scopeOut } });
  assert.strictEqual(explicit.data.profit, S.fixFlip({ purchase_price: 150000, sale_price: 300000, rehab: 50000, holding_months: 6 }).output.profit);
});
