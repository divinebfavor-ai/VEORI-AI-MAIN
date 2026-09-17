// Run with:  node --test src/__tests__/
//
// Deterministic calculation engine: every figure checked against an independent
// hand calculation or a published standard value.

const test = require('node:test');
const assert = require('node:assert');
const core = require('../intelligence/calc/core');
const S = require('../intelligence/calc/strategies');
const BE = require('../intelligence/calc/breakEven');

const near = (actual, expected, tol = 0.01, msg) => assert.ok(Math.abs(actual - expected) <= tol, `${msg || ''} expected ${expected}, got ${actual}`);

test('mortgage payment matches standard tables and exposes inputs/formula', () => {
  const r = core.monthlyPayment({ principal: 200000, annual_rate_pct: 6, term_months: 360 });
  assert.strictEqual(r.output.monthly_payment, 1199.1);
  assert.deepStrictEqual(Object.keys(r).sort(), ['assumptions', 'formula', 'inputs', 'name', 'output']);
  assert.strictEqual(core.monthlyPayment({ principal: 150000, annual_rate_pct: 7, term_months: 360 }).output.monthly_payment, 997.95);
  assert.strictEqual(core.monthlyPayment({ principal: 100000, annual_rate_pct: 0, term_months: 120 }).output.monthly_payment, 833.33);
});

test('invalid inputs throw instead of producing a number', () => {
  assert.throws(() => core.monthlyPayment({ principal: 'abc', annual_rate_pct: 6, term_months: 360 }), core.CalcError);
  assert.throws(() => core.monthlyPayment({ principal: 1000, annual_rate_pct: 6 }), /term_months is required/);
  assert.throws(() => core.monthlyPayment({ principal: 1000, annual_rate_pct: 6, term_months: 12.5 }), /whole number/);
  assert.throws(() => S.sellerFinance({ purchase_price: 100, down_payment: 200, rate_pct: 5, amortization_months: 12 }), /cannot exceed/);
});

test('amortization: balance reaches zero and interest equals payments minus principal', () => {
  const a = core.amortizationSchedule({ principal: 200000, annual_rate_pct: 6, term_months: 360 });
  assert.strictEqual(a.output.ending_balance, 0);
  near(a.output.total_interest, 1199.1 * 360 - 200000, 5, 'total interest');
  assert.strictEqual(core.remainingBalance({ principal: 200000, annual_rate_pct: 6, term_months: 360, payments_made: 360 }).output.balance, 0);
  const b60 = core.remainingBalance({ principal: 200000, annual_rate_pct: 6, term_months: 360, payments_made: 60 }).output.balance;
  near(b60, a.output.schedule ? core.amortizationSchedule({ principal: 200000, annual_rate_pct: 6, term_months: 360, months: 60 }).output.ending_balance : 0, 1, 'balance at 60');
});

test('NOI, cap rate, DSCR, LTV, cash-on-cash', () => {
  const n = core.noi({ gross_annual_income: 120000, vacancy_pct: 5, annual_operating_expenses: 40000 });
  assert.strictEqual(n.output.effective_gross_income, 114000);
  assert.strictEqual(n.output.noi, 74000);
  assert.strictEqual(core.capRate({ noi: 74000, value: 1000000 }).output.cap_rate_pct, 7.4);
  assert.strictEqual(core.valueFromCapRate({ noi: 74000, cap_rate_pct: 7.4 }).output.value, 1000000);
  assert.strictEqual(core.dscr({ annual_noi: 125000, annual_debt_service: 100000 }).output.dscr, 1.25);
  assert.strictEqual(core.dscr({ annual_noi: 125000, annual_debt_service: 0 }).output.dscr, null);
  assert.strictEqual(core.ltv({ loan_amount: 75000, value: 100000 }).output.ltv_pct, 75);
  assert.strictEqual(core.cashOnCash({ annual_pre_tax_cash_flow: 5000, total_cash_invested: 50000 }).output.cash_on_cash_pct, 10);
});

test('IRR: known answers, and undefined when there is no sign change', () => {
  assert.strictEqual(core.irr({ cash_flows: [-1000, 1100], periods_per_year: 1 }).output.irr_annual_pct, 10);
  near(core.irr({ cash_flows: [-100, 0, 121], periods_per_year: 1 }).output.irr_annual_pct, 10, 0.001);
  const monthly = core.irr({ cash_flows: [-1000, ...Array(11).fill(0), 1120], periods_per_year: 12 });
  near(monthly.output.irr_annual_pct, 12, 0.01);
  assert.strictEqual(core.irr({ cash_flows: [100, 200] }).output.irr_annual_pct, null);
  near(core.npv({ rate_pct_per_period: 10, cash_flows: [-1000, 1100] }).output.npv, 0, 0.001);
});

