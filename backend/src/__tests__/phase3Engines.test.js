// Run with:  node --test src/__tests__/
//
// Phase 3 engines: scenarios, optimizer, scorecard (no composite), timeline delay cost.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const file = require.resolve(path.join(__dirname, '..', 'config/supabase.js'));
require.cache[file] = { id: file, filename: file, loaded: true, exports: { from: () => ({}) } };

const SC = require('../intelligence/engines/scenarios');
const OPT = require('../intelligence/engines/optimizer');
const CARD = require('../intelligence/engines/scorecard');
const TL = require('../intelligence/engines/timeline');
const G = require('../intelligence/dealGraph');
const S = require('../intelligence/calc/strategies');

const flipBase = { purchase_price: 150000, sale_price: 250000, rehab: 40000, holding_months: 6, monthly_holding: 1000, buy_closing_pct: 2, sell_cost_pct: 8, loan_amount: 120000, loan_rate_pct: 12, loan_points_pct: 2 };

test('scenarios: base matches the calc engine; shocks applied exactly and described', () => {
  const r = SC.run({ strategy: 'fix_flip', base: flipBase });
  const base = r.scenarios.find(s => s.key === 'base');
  assert.strictEqual(base.metrics.profit_loss, S.fixFlip(flipBase).output.profit);
  const down = r.scenarios.find(s => s.key === 'downside');
  const expected = S.fixFlip({ ...flipBase, sale_price: 225000, rehab: 46000, holding_months: 8 }).output.profit;
  assert.strictEqual(down.metrics.profit_loss, expected);
  assert.ok(down.assumptions.includes('ARV/sale price -10%'));
  assert.match(down.narrative, /^Under this scenario/);
  const stress = r.scenarios.find(s => s.key === 'stress');
  assert.ok(stress.metrics.profit_loss < 0 && stress.risks.includes('Loss on the deal.'));
  assert.match(r.summary, /loses money under/);
  assert.strictEqual(r.scenarios.length, 10);
});

test('scenarios: operator can override shocks and add custom cases; bad shocks rejected', () => {
  const r = SC.run({ strategy: 'fix_flip', base: flipBase, scenarios: { downside: { shocks: { arv_pct: -5 } }, my_case: { label: 'Mine', shocks: { rehab_pct: 100 } } } });
  assert.strictEqual(r.scenarios.find(s => s.key === 'downside').metrics.profit_loss, S.fixFlip({ ...flipBase, sale_price: 237500 }).output.profit);
  assert.ok(r.scenarios.find(s => s.key === 'my_case' && s.label === 'Mine'));
  assert.throws(() => SC.run({ strategy: 'fix_flip', base: flipBase, scenarios: { x_y: { shocks: { arv_pct: 'lots' } } } }), /must be a number/);
  assert.throws(() => SC.run({ strategy: 'moon', base: flipBase }), /strategy/);
});

test('scenarios: wholesale fee and rental cash flow', () => {
  const w = SC.run({ strategy: 'wholesale', base: { arv: 300000, repairs: 40000, contract_price: 150000 } });
  assert.strictEqual(w.scenarios.find(s => s.key === 'base').metrics.profit_loss, 20000);
  assert.strictEqual(w.scenarios.find(s => s.key === 'price_decline').metrics.contract_still_works, false);
  const h = SC.run({ strategy: 'buy_hold', base: { purchase_price: 200000, down_payment_pct: 25, loan_rate_pct: 7, monthly_rent: 2000, vacancy_pct: 5, management_pct: 8, maintenance_pct: 5, capex_pct: 5, monthly_taxes: 250, monthly_insurance: 100 } });
  assert.strictEqual(h.scenarios.find(s => s.key === 'base').metrics.profit_loss, Math.round(192.05 * 12 * 100) / 100);
  assert.ok(h.scenarios.find(s => s.key === 'stress').risks.some(x => /DSCR/.test(x) || /Negative/.test(x)));
});

