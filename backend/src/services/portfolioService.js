// ─── Portfolio: the hold side of the business ────────────────────────────────
// Leads and deals cover buying. This covers what the operator OWNS afterwards:
// properties, units, leases and the money in and out.
//
// Every number here is computed from recorded rows through the deterministic
// calculation engine - never estimated, never invented. Anything that cannot be
// computed from what the operator entered comes back as null with the reason in
// `missing`, so a blank is always explained rather than filled with a guess.

const supabase = require('../config/supabase');
const core = require('../intelligence/calc/core');

const MONEY = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const sum = (rows, pick) => rows.reduce((a, r) => a + (MONEY(pick(r)) || 0), 0);

// Expense categories that are NOT operating expenses: debt service is handled
// separately (NOI excludes it) and capital work is not an operating cost.
const NON_OPERATING = new Set(['mortgage', 'principal', 'interest', 'debt_service', 'capex', 'capital_improvement', 'purchase', 'rehab']);

const INCOME_CATEGORIES = ['rent', 'late_fee', 'pet_fee', 'application_fee', 'deposit_kept', 'parking', 'laundry', 'other_income'];
const EXPENSE_CATEGORIES = ['mortgage', 'taxes', 'insurance', 'hoa', 'utilities', 'repairs', 'maintenance', 'management', 'turnover', 'landscaping', 'pest', 'legal', 'marketing', 'capex', 'other_expense'];

/** Rent currently contracted for a property: active leases, else nothing (market rent is not income). */
function contractedMonthlyRent(leases) {
  return sum(leases.filter(l => l.status === 'active'), l => l.monthly_rent);
}

/**
 * Per-property figures over a trailing window of recorded transactions.
 * @param {object} p        property row
 * @param {object[]} leases leases for this property
 * @param {object[]} tx     transactions for this property inside the window
 * @param {number} months   window length used to annualise
 */
function propertyMetrics(p, leases, tx, months = 12) {
  const missing = [];
  const income = tx.filter(t => t.direction === 'income');
  const expenses = tx.filter(t => t.direction === 'expense');
  const operating = expenses.filter(t => !NON_OPERATING.has(String(t.category)));

  const windowIncome = sum(income, t => t.amount);
  const windowOperating = sum(operating, t => t.amount);
  const scale = 12 / months;

  const value = MONEY(p.current_value);
  const loan = MONEY(p.loan_balance);
  const payment = MONEY(p.loan_payment);
  const rent = contractedMonthlyRent(leases);

  // Annualised from what is recorded. With no transactions recorded, income falls
  // back to contracted rent (a signed lease is a recorded fact), and that is said.
  let annualIncome = tx.length ? core.round2(windowIncome * scale) : (rent ? core.round2(rent * 12) : null);
  const incomeBasis = tx.length ? `recorded income over the last ${months} months` : (rent ? 'contracted rent on active leases' : null);
  if (annualIncome === null) missing.push({ item: 'income', why: 'No active lease and no recorded income.', how: 'Add a lease or log rent received.' });

  const annualOperating = expenses.length ? core.round2(windowOperating * scale) : null;
  if (annualOperating === null) missing.push({ item: 'operating expenses', why: 'No expenses recorded, so NOI and cap rate cannot be trusted.', how: 'Log taxes, insurance, repairs and management as they are paid.' });

  let noi = null, capRatePct = null, dscrValue = null, cashOnCashPct = null;
  if (annualIncome !== null && annualOperating !== null) {
    noi = core.noi({ gross_annual_income: annualIncome, vacancy_pct: 0, annual_operating_expenses: annualOperating }).output.noi;
    if (value) capRatePct = core.capRate({ noi, value }).output.cap_rate_pct;
    else missing.push({ item: 'current value', why: 'Cap rate needs a current value.', how: 'Set the property value and the date it came from.' });
    if (payment) dscrValue = core.dscr({ annual_noi: noi, annual_debt_service: core.round2(payment * 12) }).output.dscr;
  }

  // Monthly cash flow = income − operating expenses − debt service.
  const monthlyCashFlow = (annualIncome !== null && annualOperating !== null)
    ? core.round2((annualIncome - annualOperating) / 12 - (payment || 0))
    : null;
  if (payment === null) missing.push({ item: 'loan payment', why: 'Cash flow and DSCR need the monthly payment.', how: 'Add the loan payment (or 0 if the property is owned free and clear).' });

  const cashInvested = [p.purchase_price, p.rehab_cost, p.closing_costs].some(v => MONEY(v) !== null)
    ? core.round2((MONEY(p.purchase_price) || 0) + (MONEY(p.rehab_cost) || 0) + (MONEY(p.closing_costs) || 0) - (MONEY(p.purchase_price) !== null && loan !== null ? loan : 0))
    : null;
  if (monthlyCashFlow !== null && cashInvested && cashInvested > 0) {
    cashOnCashPct = core.cashOnCash({ annual_pre_tax_cash_flow: core.round2(monthlyCashFlow * 12), total_cash_invested: cashInvested }).output.cash_on_cash_pct;
  }

  const equity = value !== null && loan !== null ? core.round2(value - loan) : null;
  if (equity === null) missing.push({ item: 'equity', why: 'Equity needs both a current value and the loan balance.', how: 'Fill in the value and the loan balance.' });

  const occupiedUnits = leases.filter(l => l.status === 'active').length;
  const occupancyPct = p.units_count ? core.round2((Math.min(occupiedUnits, p.units_count) / p.units_count) * 100) : null;

  return {
    equity,
    current_value: value,
    loan_balance: loan,
    contracted_monthly_rent: rent || null,
    annual_income: annualIncome,
    income_basis: incomeBasis,
    annual_operating_expenses: annualOperating,
    noi,
    cap_rate_pct: capRatePct,
    dscr: dscrValue,
    monthly_cash_flow: monthlyCashFlow,
    cash_invested: cashInvested,
    cash_on_cash_pct: cashOnCashPct,
    occupancy_pct: occupancyPct,
    occupied_units: occupiedUnits,
    transactions_in_window: tx.length,
    missing,
  };
}