test('wholesale MAO and defaults are disclosed as assumptions', () => {
  const m = S.wholesaleMao({ arv: 200000, repairs: 30000, flip_factor_pct: 70, assignment_fee: 10000, closing_holding_buffer: 5000 });
  assert.strictEqual(m.output.end_buyer_max_price, 110000);
  assert.strictEqual(m.output.mao, 95000);
  const d = S.wholesaleMao({ arv: 200000, repairs: 30000 });
  assert.strictEqual(d.output.mao, 110000);
  assert.ok(d.assumptions.some(a => /default 70/.test(a)));
  assert.strictEqual(S.assignmentFee({ contract_price: 95000, buyer_price: 110000 }).output.assignment_fee, 15000);
});

test('fix & flip profit and ROI', () => {
  const f = S.fixFlip({ purchase_price: 150000, sale_price: 250000, rehab: 40000, holding_months: 6, monthly_holding: 1000, buy_closing_pct: 2, sell_cost_pct: 8, loan_amount: 120000, loan_rate_pct: 12, loan_points_pct: 2 });
  assert.strictEqual(f.output.financing_costs, 9600);
  assert.strictEqual(f.output.total_cost, 228600);
  assert.strictEqual(f.output.profit, 21400);
  assert.strictEqual(f.output.cash_invested, 88600);
  near(f.output.roi_pct, 24.1535, 0.001);
});

test('buy & hold: payment, NOI, cash flow, CoC, DSCR', () => {
  const b = S.buyHold({ purchase_price: 200000, down_payment_pct: 25, loan_rate_pct: 7, loan_term_months: 360, monthly_rent: 2000, vacancy_pct: 5, management_pct: 8, maintenance_pct: 5, capex_pct: 5, monthly_taxes: 250, monthly_insurance: 100 });
  assert.strictEqual(b.output.loan_amount, 150000);
  assert.strictEqual(b.output.monthly_principal_interest, 997.95);
  assert.strictEqual(b.output.monthly_noi, 1190);
  assert.strictEqual(b.output.monthly_cash_flow, 192.05);
  near(b.output.cash_on_cash_pct, 4.6092, 0.001);
  near(b.output.dscr, 1.1924, 0.001);
});

test('BRRRR, double close, subject-to, lease option', () => {
  const r = S.brrrr({ purchase_price: 100000, rehab: 40000, acquisition_closing_costs: 3000, holding_costs: 2000, arv: 200000, refi_ltv_pct: 75, refi_rate_pct: 7, refi_closing_costs: 4000, monthly_rent: 1800, vacancy_pct: 5, monthly_operating_expenses: 500 });
  assert.strictEqual(r.output.all_in_cost, 145000);
  assert.strictEqual(r.output.refi_loan, 150000);
  assert.strictEqual(r.output.cash_left_in_deal, -1000);
  assert.strictEqual(r.output.all_capital_recovered, true);
  assert.strictEqual(r.output.equity_remaining, 50000);

  const dc = S.doubleClose({ ab_purchase_price: 100000, bc_sale_price: 130000, ab_closing_costs: 2000, bc_closing_costs: 3000, funding_fee_pct: 2 });
  assert.strictEqual(dc.output.transactional_funding_cost, 2000);
  assert.strictEqual(dc.output.net_profit, 23000);

  const st = S.subjectTo({ purchase_price: 180000, existing_loan_balance: 160000, existing_monthly_piti: 1300, arrears: 6000, closing_costs: 2500, market_value: 230000, monthly_rent: 1900, monthly_other_expenses: 200 });
  assert.strictEqual(st.output.cash_to_seller, 20000);
  assert.strictEqual(st.output.cash_needed_at_close, 28500);
  assert.strictEqual(st.output.equity_at_purchase, 70000);
  assert.strictEqual(st.output.monthly_spread, 400);
  assert.ok(st.assumptions.some(a => /due-on-sale/.test(a)));

  const lo = S.leaseOption({ purchase_price: 250000, option_fee: 7500, monthly_rent: 2200, monthly_rent_credit: 200, option_months: 24, operator_monthly_cost: 1500 });
  assert.strictEqual(lo.output.total_credits_at_exercise, 12300);
  assert.strictEqual(lo.output.net_price_at_exercise, 237700);
  assert.strictEqual(lo.output.operator_total_cash_flow_over_option, 24300);
});

