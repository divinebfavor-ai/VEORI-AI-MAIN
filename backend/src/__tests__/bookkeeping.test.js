// Books: totals come from recorded entries, tax lines map the way the IRS form does,
// and the two things that cannot be derived (mortgage interest, depreciation) stay blank.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

// Tables the service reads, filled per test.
const tables = { portfolio_transactions: [], portfolio_properties: [], deals: [], vendors: [] };
function query(name) {
  let rows = () => tables[name] || [];
  const filters = [];
  const q = {
    select() { return q; }, order() { return q; }, limit() { return q; },
    eq(c, v) { filters.push(r => r[c] === v); return q; },
    gte(c, v) { filters.push(r => String(r[c]) >= String(v)); return q; },
    lte(c, v) { filters.push(r => String(r[c]) <= String(v)); return q; },
    then(res, rej) { return Promise.resolve({ data: rows().filter(r => filters.every(f => f(r))), error: null }).then(res, rej); },
  };
  return q;
}
const file = require.resolve(path.join(__dirname, '..', 'config/supabase.js'));
require.cache[file] = { id: file, filename: file, loaded: true, exports: { from: query } };

const books = require('../services/bookkeepingService');

const U = 'u1';
const reset = () => { for (const k of Object.keys(tables)) tables[k] = []; };
const entry = (over) => ({ id: Math.random().toString(36).slice(2), user_id: U, occurred_on: '2026-03-10', direction: 'expense', category: 'repairs', amount: 100, property_id: null, deal_id: null, vendor_id: null, memo: null, ...over });

test('profit and loss separates operating costs, debt and capital improvements', async () => {
  reset();
  tables.portfolio_properties = [{ id: 'p1', address: '1 Main St', user_id: U }];
  tables.portfolio_transactions = [
    entry({ direction: 'income', category: 'rent', amount: 2000, property_id: 'p1' }),
    entry({ category: 'repairs', amount: 300, property_id: 'p1' }),
    entry({ category: 'mortgage', amount: 1200, property_id: 'p1' }),
    entry({ category: 'capex', amount: 5000, property_id: 'p1' }),
    entry({ category: 'marketing', amount: 400 }),                       // business overhead
    entry({ direction: 'income', category: 'assignment_fee', amount: 9000, deal_id: 'd1' }),
  ];
  const pl = await books.profitAndLoss(U, { from: '2026-01-01', to: '2026-12-31' });
  assert.strictEqual(pl.totals.income, 11000);
  assert.strictEqual(pl.totals.operating_expenses, 700, 'mortgage and capex are not operating expenses');
  assert.strictEqual(pl.totals.debt_payments, 1200);
  assert.strictEqual(pl.totals.capital_improvements, 5000);
  assert.strictEqual(pl.totals.net_operating, 10300);
  assert.strictEqual(pl.totals.net_after_debt, 9100);
  assert.strictEqual(pl.by_scope.properties.income, 2000);
  assert.strictEqual(pl.by_scope.deals.income, 9000);
  assert.strictEqual(pl.by_scope.overhead.expense, 400);
});

test('a collected fee that never reached the books is flagged, not silently missed', async () => {
  reset();
  tables.deals = [{ id: 'd9', user_id: U, property_address: '9 Oak', status: 'closed', fee_collected_amount: 12000, fee_collected_at: '2026-05-02T00:00:00Z' }];
  const pl = await books.profitAndLoss(U, { from: '2026-01-01', to: '2026-12-31' });
  assert.strictEqual(pl.fees_not_in_the_books.length, 1);
  assert.strictEqual(pl.fees_not_in_the_books[0].amount, 12000);
  // Once it is recorded against the deal it stops being flagged.
  tables.portfolio_transactions = [entry({ direction: 'income', category: 'assignment_fee', amount: 12000, deal_id: 'd9', occurred_on: '2026-05-02' })];
  const after = await books.profitAndLoss(U, { from: '2026-01-01', to: '2026-12-31' });
  assert.strictEqual(after.fees_not_in_the_books.length, 0);
});