test('optimizer: objective is required and chosen by the operator', () => {
  assert.throws(() => OPT.optimize({ deal: {} }), /objective is required/);
  const inputs = {
    deal: { arv: 300000, repairs: 40000, as_is_value: 220000, existing_loan_balance: 120000, existing_monthly_payment: 1100, monthly_rent: 1900 },
    seller: { min_price: 140000 }, operator: { max_price: 180000, available_cash: 250000, risk_tolerance: 'high' },
    costs: { sell_cost_pct: 8, holding_months: 6, monthly_holding: 1000, assignment_close_days: 21, cash_close_days: 14 },
  };
  const profit = OPT.optimize({ objective: 'maximize_profit', ...inputs });
  assert.strictEqual(profit.selected_by, 'operator');
  assert.strictEqual(profit.prices_searched[0], 140000);
  const cash = OPT.optimize({ objective: 'minimize_cash_required', ...inputs });
  assert.strictEqual(cash.best.structure, 'wholesale_assignment');
  assert.strictEqual(cash.best.cash_required, 0);
  const flip140 = S.fixFlip({ purchase_price: 140000, sale_price: 300000, rehab: 40000, holding_months: 6, monthly_holding: 1000, sell_cost_pct: 8, buy_closing_pct: 0 }).output.profit;
  assert.strictEqual(profit.options.find(o => o.structure === 'cash_flip').profit, flip140);
});

test('optimizer: constraints rule structures out with reasons', () => {
  const r = OPT.optimize({
    objective: 'maximize_profit',
    deal: { arv: 300000, repairs: 40000, as_is_value: 220000, existing_loan_balance: 120000, existing_monthly_payment: 1100 },
    seller: { min_price: 150000, needs_debt_relief: true }, operator: { max_price: 150000, available_cash: 50000, risk_tolerance: 'low' },
  });
  assert.ok(r.infeasible.some(i => i.structure === 'cash_flip' && /cash/.test(i.reason)));
  assert.ok(r.infeasible.some(i => i.structure === 'subject_to' && /(released from the existing loan|risk tolerance)/.test(i.reason)));
  assert.strictEqual(r.best.structure, 'wholesale_assignment');
  assert.ok(r.assumptions.some(a => /fixed structural ranking/.test(a)));
});

test('scorecard: independent dimensions, no composite, honest title', () => {
  const rep = G.compose({ deal: { id: 'd', status: 'negotiating', arv: 300000, repair_estimate: 40000 }, lead: { estimated_value: 200000, mortgage_balance: 50000 }, buyer: null, owner: null, lastCall: null, contracts: [], titleLogs: [], followUps: [], comps: [] }, { record: null, value: null, rent: null, market: null });
  rep.unknowns = G.collectUnknowns(rep);
  const card = CARD.build({ understanding: rep, outputs: {} });
  assert.strictEqual(card.composite, null);
  assert.strictEqual(card.dimensions.length, 11);
  assert.deepStrictEqual(card.dimensions.map(d => d.key), ['value', 'equity', 'profit_potential', 'cash_required', 'risk', 'financing', 'exit_liquidity', 'time', 'data_confidence', 'title_status', 'market_conditions']);
  assert.strictEqual(card.dimensions.find(d => d.key === 'value').rating, 'unsupported');
  assert.strictEqual(card.dimensions.find(d => d.key === 'equity').rating, 'high');
  assert.strictEqual(card.dimensions.find(d => d.key === 'title_status').rating, 'not assessed');
});

test('timeline: schedule, delays and holding cost from stated carrying cost only', () => {
  const t = TL.simulate({ strategy: 'fix_flip', start_date: '2026-10-01', durations: { contract: 2, due_diligence: 10, financing: 20, title: 20, closing: 3, rehab: 60, listing_and_sale: 45 }, monthly_carrying_cost: 3650 });
  assert.strictEqual(t.total_days, 160);
  assert.strictEqual(t.completion_date, '2027-03-10');
  assert.strictEqual(t.carrying_days, 105);
  assert.strictEqual(t.holding_cost_total, 12600);
  assert.strictEqual(t.delay_impact.find(x => x.delay_days === 30).added_holding_cost, 3600);
  assert.match(t.delay_impact[0].statement, /holding cost increases by \$3,600/);
  const noCost = TL.simulate({ strategy: 'wholesale' });
  assert.strictEqual(noCost.delay_impact, null);
  assert.ok(noCost.assumptions.some(a => /cannot be calculated/.test(a)));
  const delayed = TL.simulate({ strategy: 'wholesale', start_date: '2026-10-01', delays: { title: 30 } });
  assert.strictEqual(delayed.total_days, 51 + 30);
});