test('seller finance: payment, balloon and seller yield', () => {
  const sf = S.sellerFinance({ purchase_price: 250000, down_payment: 50000, rate_pct: 6, amortization_months: 360, balloon_month: 60 });
  assert.strictEqual(sf.output.monthly_payment, 1199.1);
  const expectedBalloon = 200000 * Math.pow(1.005, 60) - 1199.1 * (Math.pow(1.005, 60) - 1) / 0.005;
  near(sf.output.balloon_payment, expectedBalloon, 1, 'balloon');
  near(sf.output.seller_annual_yield_pct, (Math.pow(1.005, 12) - 1) * 100, 0.01, 'yield');
  near(sf.output.total_interest_paid, 1199.1 * 60 - (200000 - sf.output.balloon_payment), 1);
});

test('hard money, DSCR max loan, equity waterfall', () => {
  const hm = S.hardMoney({ loan_amount: 200000, rate_pct: 12, points_pct: 2, months: 6, lender_fees: 1500, property_value: 300000 });
  assert.strictEqual(hm.output.total_interest, 12000);
  assert.strictEqual(hm.output.total_financing_cost, 17500);
  assert.strictEqual(hm.output.ltv_pct, 66.6667);

  const dl = S.dscrLoan({ annual_noi: 24000, rate_pct: 0, term_months: 360, min_dscr: 1.25 });
  assert.strictEqual(dl.output.max_loan, 576000);
  const capped = S.dscrLoan({ annual_noi: 24000, rate_pct: 0, term_months: 360, min_dscr: 1.25, property_value: 500000, max_ltv_pct: 75 });
  assert.strictEqual(capped.output.max_loan, 375000);
  assert.strictEqual(capped.output.binding_constraint, 'ltv');

  const w = S.equityWaterfall({ investor_equity: 900000, sponsor_equity: 100000, total_distributions: 1400000, hold_years: 2, preferred_return_pct: 8, sponsor_promote_pct: 20 });
  assert.strictEqual(w.output.preferred_return_paid, 144000);
  assert.strictEqual(w.output.sponsor_promote, 51200);
  assert.strictEqual(w.output.investor_total, 1228320);
  assert.strictEqual(w.output.sponsor_total, 171680);
  assert.strictEqual(w.output.investor_total + w.output.sponsor_total, 1400000);
});

test('break-even points reproduce zero profit / zero cash flow when plugged back in', () => {
  const flip = { purchase_price: 150000, sale_price: 250000, rehab: 40000, holding_months: 6, monthly_holding: 1000, buy_closing_pct: 2, sell_cost_pct: 8, loan_amount: 120000, loan_rate_pct: 12, loan_points_pct: 2 };
  const fb = BE.fixFlipBreakEven(flip);
  for (const p of fb.output.break_even_points) {
    assert.ok(p.reachable, p.label);
    const profit = S.fixFlip({ ...flip, [p.field]: p.value }).output.profit;
    near(profit, 0, 1, p.label);
  }

  const hold = { purchase_price: 200000, down_payment_pct: 25, loan_rate_pct: 7, loan_term_months: 360, monthly_rent: 2000, vacancy_pct: 5, management_pct: 8, maintenance_pct: 5, capex_pct: 5, monthly_taxes: 250, monthly_insurance: 100 };
  const hb = BE.buyHoldBreakEven(hold);
  const rent = hb.output.break_even_points.find(p => p.field === 'monthly_rent');
  near(S.buyHold({ ...hold, monthly_rent: rent.value }).output.monthly_cash_flow, 0, 0.5, 'min rent');
  const occ = hb.output.break_even_points.find(p => p.field === 'occupancy_pct');
  near(S.buyHold({ ...hold, vacancy_pct: 100 - occ.value }).output.monthly_cash_flow, 0, 0.5, 'occupancy');

  const wb = BE.wholesaleBreakEven({ arv: 200000, repairs: 30000, flip_factor_pct: 70, assignment_fee: 10000, closing_holding_buffer: 5000, contract_price: 95000, target_fee: 10000 });
  const arvPt = wb.output.break_even_points.find(p => p.field === 'arv');
  near(S.wholesaleMao({ arv: arvPt.value, repairs: 30000, flip_factor_pct: 70, assignment_fee: 10000, closing_holding_buffer: 5000 }).output.mao, 0, 1);
  assert.strictEqual(wb.output.break_even_points.find(p => p.field === 'buyer_price').value, 105000);
  assert.strictEqual(wb.output.break_even_points.find(p => p.field === 'contract_price').value, 100000);
});