/** Whole portfolio: every owned property with its figures, plus totals. */
async function summary(userId, { months = 12 } = {}) {
  const since = new Date(Date.now() - months * 30.44 * 86400000).toISOString().slice(0, 10);
  const [props, leases, tx] = await Promise.all([
    supabase.from('portfolio_properties').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    supabase.from('portfolio_leases').select('*').eq('user_id', userId),
    supabase.from('portfolio_transactions').select('*').eq('user_id', userId).gte('occurred_on', since),
  ]);
  for (const r of [props, leases, tx]) if (r.error) throw r.error;

  const byProperty = (rows, id) => (rows || []).filter(r => r.property_id === id);
  const properties = (props.data || []).map(p => ({
    ...p,
    metrics: propertyMetrics(p, byProperty(leases.data, p.id), byProperty(tx.data, p.id), months),
  }));

  const owned = properties.filter(p => p.status !== 'sold');
  const totals = {
    properties: owned.length,
    units: owned.reduce((a, p) => a + (p.units_count || 0), 0),
    portfolio_value: core.round2(owned.reduce((a, p) => a + (p.metrics.current_value || 0), 0)) || null,
    total_debt: core.round2(owned.reduce((a, p) => a + (p.metrics.loan_balance || 0), 0)) || null,
    total_equity: core.round2(owned.reduce((a, p) => a + (p.metrics.equity || 0), 0)) || null,
    monthly_rent: core.round2(owned.reduce((a, p) => a + (p.metrics.contracted_monthly_rent || 0), 0)) || null,
    monthly_cash_flow: core.round2(owned.reduce((a, p) => a + (p.metrics.monthly_cash_flow || 0), 0)) || null,
    annual_noi: core.round2(owned.reduce((a, p) => a + (p.metrics.noi || 0), 0)) || null,
    properties_missing_data: owned.filter(p => p.metrics.missing.length).length,
  };
  // Portfolio cap rate only means something when every property has a value and NOI.
  const complete = owned.filter(p => p.metrics.noi !== null && p.metrics.current_value);
  totals.cap_rate_pct = complete.length === owned.length && totals.portfolio_value
    ? core.capRate({ noi: totals.annual_noi, value: totals.portfolio_value }).output.cap_rate_pct
    : null;
  totals.cap_rate_note = totals.cap_rate_pct === null ? 'Shown once every property has a current value and recorded expenses.' : null;

  return { properties, totals, window_months: months };
}