test('Schedule E maps categories to the right lines and groups cleaning and maintenance', async () => {
  reset();
  tables.portfolio_properties = [{ id: 'p1', user_id: U, address: '1 Main St', city: 'Austin', state: 'TX', zip: '78701', units_count: 1, purchase_price: 200000, purchase_date: '2025-06-01' }];
  tables.portfolio_transactions = [
    entry({ direction: 'income', category: 'rent', amount: 1500, property_id: 'p1' }),
    entry({ direction: 'income', category: 'late_fee', amount: 50, property_id: 'p1' }),
    entry({ category: 'marketing', amount: 100, property_id: 'p1' }),
    entry({ category: 'cleaning', amount: 60, property_id: 'p1' }),
    entry({ category: 'maintenance', amount: 40, property_id: 'p1' }),
    entry({ category: 'insurance', amount: 90, property_id: 'p1' }),
    entry({ category: 'management', amount: 120, property_id: 'p1' }),
    entry({ category: 'taxes', amount: 200, property_id: 'p1' }),
  ];
  const se = await books.scheduleE(U, 2026);
  const p = se.properties[0];
  assert.strictEqual(p.rents_received, 1550, 'all rental income is rents received');
  const line = (n) => p.expense_lines.find(l => l.line === n);
  assert.strictEqual(line(5).amount, 100);            // advertising
  assert.strictEqual(line(7).amount, 100);            // cleaning + maintenance together
  assert.strictEqual(line(9).amount, 90);             // insurance
  assert.strictEqual(line(11).amount, 120);           // management
  assert.strictEqual(line(16).amount, 200);           // taxes
  assert.strictEqual(p.total_expenses_claimed, 610);
  assert.strictEqual(p.net_before_depreciation, 940);
});

test('mortgage payments and capital improvements are excluded from Schedule E with the reason', async () => {
  reset();
  tables.portfolio_properties = [{ id: 'p1', user_id: U, address: '1 Main St', units_count: 1 }];
  tables.portfolio_transactions = [
    entry({ direction: 'income', category: 'rent', amount: 1000, property_id: 'p1' }),
    entry({ category: 'mortgage', amount: 900, property_id: 'p1' }),
    entry({ category: 'capex', amount: 4000, property_id: 'p1' }),
  ];
  const se = await books.scheduleE(U, 2026);
  const p = se.properties[0];
  assert.strictEqual(p.total_expenses_claimed, 0);
  const kinds = p.not_included.map(x => x.category).sort();
  assert.deepStrictEqual(kinds, ['capex', 'mortgage']);
  assert.match(p.not_included.find(x => x.category === 'mortgage').why, /interest only/i);
  assert.strictEqual(p.depreciation.amount, null, 'depreciation is never invented');
  assert.match(p.depreciation.why, /cost basis/i);
});

test('only the requested tax year is counted', async () => {
  reset();
  tables.portfolio_properties = [{ id: 'p1', user_id: U, address: '1 Main St', units_count: 1 }];
  tables.portfolio_transactions = [
    entry({ direction: 'income', category: 'rent', amount: 1000, property_id: 'p1', occurred_on: '2026-02-01' }),
    entry({ direction: 'income', category: 'rent', amount: 999, property_id: 'p1', occurred_on: '2025-12-31' }),
    entry({ direction: 'income', category: 'rent', amount: 888, property_id: 'p1', occurred_on: '2027-01-01' }),
  ];
  const se = await books.scheduleE(U, 2026);
  assert.strictEqual(se.properties[0].rents_received, 1000);
  await assert.rejects(() => books.scheduleE(U, 'not-a-year'), /four-digit year/);
});

test('1099: flags vendors paid at or over the threshold and those missing a W-9', async () => {
  reset();
  tables.vendors = [
    { id: 'v1', user_id: U, name: 'Ace Roofing', w9_on_file: false, issues_1099: true },
    { id: 'v2', user_id: U, name: 'Small Fix', w9_on_file: false, issues_1099: true },
    { id: 'v3', user_id: U, name: 'Big Corp', w9_on_file: true, issues_1099: false },
  ];
  tables.portfolio_transactions = [
    entry({ category: 'repairs', amount: 600, vendor_id: 'v1' }),      // exactly at the threshold
    entry({ category: 'repairs', amount: 599, vendor_id: 'v2' }),      // just under
    entry({ category: 'legal', amount: 5000, vendor_id: 'v3' }),       // corporation, exempt
    entry({ category: 'supplies', amount: 250 }),                      // no vendor attached
  ];
  const r = await books.vendorPayments(U, 2026);
  const byName = Object.fromEntries(r.vendors.map(v => [v.name, v]));
  assert.strictEqual(byName['Ace Roofing'].needs_1099, true);
  assert.match(byName['Ace Roofing'].action, /W-9/);
  assert.strictEqual(byName['Small Fix'].needs_1099, false);
  assert.strictEqual(byName['Big Corp'].needs_1099, false, 'marked as not issuing a 1099');
  assert.strictEqual(r.needing_1099, 1);
  assert.strictEqual(r.missing_w9, 1);
  assert.strictEqual(r.expenses_without_a_vendor, 250);
});

test('CSV quotes every field and escapes quotes and commas', () => {
  const csv = books.toCsv([{ a: 'He said "hi"', b: 'x,y', c: 5 }], ['a', 'b', 'c']);
  assert.strictEqual(csv, '"a","b","c"\r\n"He said ""hi""","x,y","5"');
});
