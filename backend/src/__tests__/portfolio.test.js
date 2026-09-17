// Portfolio maths: every figure comes from recorded rows through the calculation
// engine, and anything that cannot be computed is null with a stated reason.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const file = require.resolve(path.join(__dirname, '..', 'config/supabase.js'));
require.cache[file] = { id: file, filename: file, loaded: true, exports: { from: () => ({}) } };

const portfolio = require('../services/portfolioService');
const core = require('../intelligence/calc/core');

const property = (over = {}) => ({
  id: 'p1', units_count: 1, current_value: 300000, loan_balance: 180000, loan_payment: 1200,
  purchase_price: 220000, rehab_cost: 30000, closing_costs: 6000, status: 'owned', ...over,
});
const lease = (over = {}) => ({ id: 'l1', property_id: 'p1', status: 'active', monthly_rent: 2200, ...over });
const tx = (direction, category, amount, over = {}) => ({ property_id: 'p1', direction, category, amount, occurred_on: '2026-08-15', ...over });

test('computes equity, NOI, cap rate, DSCR and cash flow from recorded rows', () => {
  // 12 months of rent and operating costs.
  const rows = [];
  for (let m = 0; m < 12; m++) {
    rows.push(tx('income', 'rent', 2200, { occurred_on: `2026-${String(m + 1).padStart(2, '0')}-01` }));
    rows.push(tx('expense', 'taxes', 300, { occurred_on: `2026-${String(m + 1).padStart(2, '0')}-05` }));
    rows.push(tx('expense', 'insurance', 100, { occurred_on: `2026-${String(m + 1).padStart(2, '0')}-06` }));
    rows.push(tx('expense', 'mortgage', 1200, { occurred_on: `2026-${String(m + 1).padStart(2, '0')}-02` })); // not an operating expense
  }
  const m = portfolio.propertyMetrics(property(), [lease()], rows, 12);
  assert.strictEqual(m.equity, 120000);              // 300,000 − 180,000
  assert.strictEqual(m.annual_income, 26400);        // 2,200 × 12
  assert.strictEqual(m.annual_operating_expenses, 4800); // (300 + 100) × 12, mortgage excluded
  assert.strictEqual(m.noi, 21600);                  // 26,400 − 4,800
  assert.strictEqual(m.cap_rate_pct, core.capRate({ noi: 21600, value: 300000 }).output.cap_rate_pct);
  assert.strictEqual(m.dscr, core.dscr({ annual_noi: 21600, annual_debt_service: 14400 }).output.dscr);
  assert.strictEqual(m.monthly_cash_flow, 600);      // (26,400 − 4,800)/12 − 1,200
  assert.strictEqual(m.cash_invested, 76000);        // 220,000 + 30,000 + 6,000 − 180,000
  assert.strictEqual(m.cash_on_cash_pct, core.cashOnCash({ annual_pre_tax_cash_flow: 7200, total_cash_invested: 76000 }).output.cash_on_cash_pct);
  assert.strictEqual(m.occupancy_pct, 100);
  assert.deepStrictEqual(m.missing, []);
});

test('mortgage, capex and rehab are kept out of operating expenses', () => {
  const rows = [tx('income', 'rent', 1000), tx('expense', 'capex', 5000), tx('expense', 'repairs', 200)];
  const m = portfolio.propertyMetrics(property(), [lease({ monthly_rent: 1000 })], rows, 1);
  assert.strictEqual(m.annual_operating_expenses, 2400); // only the 200 repair, annualised
});

test('no recorded money: income falls back to the signed lease and says so', () => {
  const m = portfolio.propertyMetrics(property(), [lease()], [], 12);
  assert.strictEqual(m.annual_income, 26400);
  assert.strictEqual(m.income_basis, 'contracted rent on active leases');
  assert.strictEqual(m.annual_operating_expenses, null);
  assert.strictEqual(m.noi, null, 'NOI is not guessed without expenses');
  assert.strictEqual(m.cap_rate_pct, null);
  assert.ok(m.missing.some(x => x.item === 'operating expenses'));
});

test('an empty property reports what is missing instead of zeros', () => {
  const m = portfolio.propertyMetrics(property({ current_value: null, loan_balance: null, loan_payment: null, purchase_price: null, rehab_cost: null, closing_costs: null }), [], [], 12);
  assert.strictEqual(m.annual_income, null);
  assert.strictEqual(m.equity, null);
  assert.strictEqual(m.monthly_cash_flow, null);
  assert.strictEqual(m.cash_on_cash_pct, null);
  const items = m.missing.map(x => x.item);
  for (const expected of ['income', 'operating expenses', 'loan payment', 'equity']) assert.ok(items.includes(expected), `${expected} explained`);
  for (const x of m.missing) assert.ok(x.why && x.how, 'each gap says why it matters and how to fill it');
});

test('a property owned free and clear (no payment) still reports cash flow', () => {
  const rows = [tx('income', 'rent', 1500, { occurred_on: '2026-09-01' }), tx('expense', 'taxes', 250, { occurred_on: '2026-09-02' })];
  const m = portfolio.propertyMetrics(property({ loan_balance: 0, loan_payment: 0 }), [lease({ monthly_rent: 1500 })], rows, 1);
  assert.strictEqual(m.monthly_cash_flow, 1250);
  assert.strictEqual(m.equity, 300000);
});

test('occupancy reflects active leases against unit count', () => {
  const p = property({ units_count: 4 });
  const leases = [lease({ id: 'a' }), lease({ id: 'b' }), lease({ id: 'c', status: 'ended' })];
  const m = portfolio.propertyMetrics(p, leases, [], 12);
  assert.strictEqual(m.occupied_units, 2);
  assert.strictEqual(m.occupancy_pct, 50);
  assert.strictEqual(m.contracted_monthly_rent, 4400, 'ended leases are not counted as rent');
});