/** Month-by-month income, expenses and cash flow for one property (or the whole portfolio). */
async function cashFlowSeries(userId, { propertyId = null, months = 12 } = {}) {
  const start = new Date(); start.setDate(1); start.setMonth(start.getMonth() - (months - 1));
  const since = start.toISOString().slice(0, 10);
  let q = supabase.from('portfolio_transactions').select('occurred_on, direction, category, amount, property_id')
    .eq('user_id', userId).gte('occurred_on', since);
  if (propertyId) q = q.eq('property_id', propertyId);
  const { data, error } = await q;
  if (error) throw error;

  const buckets = new Map();
  for (let i = 0; i < months; i++) {
    const d = new Date(start); d.setMonth(start.getMonth() + i);
    buckets.set(d.toISOString().slice(0, 7), { month: d.toISOString().slice(0, 7), income: 0, operating_expenses: 0, debt_service: 0 });
  }
  for (const t of data || []) {
    const key = String(t.occurred_on).slice(0, 7);
    const b = buckets.get(key);
    if (!b) continue;
    const amt = MONEY(t.amount) || 0;
    if (t.direction === 'income') b.income += amt;
    else if (NON_OPERATING.has(String(t.category))) b.debt_service += amt;
    else b.operating_expenses += amt;
  }
  return [...buckets.values()].map(b => ({
    ...b,
    income: core.round2(b.income),
    operating_expenses: core.round2(b.operating_expenses),
    debt_service: core.round2(b.debt_service),
    net: core.round2(b.income - b.operating_expenses - b.debt_service),
  }));
}

/** Leases ending within `days`, so renewals are never a surprise. */
async function expiringLeases(userId, days = 90) {
  const until = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const { data, error } = await supabase.from('portfolio_leases')
    .select('id, property_id, unit_id, tenant_name, end_date, monthly_rent, status')
    .eq('user_id', userId).eq('status', 'active').not('end_date', 'is', null).lte('end_date', until)
    .order('end_date', { ascending: true }).limit(100);
  if (error) throw error;
  return data || [];
}

/** Turn a closed deal into an owned property, carrying over what the deal already knows. */
async function fromDeal(userId, dealId) {
  const { data: deal, error } = await supabase.from('deals')
    .select('id, lead_id, property_address, property_city, property_state, property_zip, seller_agreed_price, repair_estimate, arv, status, closing_date')
    .eq('id', dealId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!deal) { const e = new Error('Deal not found'); e.status = 404; throw e; }

  const { data: existing } = await supabase.from('portfolio_properties').select('id').eq('user_id', userId).eq('deal_id', dealId).maybeSingle();
  if (existing) { const e = new Error('This deal is already in your portfolio'); e.status = 409; throw e; }

  const row = {
    user_id: userId, deal_id: deal.id, lead_id: deal.lead_id,
    address: deal.property_address || 'Address not recorded',
    city: deal.property_city, state: deal.property_state, zip: deal.property_zip,
    purchase_price: deal.seller_agreed_price, rehab_cost: deal.repair_estimate,
    current_value: deal.arv, value_as_of: deal.closing_date || null,
    value_source: deal.arv ? 'ARV from the deal at closing' : null,
    purchase_date: deal.closing_date || null,
    status: 'owned', strategy: 'rental', units_count: 1,
  };
  const { data, error: insErr } = await supabase.from('portfolio_properties').insert(row).select('*').single();
  if (insErr) throw insErr;
  return data;
}

module.exports = {
  summary, cashFlowSeries, expiringLeases, fromDeal, propertyMetrics,
  INCOME_CATEGORIES, EXPENSE_CATEGORIES, NON_OPERATING,
};
