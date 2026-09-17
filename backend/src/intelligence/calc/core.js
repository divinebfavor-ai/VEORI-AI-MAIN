// ─── Deterministic calculation engine: core ──────────────────────────────────
// All financial math in the intelligence layer happens here, never in model prose.
// Every function returns a Calculation:
//   { name, inputs, formula, output, assumptions }
// so the Deal Room can show exactly how a number was produced.
//
// Units: money in dollars, rates as percentages (7.5 means 7.5%), terms in months
// unless a name says otherwise. Invalid inputs throw CalcError - a wrong number is
// worse than no number.

class CalcError extends Error {
  constructor(message, field) { super(message); this.name = 'CalcError'; this.field = field; }
}

function num(value, field, { min = -Infinity, max = Infinity, integer = false, optional = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return null;
    throw new CalcError(`${field} is required`, field);
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw new CalcError(`${field} must be a number`, field);
  if (integer && !Number.isInteger(n)) throw new CalcError(`${field} must be a whole number`, field);
  if (n < min) throw new CalcError(`${field} must be at least ${min}`, field);
  if (n > max) throw new CalcError(`${field} must be at most ${max}`, field);
  return n;
}

const round2 = (n) => (n === null || n === undefined || !Number.isFinite(n) ? n : Math.round((n + Number.EPSILON) * 100) / 100);
const round4 = (n) => (n === null || n === undefined || !Number.isFinite(n) ? n : Math.round((n + Number.EPSILON) * 10000) / 10000);

function calc(name, inputs, formula, output, assumptions = []) {
  return { name, inputs, formula, output, assumptions };
}

// ── Loans ─────────────────────────────────────────────────────────────────────
function paymentRaw(P, ratePct, n) {
  const r = ratePct / 100 / 12;
  return r === 0 ? P / n : (P * r) / (1 - Math.pow(1 + r, -n));
}

function monthlyPayment({ principal, annual_rate_pct, term_months }) {
  const P = num(principal, 'principal', { min: 0 });
  const rate = num(annual_rate_pct, 'annual_rate_pct', { min: 0, max: 100 });
  const n = num(term_months, 'term_months', { min: 1, integer: true });
  const r = rate / 100 / 12;
  const pmt = paymentRaw(P, rate, n);
  return calc('monthly_payment', { principal: P, annual_rate_pct: rate, term_months: n },
    r === 0 ? 'payment = principal / term_months' : 'payment = P × r / (1 − (1 + r)^−n), r = annual_rate / 12',
    { monthly_payment: round2(pmt) },
    ['Fixed rate, fully amortizing, monthly payments, no escrow (taxes/insurance excluded)']);
}

function interestOnlyPayment({ principal, annual_rate_pct }) {
  const P = num(principal, 'principal', { min: 0 });
  const rate = num(annual_rate_pct, 'annual_rate_pct', { min: 0, max: 100 });
  return calc('interest_only_payment', { principal: P, annual_rate_pct: rate },
    'payment = principal × annual_rate / 12',
    { monthly_payment: round2(P * rate / 100 / 12) },
    ['Interest-only, monthly, no principal reduction']);
}

// Balance after k payments on a fully amortizing loan.
function remainingBalance({ principal, annual_rate_pct, term_months, payments_made }) {
  const P = num(principal, 'principal', { min: 0 });
  const rate = num(annual_rate_pct, 'annual_rate_pct', { min: 0, max: 100 });
  const n = num(term_months, 'term_months', { min: 1, integer: true });
  const k = num(payments_made, 'payments_made', { min: 0, max: n, integer: true });
  const r = rate / 100 / 12;
  const pmt = paymentRaw(P, rate, n); // unrounded, so a fully paid loan ends at exactly 0
  const bal = r === 0 ? P - (P / n) * k : P * Math.pow(1 + r, k) - pmt * (Math.pow(1 + r, k) - 1) / r;
  return calc('remaining_balance', { principal: P, annual_rate_pct: rate, term_months: n, payments_made: k },
    r === 0 ? 'balance = P − (P / n) × k' : 'balance = P(1 + r)^k − payment × ((1 + r)^k − 1) / r',
    { balance: round2(Math.max(0, bal)), monthly_payment: round2(pmt) },
    ['Every scheduled payment made on time, no prepayments']);
}

function amortizationSchedule({ principal, annual_rate_pct, term_months, months = null }) {
  const P = num(principal, 'principal', { min: 0 });
  const rate = num(annual_rate_pct, 'annual_rate_pct', { min: 0, max: 100 });
  const n = num(term_months, 'term_months', { min: 1, max: 600, integer: true });
  const show = months == null ? n : num(months, 'months', { min: 1, max: n, integer: true });
  const r = rate / 100 / 12;
  const pmt = paymentRaw(P, rate, n);
  const rows = [];
  let bal = P;
  let totalInterest = 0;
  for (let m = 1; m <= show; m++) {
    const interest = bal * r;
    let principalPaid = pmt - interest;
    if (m === n || principalPaid > bal) principalPaid = bal; // final payment clears rounding
    bal -= principalPaid;
    totalInterest += interest;
    rows.push({ month: m, payment: round2(interest + principalPaid), interest: round2(interest), principal: round2(principalPaid), balance: round2(Math.max(0, bal)) });
  }
  return calc('amortization_schedule', { principal: P, annual_rate_pct: rate, term_months: n, months: show },
    'each month: interest = balance × r; principal = payment − interest; balance −= principal',
    { monthly_payment: round2(pmt), schedule: rows, total_interest: round2(totalInterest), ending_balance: round2(Math.max(0, bal)) },
    ['Fixed rate, monthly compounding, no prepayments or fees']);
}

// ── Income property ──────────────────────────────────────────────────────────
function noi({ gross_annual_income, vacancy_pct = 0, annual_operating_expenses }) {
  const gpi = num(gross_annual_income, 'gross_annual_income', { min: 0 });
  const v = num(vacancy_pct, 'vacancy_pct', { min: 0, max: 100 });
  const opex = num(annual_operating_expenses, 'annual_operating_expenses', { min: 0 });
  const egi = gpi * (1 - v / 100);
  return calc('noi', { gross_annual_income: gpi, vacancy_pct: v, annual_operating_expenses: opex },
    'EGI = gross × (1 − vacancy); NOI = EGI − operating expenses',
    { effective_gross_income: round2(egi), noi: round2(egi - opex) },
    ['Operating expenses exclude debt service, depreciation and capital expenditures']);
}

function capRate({ noi: n, value }) {
  const NOI = num(n, 'noi');
  const V = num(value, 'value', { min: 0.01 });
  return calc('cap_rate', { noi: NOI, value: V }, 'cap rate = NOI / value',
    { cap_rate_pct: round4((NOI / V) * 100) });
}

function valueFromCapRate({ noi: n, cap_rate_pct }) {
  const NOI = num(n, 'noi');
  const c = num(cap_rate_pct, 'cap_rate_pct', { min: 0.01, max: 100 });
  return calc('value_from_cap_rate', { noi: NOI, cap_rate_pct: c }, 'value = NOI / cap rate',
    { value: round2(NOI / (c / 100)) }, ['Cap rate supplied by the operator or a cited market source']);
}

function dscr({ annual_noi, annual_debt_service }) {
  const N = num(annual_noi, 'annual_noi');
  const D = num(annual_debt_service, 'annual_debt_service', { min: 0 });
  return calc('dscr', { annual_noi: N, annual_debt_service: D }, 'DSCR = NOI / annual debt service',
    { dscr: D === 0 ? null : round4(N / D) },
    D === 0 ? ['No debt service: DSCR is undefined'] : []);
}

function ltv({ loan_amount, value }) {
  const L = num(loan_amount, 'loan_amount', { min: 0 });
  const V = num(value, 'value', { min: 0.01 });
  return calc('ltv', { loan_amount: L, value: V }, 'LTV = loan / value', { ltv_pct: round4((L / V) * 100) });
}

function ltc({ loan_amount, total_cost }) {
  const L = num(loan_amount, 'loan_amount', { min: 0 });
  const C = num(total_cost, 'total_cost', { min: 0.01 });
  return calc('ltc', { loan_amount: L, total_cost: C }, 'LTC = loan / (purchase + rehab + costs)', { ltc_pct: round4((L / C) * 100) });
}

function cashOnCash({ annual_pre_tax_cash_flow, total_cash_invested }) {
  const cf = num(annual_pre_tax_cash_flow, 'annual_pre_tax_cash_flow');
  const inv = num(total_cash_invested, 'total_cash_invested', { min: 0 });
  return calc('cash_on_cash', { annual_pre_tax_cash_flow: cf, total_cash_invested: inv },
    'cash-on-cash = annual pre-tax cash flow / total cash invested',
    { cash_on_cash_pct: inv === 0 ? null : round4((cf / inv) * 100) },
    inv === 0 ? ['No cash invested: cash-on-cash is undefined (infinite)'] : []);
}

function roi({ profit, total_investment }) {
  const p = num(profit, 'profit');
  const inv = num(total_investment, 'total_investment', { min: 0 });
  return calc('roi', { profit: p, total_investment: inv }, 'ROI = profit / total investment',
    { roi_pct: inv === 0 ? null : round4((p / inv) * 100) });
}

// ── Time value ───────────────────────────────────────────────────────────────
function npvRaw(ratePerPeriod, flows) {
  return flows.reduce((sum, cf, t) => sum + cf / Math.pow(1 + ratePerPeriod, t), 0);
}

function npv({ rate_pct_per_period, cash_flows }) {
  const r = num(rate_pct_per_period, 'rate_pct_per_period', { min: -99.99 });
  if (!Array.isArray(cash_flows) || cash_flows.length < 2) throw new CalcError('cash_flows needs at least 2 values', 'cash_flows');
  const flows = cash_flows.map((c, i) => num(c, `cash_flows[${i}]`));
  return calc('npv', { rate_pct_per_period: r, cash_flows: flows }, 'NPV = Σ CF_t / (1 + r)^t, t from 0',
    { npv: round2(npvRaw(r / 100, flows)) });
}

// IRR by bisection: robust, no derivative, finds the root where NPV changes sign.
function irr({ cash_flows, periods_per_year = 12 }) {
  if (!Array.isArray(cash_flows) || cash_flows.length < 2) throw new CalcError('cash_flows needs at least 2 values', 'cash_flows');
  const flows = cash_flows.map((c, i) => num(c, `cash_flows[${i}]`));
  const ppy = num(periods_per_year, 'periods_per_year', { min: 1, max: 365, integer: true });
  const hasNeg = flows.some(f => f < 0);
  const hasPos = flows.some(f => f > 0);
  const base = { cash_flows: flows, periods_per_year: ppy };
  const formula = 'find r where Σ CF_t / (1 + r)^t = 0; annual IRR = (1 + r)^periods_per_year − 1';
  if (!hasNeg || !hasPos) {
    return calc('irr', base, formula, { irr_periodic_pct: null, irr_annual_pct: null },
      ['IRR undefined: cash flows need both an outflow and an inflow']);
  }
  let lo = -0.9999, hi = 10;
  let fLo = npvRaw(lo, flows), fHi = npvRaw(hi, flows);
  if (Math.sign(fLo) === Math.sign(fHi)) {
    return calc('irr', base, formula, { irr_periodic_pct: null, irr_annual_pct: null },
      ['IRR not found in the −99.99% to 1000% per-period range']);
  }
  let mid = 0;
  for (let i = 0; i < 200; i++) {
    mid = (lo + hi) / 2;
    const fMid = npvRaw(mid, flows);
    if (Math.abs(fMid) < 1e-7 || (hi - lo) / 2 < 1e-10) break;
    if (Math.sign(fMid) === Math.sign(fLo)) { lo = mid; fLo = fMid; } else { hi = mid; }
  }
  return calc('irr', base, formula,
    { irr_periodic_pct: round4(mid * 100), irr_annual_pct: round4((Math.pow(1 + mid, ppy) - 1) * 100) },
    ['Cash flows are evenly spaced; non-conventional flows can have more than one IRR - the first root found is reported']);
}

// ── Generic solver ───────────────────────────────────────────────────────────
// Finds x in [lo, hi] where f(x) = target for a monotonic f. Returns null if the
// target is outside f's range over the interval.
function solveMonotonic(f, lo, hi, target = 0, { tolerance = 0.005, xTolerance = 1e-9, maxIterations = 300 } = {}) {
  let a = lo, b = hi;
  let fa = f(a) - target, fb = f(b) - target;
  if (!Number.isFinite(fa) || !Number.isFinite(fb)) return null;
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (Math.sign(fa) === Math.sign(fb)) return null;
  for (let i = 0; i < maxIterations; i++) {
    const m = (a + b) / 2;
    const fm = f(m) - target;
    if (Math.abs(fm) <= tolerance || (b - a) / 2 < xTolerance) return m;
    if (Math.sign(fm) === Math.sign(fa)) { a = m; fa = fm; } else { b = m; }
  }
  return (a + b) / 2;
}

module.exports = {
  paymentRaw, CalcError, num, round2, round4, calc,
  monthlyPayment, interestOnlyPayment, remainingBalance, amortizationSchedule,
  noi, capRate, valueFromCapRate, dscr, ltv, ltc, cashOnCash, roi,
  npv, irr, npvRaw, solveMonotonic,
};
