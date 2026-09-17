// ─── Books: profit and loss, Schedule E and 1099 tracking ────────────────────
// Everything here is summed from ledger entries the operator recorded. Nothing is
// estimated, and anything that cannot be derived from those entries is reported as
// not computed, with the reason - a tax figure that is quietly wrong is worse than
// a blank one.
//
// Two things are deliberately NOT calculated:
//   • Mortgage interest. A recorded mortgage payment mixes principal and interest,
//     and splitting it needs the lender's amortisation, not a guess. Schedule E
//     wants interest only, so payments are reported on their own line to be split.
//   • Depreciation. It needs the cost basis, the in-service date and a method.
//     None of that is recorded, so the line stays blank rather than inventing it.

const supabase = require('../config/supabase');
const core = require('../intelligence/calc/core');

const MONEY = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? 0 : Number(v));
const round = (n) => core.round2(n) || 0;

// Ledger category -> IRS Schedule E line. Categories with no line are listed
// separately rather than dropped, so the total always reconciles.
const SCHEDULE_E_LINES = {
  marketing:         { line: 5,  label: 'Advertising' },
  auto_travel:       { line: 6,  label: 'Auto and travel' },
  cleaning:          { line: 7,  label: 'Cleaning and maintenance' },
  maintenance:       { line: 7,  label: 'Cleaning and maintenance' },
  turnover:          { line: 7,  label: 'Cleaning and maintenance' },
  landscaping:       { line: 7,  label: 'Cleaning and maintenance' },
  pest:              { line: 7,  label: 'Cleaning and maintenance' },
  commissions:       { line: 8,  label: 'Commissions' },
  insurance:         { line: 9,  label: 'Insurance' },
  legal:             { line: 10, label: 'Legal and other professional fees' },
  professional_fees: { line: 10, label: 'Legal and other professional fees' },
  management:        { line: 11, label: 'Management fees' },
  repairs:           { line: 14, label: 'Repairs' },
  supplies:          { line: 15, label: 'Supplies' },
  taxes:             { line: 16, label: 'Taxes' },
  utilities:         { line: 17, label: 'Utilities' },
  hoa:               { line: 19, label: 'Other' },
  software:          { line: 19, label: 'Other' },
  payroll:           { line: 19, label: 'Other' },
  other_expense:     { line: 19, label: 'Other' },
};
// Recorded, but not a Schedule E expense line.
const NOT_A_SCHEDULE_E_EXPENSE = {
  mortgage: 'Mortgage payments mix principal and interest. Schedule E line 12 wants interest only - split them from your lender statement.',
  capex:    'Capital improvements are not an expense: they are added to basis and depreciated (line 18).',
};

const IRS_1099_THRESHOLD = 600;

function yearRange(year) {
  const y = parseInt(year, 10);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw Object.assign(new Error('year must be a four-digit year'), { status: 400 });
  return { from: `${y}-01-01`, to: `${y}-12-31`, year: y };
}

async function ledger(userId, { from, to, propertyId = null, dealId = null } = {}) {
  let q = supabase.from('portfolio_transactions')
    .select('id, occurred_on, direction, category, amount, memo, property_id, deal_id, vendor_id')
    .eq('user_id', userId).order('occurred_on', { ascending: false }).limit(10000);
  if (from) q = q.gte('occurred_on', from);
  if (to) q = q.lte('occurred_on', to);
  if (propertyId) q = q.eq('property_id', propertyId);
  if (dealId) q = q.eq('deal_id', dealId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/** Profit and loss for a period, split by where the money came from and went. */
async function profitAndLoss(userId, { from, to } = {}) {
  const [rows, props, deals] = await Promise.all([
    ledger(userId, { from, to }),
    supabase.from('portfolio_properties').select('id, address').eq('user_id', userId),
    supabase.from('deals').select('id, property_address, status, assignment_fee, fee_collected_amount, fee_collected_at').eq('user_id', userId).limit(2000),
  ]);
  if (props.error) throw props.error;
  if (deals.error) throw deals.error;
  const propName = Object.fromEntries((props.data || []).map(p => [p.id, p.address]));
  const dealName = Object.fromEntries((deals.data || []).map(d => [d.id, d.property_address]));

  const income = {}, expense = {};
  let incomeTotal = 0, expenseTotal = 0, capexTotal = 0, debtTotal = 0;
  const byScope = { properties: { income: 0, expense: 0 }, deals: { income: 0, expense: 0 }, overhead: { income: 0, expense: 0 } };
  const byProperty = {}, byDeal = {};

  for (const r of rows) {
    const amt = MONEY(r.amount);
    const scope = r.property_id ? 'properties' : r.deal_id ? 'deals' : 'overhead';
    if (r.direction === 'income') {
      income[r.category] = round((income[r.category] || 0) + amt);
      incomeTotal += amt; byScope[scope].income += amt;
    } else {
      expense[r.category] = round((expense[r.category] || 0) + amt);
      if (r.category === 'capex') capexTotal += amt;
      else if (r.category === 'mortgage') debtTotal += amt;
      else { expenseTotal += amt; byScope[scope].expense += amt; }
    }
    if (r.property_id) {
      const b = (byProperty[r.property_id] = byProperty[r.property_id] || { name: propName[r.property_id] || 'Property', income: 0, expense: 0 });
      r.direction === 'income' ? (b.income += amt) : (b.expense += amt);
    }
    if (r.deal_id) {
      const b = (byDeal[r.deal_id] = byDeal[r.deal_id] || { name: dealName[r.deal_id] || 'Deal', income: 0, expense: 0 });
      r.direction === 'income' ? (b.income += amt) : (b.expense += amt);
    }
  }

  // Fees recorded on a closed deal but never entered in the books, so the P&L is
  // not quietly missing income the operator already knows about.
  const recordedDealIncome = new Set(rows.filter(r => r.direction === 'income' && r.deal_id).map(r => r.deal_id));
  const unrecorded = (deals.data || [])
    .filter(d => !recordedDealIncome.has(d.id))
    .map(d => ({ deal_id: d.id, address: d.property_address, amount: MONEY(d.fee_collected_amount) || MONEY(d.assignment_fee), collected_at: d.fee_collected_at }))
    .filter(d => d.amount > 0 && (!from || !d.collected_at || d.collected_at.slice(0, 10) >= from) && (!to || !d.collected_at || d.collected_at.slice(0, 10) <= to));

  const fmt = (o) => Object.entries(o).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
  return {
    period: { from: from || null, to: to || null },
    income: fmt(income),
    expenses: fmt(expense),
    totals: {
      income: round(incomeTotal),
      operating_expenses: round(expenseTotal),
      net_operating: round(incomeTotal - expenseTotal),
      debt_payments: round(debtTotal),
      capital_improvements: round(capexTotal),
      net_after_debt: round(incomeTotal - expenseTotal - debtTotal),
    },
    by_scope: {
      properties: { income: round(byScope.properties.income), expense: round(byScope.properties.expense), net: round(byScope.properties.income - byScope.properties.expense) },
      deals: { income: round(byScope.deals.income), expense: round(byScope.deals.expense), net: round(byScope.deals.income - byScope.deals.expense) },
      overhead: { income: round(byScope.overhead.income), expense: round(byScope.overhead.expense), net: round(byScope.overhead.income - byScope.overhead.expense) },
    },
    by_property: Object.entries(byProperty).map(([id, v]) => ({ property_id: id, ...v, income: round(v.income), expense: round(v.expense), net: round(v.income - v.expense) })).sort((a, b) => b.net - a.net),
    by_deal: Object.entries(byDeal).map(([id, v]) => ({ deal_id: id, ...v, income: round(v.income), expense: round(v.expense), net: round(v.income - v.expense) })).sort((a, b) => b.net - a.net),
    fees_not_in_the_books: unrecorded,
    notes: [
      'Capital improvements and mortgage payments are listed separately: neither is an operating expense.',
      'Entries with no property and no deal are counted as business overhead.',
    ],
  };
}

/** Schedule E style summary per property for a tax year. */
async function scheduleE(userId, year) {
  const { from, to, year: y } = yearRange(year);
  const [rows, props] = await Promise.all([
    ledger(userId, { from, to }),
    supabase.from('portfolio_properties').select('id, address, city, state, zip, units_count, purchase_date, purchase_price, status').eq('user_id', userId),
  ]);
  if (props.error) throw props.error;

  const properties = (props.data || []).map((p) => {
    const mine = rows.filter(r => r.property_id === p.id);
    const rents = mine.filter(r => r.direction === 'income').reduce((a, r) => a + MONEY(r.amount), 0);
    const lines = {};
    const excluded = [];
    for (const r of mine.filter(x => x.direction === 'expense')) {
      const map = SCHEDULE_E_LINES[r.category];
      if (!map) {
        const why = NOT_A_SCHEDULE_E_EXPENSE[r.category] || 'Not mapped to a Schedule E line.';
        const e = excluded.find(x => x.category === r.category) || (excluded.push({ category: r.category, amount: 0, why }), excluded[excluded.length - 1]);
        e.amount = round(e.amount + MONEY(r.amount));
        continue;
      }
      const key = `${map.line}`;
      lines[key] = lines[key] || { line: map.line, label: map.label, amount: 0 };
      lines[key].amount = round(lines[key].amount + MONEY(r.amount));
    }
    const expenseTotal = Object.values(lines).reduce((a, l) => a + l.amount, 0);
    return {
      property_id: p.id,
      address: [p.address, p.city, p.state, p.zip].filter(Boolean).join(', '),
      units: p.units_count,
      placed_in_service: p.purchase_date || null,
      rents_received: round(rents),
      expense_lines: Object.values(lines).sort((a, b) => a.line - b.line),
      total_expenses_claimed: round(expenseTotal),
      net_before_depreciation: round(rents - expenseTotal),
      not_included: excluded,
      depreciation: {
        amount: null,
        why: 'Not calculated: depreciation needs the cost basis, the in-service date and a method. Your accountant computes line 18.',
        basis_hint: p.purchase_price ? `Purchase price on record: ${p.purchase_price}. Land is not depreciable, so the building portion must be separated.` : null,
      },
    };
  }).filter(p => p.rents_received || p.total_expenses_claimed || p.not_included.length);

  return {
    year: y,
    properties,
    totals: {
      rents_received: round(properties.reduce((a, p) => a + p.rents_received, 0)),
      expenses_claimed: round(properties.reduce((a, p) => a + p.total_expenses_claimed, 0)),
      net_before_depreciation: round(properties.reduce((a, p) => a + p.net_before_depreciation, 0)),
    },
    caveats: [
      'This is a summary of what you recorded, not tax advice or a filed return. Give it to your accountant.',
      'Mortgage payments are not split into principal and interest here: Schedule E line 12 wants interest only.',
      'Depreciation (line 18) is not computed.',
      'Only properties with recorded money for the year are listed.',
    ],
  };
}

/** What each vendor was paid in a year, and who needs a 1099. */
async function vendorPayments(userId, year) {
  const { from, to, year: y } = yearRange(year);
  const [rows, vendors] = await Promise.all([
    ledger(userId, { from, to }),
    supabase.from('vendors').select('*').eq('user_id', userId),
  ]);
  if (vendors.error) throw vendors.error;

  const paid = {};
  for (const r of rows) {
    if (r.direction !== 'expense' || !r.vendor_id) continue;
    paid[r.vendor_id] = round((paid[r.vendor_id] || 0) + MONEY(r.amount));
  }
  const list = (vendors.data || []).map(v => {
    const amount = paid[v.id] || 0;
    const overThreshold = amount >= IRS_1099_THRESHOLD;
    const needs1099 = overThreshold && v.issues_1099 !== false;
    return {
      vendor_id: v.id, name: v.name, trade: v.trade, entity_type: v.entity_type,
      paid_this_year: amount,
      w9_on_file: !!v.w9_on_file,
      needs_1099: needs1099,
      action: needs1099 && !v.w9_on_file ? 'Collect a W-9 before you file' : needs1099 ? 'Issue a 1099-NEC' : null,
    };
  }).sort((a, b) => b.paid_this_year - a.paid_this_year);

  const unassigned = round(rows.filter(r => r.direction === 'expense' && !r.vendor_id).reduce((a, r) => a + MONEY(r.amount), 0));
  return {
    year: y,
    threshold: IRS_1099_THRESHOLD,
    vendors: list,
    needing_1099: list.filter(v => v.needs_1099).length,
    missing_w9: list.filter(v => v.needs_1099 && !v.w9_on_file).length,
    expenses_without_a_vendor: unassigned,
    caveats: [
      `Anyone you paid ${IRS_1099_THRESHOLD} or more for services in the year generally needs a 1099-NEC; corporations are usually exempt.`,
      'Only payments recorded in your books with a vendor attached are counted.',
      'Tax identification numbers are never stored here - keep the W-9 itself in your records.',
    ],
  };
}

/** Rows for a spreadsheet: the full ledger with the names spelled out. */
async function ledgerExport(userId, { from, to } = {}) {
  const [rows, props, deals, vendors] = await Promise.all([
    ledger(userId, { from, to }),
    supabase.from('portfolio_properties').select('id, address').eq('user_id', userId),
    supabase.from('deals').select('id, property_address').eq('user_id', userId).limit(2000),
    supabase.from('vendors').select('id, name').eq('user_id', userId),
  ]);
  const pn = Object.fromEntries((props.data || []).map(p => [p.id, p.address]));
  const dn = Object.fromEntries((deals.data || []).map(d => [d.id, d.property_address]));
  const vn = Object.fromEntries((vendors.data || []).map(v => [v.id, v.name]));
  return rows.map(r => ({
    date: r.occurred_on,
    direction: r.direction,
    category: r.category,
    amount: MONEY(r.amount),
    property: r.property_id ? (pn[r.property_id] || '') : '',
    deal: r.deal_id ? (dn[r.deal_id] || '') : '',
    vendor: r.vendor_id ? (vn[r.vendor_id] || '') : '',
    memo: r.memo || '',
  }));
}

/** Minimal, correct CSV: quotes doubled, every field quoted, CRLF line endings. */
function toCsv(rows, headers) {
  const cols = headers || (rows.length ? Object.keys(rows[0]) : []);
  const esc = (v) => `"${String(v === null || v === undefined ? '' : v).replace(/"/g, '""')}"`;
  return [cols.map(esc).join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\r\n');
}

module.exports = {
  profitAndLoss, scheduleE, vendorPayments, ledgerExport, toCsv, ledger,
  SCHEDULE_E_LINES, NOT_A_SCHEDULE_E_EXPENSE, IRS_1099_THRESHOLD, yearRange,
};
