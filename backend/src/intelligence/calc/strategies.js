// ─── Deterministic calculation engine: strategies ───────────────────────────
// Deal-structure math built on calc/core. Every default is reported back as an
// assumption so the operator can see it and override it.

const core = require('./core');
const { CalcError, num, round2, round4, calc } = core;

function withDefault(value, fallback, field, assumptions, label) {
  if (value === undefined || value === null || value === '') {
    assumptions.push(`${label}: default ${fallback} used (not supplied)`);
    return fallback;
  }
  return num(value, field, { min: 0 });
}

// ── Wholesale ────────────────────────────────────────────────────────────────
function wholesaleMao({ arv, repairs, flip_factor_pct, assignment_fee, closing_holding_buffer }) {
  const assumptions = [];
  const ARV = num(arv, 'arv', { min: 0 });
  const R = num(repairs, 'repairs', { min: 0 });
  const factor = withDefault(flip_factor_pct, 70, 'flip_factor_pct', assumptions, 'Investor buyer percentage of ARV');
  if (factor > 100) throw new CalcError('flip_factor_pct must be at most 100', 'flip_factor_pct');
  const fee = withDefault(assignment_fee, 0, 'assignment_fee', assumptions, 'Assignment fee');
  const buffer = withDefault(closing_holding_buffer, 0, 'closing_holding_buffer', assumptions, 'Closing/holding buffer');
  const buyerMax = ARV * factor / 100 - R;
  const mao = buyerMax - fee - buffer;
  return calc('wholesale_mao', { arv: ARV, repairs: R, flip_factor_pct: factor, assignment_fee: fee, closing_holding_buffer: buffer },
    'end buyer max = ARV × factor − repairs; MAO = end buyer max − assignment fee − buffer',
    { end_buyer_max_price: round2(buyerMax), mao: round2(mao), viable: mao > 0 },
    [...assumptions, 'ARV and repairs are estimates unless verified by sold comps and contractor bids']);
}

function assignmentFee({ contract_price, buyer_price }) {
  const c = num(contract_price, 'contract_price', { min: 0 });
  const b = num(buyer_price, 'buyer_price', { min: 0 });
  return calc('assignment_fee', { contract_price: c, buyer_price: b }, 'fee = buyer price − contract price',
    { assignment_fee: round2(b - c), positive: b - c > 0 });
}

function doubleClose({ ab_purchase_price, bc_sale_price, ab_closing_costs, bc_closing_costs, funding_amount = null, funding_fee_pct = 0, funding_flat_fee = 0 }) {
  const ab = num(ab_purchase_price, 'ab_purchase_price', { min: 0 });
  const bc = num(bc_sale_price, 'bc_sale_price', { min: 0 });
  const abc = num(ab_closing_costs, 'ab_closing_costs', { min: 0 });
  const bcc = num(bc_closing_costs, 'bc_closing_costs', { min: 0 });
  const fundAmt = funding_amount == null ? ab : num(funding_amount, 'funding_amount', { min: 0 });
  const feePct = num(funding_fee_pct, 'funding_fee_pct', { min: 0, max: 100 });
  const flat = num(funding_flat_fee, 'funding_flat_fee', { min: 0 });
  const fundingCost = fundAmt * feePct / 100 + flat;
  const profit = bc - ab - abc - bcc - fundingCost;
  return calc('double_close', { ab_purchase_price: ab, bc_sale_price: bc, ab_closing_costs: abc, bc_closing_costs: bcc, funding_amount: fundAmt, funding_fee_pct: feePct, funding_flat_fee: flat },
    'profit = B-C price − A-B price − both closing costs − transactional funding cost',
    { gross_spread: round2(bc - ab), transactional_funding_cost: round2(fundingCost), total_costs: round2(abc + bcc + fundingCost), net_profit: round2(profit) },
    [funding_amount == null ? 'Transactional funding assumed to cover the full A-B price' : 'Funding amount as supplied']);
}

// ── Holding / closing ────────────────────────────────────────────────────────
function holdingCosts({ months, monthly_taxes = 0, monthly_insurance = 0, monthly_utilities = 0, monthly_interest = 0, monthly_other = 0 }) {
  const m = num(months, 'months', { min: 0 });
  const parts = {
    monthly_taxes: num(monthly_taxes, 'monthly_taxes', { min: 0 }),
    monthly_insurance: num(monthly_insurance, 'monthly_insurance', { min: 0 }),
    monthly_utilities: num(monthly_utilities, 'monthly_utilities', { min: 0 }),
    monthly_interest: num(monthly_interest, 'monthly_interest', { min: 0 }),
    monthly_other: num(monthly_other, 'monthly_other', { min: 0 }),
  };
  const monthly = Object.values(parts).reduce((a, b) => a + b, 0);
  return calc('holding_costs', { months: m, ...parts }, 'holding = months × (taxes + insurance + utilities + interest + other)',
    { monthly_holding_cost: round2(monthly), total_holding_cost: round2(monthly * m) });
}

function closingCosts({ price, pct = null, flat = 0 }) {
  const p = num(price, 'price', { min: 0 });
  const assumptions = [];
  const rate = pct == null ? (assumptions.push('No closing cost % supplied: 0% used - supply a local figure'), 0) : num(pct, 'pct', { min: 0, max: 100 });
  const f = num(flat, 'flat', { min: 0 });
  return calc('closing_costs', { price: p, pct: rate, flat: f }, 'closing costs = price × pct + flat',
    { closing_costs: round2(p * rate / 100 + f) }, assumptions);
}

// ── Fix & flip ───────────────────────────────────────────────────────────────
function fixFlip(input) {
  const i = {
    purchase_price: num(input.purchase_price, 'purchase_price', { min: 0 }),
    sale_price: num(input.sale_price, 'sale_price', { min: 0 }),
    rehab: num(input.rehab, 'rehab', { min: 0 }),
    holding_months: num(input.holding_months, 'holding_months', { min: 0 }),
    monthly_holding: num(input.monthly_holding ?? 0, 'monthly_holding', { min: 0 }),
    buy_closing_pct: num(input.buy_closing_pct ?? 0, 'buy_closing_pct', { min: 0, max: 100 }),
    sell_cost_pct: num(input.sell_cost_pct ?? 0, 'sell_cost_pct', { min: 0, max: 100 }),
    loan_amount: num(input.loan_amount ?? 0, 'loan_amount', { min: 0 }),
    loan_rate_pct: num(input.loan_rate_pct ?? 0, 'loan_rate_pct', { min: 0, max: 100 }),
    loan_points_pct: num(input.loan_points_pct ?? 0, 'loan_points_pct', { min: 0, max: 100 }),
  };
  const assumptions = [];
  if (input.sell_cost_pct == null) assumptions.push('Selling costs not supplied: 0% used - agent commission and seller closing costs are usually material');
  if (input.buy_closing_pct == null) assumptions.push('Purchase closing costs not supplied: 0% used');
  if (input.monthly_holding == null) assumptions.push('Monthly holding costs (taxes, insurance, utilities) not supplied: $0 used');
  const buyClosing = i.purchase_price * i.buy_closing_pct / 100;
  const sellCosts = i.sale_price * i.sell_cost_pct / 100;
  const holding = i.monthly_holding * i.holding_months;
  const interest = i.loan_amount * i.loan_rate_pct / 100 / 12 * i.holding_months;
  const points = i.loan_amount * i.loan_points_pct / 100;
  const financing = interest + points;
  const totalCost = i.purchase_price + i.rehab + buyClosing + holding + financing + sellCosts;
  const profit = i.sale_price - totalCost;
  const cashInvested = i.purchase_price + i.rehab + buyClosing + holding + financing - i.loan_amount;
  const roiPct = cashInvested > 0 ? (profit / cashInvested) * 100 : null;
  const annualized = roiPct != null && i.holding_months > 0 ? (Math.pow(1 + profit / cashInvested, 12 / i.holding_months) - 1) * 100 : null;
  return calc('fix_flip', i,
    'profit = sale − (purchase + rehab + buy closing + holding + interest + points + selling costs); cash invested = costs before sale − loan',
    {
      buy_closing_costs: round2(buyClosing), holding_costs: round2(holding), financing_costs: round2(financing),
      selling_costs: round2(sellCosts), total_cost: round2(totalCost), profit: round2(profit),
      cash_invested: round2(cashInvested), roi_pct: round4(roiPct), annualized_roi_pct: annualized == null || !Number.isFinite(annualized) ? null : round4(annualized),
      profit_margin_pct: i.sale_price > 0 ? round4((profit / i.sale_price) * 100) : null,
    },
    [...assumptions, 'Interest-only financing, charged for the full holding period; no taxes on profit']);
}

// ── Rental (buy & hold) ──────────────────────────────────────────────────────
function buyHold(input) {
  const assumptions = [];
  const i = {
    purchase_price: num(input.purchase_price, 'purchase_price', { min: 0 }),
    down_payment_pct: num(input.down_payment_pct, 'down_payment_pct', { min: 0, max: 100 }),
    loan_rate_pct: num(input.loan_rate_pct, 'loan_rate_pct', { min: 0, max: 100 }),
    loan_term_months: num(input.loan_term_months ?? 360, 'loan_term_months', { min: 1, integer: true }),
    closing_costs: num(input.closing_costs ?? 0, 'closing_costs', { min: 0 }),
    initial_rehab: num(input.initial_rehab ?? 0, 'initial_rehab', { min: 0 }),
    monthly_rent: num(input.monthly_rent, 'monthly_rent', { min: 0 }),
    other_monthly_income: num(input.other_monthly_income ?? 0, 'other_monthly_income', { min: 0 }),
    vacancy_pct: num(input.vacancy_pct, 'vacancy_pct', { min: 0, max: 100 }),
    management_pct: num(input.management_pct ?? 0, 'management_pct', { min: 0, max: 100 }),
    maintenance_pct: num(input.maintenance_pct ?? 0, 'maintenance_pct', { min: 0, max: 100 }),
    capex_pct: num(input.capex_pct ?? 0, 'capex_pct', { min: 0, max: 100 }),
    monthly_taxes: num(input.monthly_taxes, 'monthly_taxes', { min: 0 }),
    monthly_insurance: num(input.monthly_insurance, 'monthly_insurance', { min: 0 }),
    monthly_hoa: num(input.monthly_hoa ?? 0, 'monthly_hoa', { min: 0 }),
    monthly_other_expenses: num(input.monthly_other_expenses ?? 0, 'monthly_other_expenses', { min: 0 }),
  };
  if (input.loan_term_months == null) assumptions.push('Loan term not supplied: 360 months used');
  for (const k of ['management_pct', 'maintenance_pct', 'capex_pct']) if (input[k] == null) assumptions.push(`${k} not supplied: 0% used`);
  const loan = i.purchase_price * (1 - i.down_payment_pct / 100);
  const pi = monthlyPayment(loan, i.loan_rate_pct, i.loan_term_months);
  const grossMonthly = i.monthly_rent + i.other_monthly_income;
  const effective = grossMonthly * (1 - i.vacancy_pct / 100);
  const pctExpenses = i.monthly_rent * (i.management_pct + i.maintenance_pct + i.capex_pct) / 100;
  const opexMonthly = pctExpenses + i.monthly_taxes + i.monthly_insurance + i.monthly_hoa + i.monthly_other_expenses;
  const noiMonthly = effective - opexMonthly;
  const cashFlowMonthly = noiMonthly - pi;
  const cashInvested = i.purchase_price * i.down_payment_pct / 100 + i.closing_costs + i.initial_rehab;
  const annualDebt = pi * 12;
  return calc('buy_hold', i,
    'loan = price × (1 − down%); NOI = rent × (1 − vacancy) − operating expenses; cash flow = NOI − P&I; CoC = annual cash flow / cash invested; DSCR = annual NOI / annual P&I; cap rate = annual NOI / price',
    {
      loan_amount: round2(loan), monthly_principal_interest: round2(pi),
      monthly_piti: round2(pi + i.monthly_taxes + i.monthly_insurance),
      effective_monthly_income: round2(effective), monthly_operating_expenses: round2(opexMonthly),
      monthly_noi: round2(noiMonthly), annual_noi: round2(noiMonthly * 12),
      monthly_cash_flow: round2(cashFlowMonthly), annual_cash_flow: round2(cashFlowMonthly * 12),
      cash_invested: round2(cashInvested),
      cash_on_cash_pct: cashInvested > 0 ? round4((cashFlowMonthly * 12 / cashInvested) * 100) : null,
      cap_rate_pct: i.purchase_price > 0 ? round4((noiMonthly * 12 / i.purchase_price) * 100) : null,
      dscr: annualDebt > 0 ? round4((noiMonthly * 12) / annualDebt) : null,
    },
    [...assumptions, 'Management, maintenance and CapEx are a percentage of scheduled rent; figures are pre-tax']);
}

function monthlyPayment(principal, ratePct, termMonths) {
  if (principal <= 0) return 0;
  return core.monthlyPayment({ principal, annual_rate_pct: ratePct, term_months: termMonths }).output.monthly_payment;
}

// ── BRRRR ────────────────────────────────────────────────────────────────────
function brrrr(input) {
  const i = {
    purchase_price: num(input.purchase_price, 'purchase_price', { min: 0 }),
    rehab: num(input.rehab, 'rehab', { min: 0 }),
    acquisition_closing_costs: num(input.acquisition_closing_costs ?? 0, 'acquisition_closing_costs', { min: 0 }),
    holding_costs: num(input.holding_costs ?? 0, 'holding_costs', { min: 0 }),
    arv: num(input.arv, 'arv', { min: 0 }),
    refi_ltv_pct: num(input.refi_ltv_pct, 'refi_ltv_pct', { min: 0, max: 100 }),
    refi_rate_pct: num(input.refi_rate_pct, 'refi_rate_pct', { min: 0, max: 100 }),
    refi_term_months: num(input.refi_term_months ?? 360, 'refi_term_months', { min: 1, integer: true }),
    refi_closing_costs: num(input.refi_closing_costs ?? 0, 'refi_closing_costs', { min: 0 }),
    monthly_rent: num(input.monthly_rent, 'monthly_rent', { min: 0 }),
    vacancy_pct: num(input.vacancy_pct, 'vacancy_pct', { min: 0, max: 100 }),
    monthly_operating_expenses: num(input.monthly_operating_expenses, 'monthly_operating_expenses', { min: 0 }),
  };
  const allIn = i.purchase_price + i.rehab + i.acquisition_closing_costs + i.holding_costs;
  const refiLoan = i.arv * i.refi_ltv_pct / 100;
  const proceeds = refiLoan - i.refi_closing_costs;
  const cashLeft = allIn - proceeds;
  const pi = monthlyPayment(refiLoan, i.refi_rate_pct, i.refi_term_months);
  const noiMonthly = i.monthly_rent * (1 - i.vacancy_pct / 100) - i.monthly_operating_expenses;
  const cf = noiMonthly - pi;
  return calc('brrrr', i,
    'all-in = purchase + rehab + closing + holding; refi loan = ARV × LTV; cash left in deal = all-in − (refi loan − refi costs); equity = ARV − refi loan',
    {
      all_in_cost: round2(allIn), refi_loan: round2(refiLoan), net_refi_proceeds: round2(proceeds),
      cash_left_in_deal: round2(cashLeft), capital_recycled: round2(Math.min(proceeds, allIn)),
      all_capital_recovered: cashLeft <= 0, equity_remaining: round2(i.arv - refiLoan),
      monthly_principal_interest: round2(pi), monthly_noi: round2(noiMonthly), monthly_cash_flow: round2(cf),
      dscr: pi > 0 ? round4(noiMonthly / pi) : null,
      cash_on_cash_pct: cashLeft > 0 ? round4((cf * 12 / cashLeft) * 100) : null,
    },
    ['Refinance at the stated LTV of ARV is subject to appraisal and lender seasoning rules', 'Operating expenses exclude debt service']);
}

// ── Creative finance ─────────────────────────────────────────────────────────
function sellerFinance(input) {
  const i = {
    purchase_price: num(input.purchase_price, 'purchase_price', { min: 0 }),
    down_payment: num(input.down_payment, 'down_payment', { min: 0 }),
    rate_pct: num(input.rate_pct, 'rate_pct', { min: 0, max: 100 }),
    amortization_months: num(input.amortization_months, 'amortization_months', { min: 1, integer: true }),
    balloon_month: num(input.balloon_month ?? input.amortization_months, 'balloon_month', { min: 1, integer: true }),
  };
  if (i.down_payment > i.purchase_price) throw new CalcError('down_payment cannot exceed purchase_price', 'down_payment');
  if (i.balloon_month > i.amortization_months) throw new CalcError('balloon_month cannot exceed amortization_months', 'balloon_month');
  const principal = i.purchase_price - i.down_payment;
  const pmt = monthlyPayment(principal, i.rate_pct, i.amortization_months);
  const bal = principal <= 0 ? 0 : core.remainingBalance({ principal, annual_rate_pct: i.rate_pct, term_months: i.amortization_months, payments_made: i.balloon_month }).output.balance;
  const hasBalloon = i.balloon_month < i.amortization_months;
  const paymentsTotal = pmt * i.balloon_month;
  const interestPaid = paymentsTotal - (principal - bal);
  const sellerFlows = [-principal, ...Array.from({ length: i.balloon_month }, (_, m) => pmt + (m === i.balloon_month - 1 ? bal : 0))];
  const sellerYield = principal > 0 ? core.irr({ cash_flows: sellerFlows, periods_per_year: 12 }).output.irr_annual_pct : null;
  return calc('seller_finance', i,
    'financed = price − down; payment amortizes financed amount; balloon = remaining balance at balloon month; seller yield = IRR of (−financed, payments…, payment + balloon)',
    {
      financed_amount: round2(principal), monthly_payment: round2(pmt),
      balloon_payment: hasBalloon ? round2(bal) : 0, balloon_month: hasBalloon ? i.balloon_month : null,
      total_payments_before_balloon: round2(paymentsTotal), total_interest_paid: round2(interestPaid),
      total_paid_to_seller: round2(i.down_payment + paymentsTotal + (hasBalloon ? bal : 0)),
      seller_annual_yield_pct: sellerYield,
    },
    ['Fixed rate, monthly payments, no late payments or prepayment', 'Buyer must refinance or sell to pay any balloon - that exit is not guaranteed']);
}

function subjectTo(input) {
  const i = {
    purchase_price: num(input.purchase_price, 'purchase_price', { min: 0 }),
    existing_loan_balance: num(input.existing_loan_balance, 'existing_loan_balance', { min: 0 }),
    existing_monthly_piti: num(input.existing_monthly_piti, 'existing_monthly_piti', { min: 0 }),
    arrears: num(input.arrears ?? 0, 'arrears', { min: 0 }),
    closing_costs: num(input.closing_costs ?? 0, 'closing_costs', { min: 0 }),
    market_value: num(input.market_value, 'market_value', { min: 0 }),
    monthly_rent: num(input.monthly_rent ?? 0, 'monthly_rent', { min: 0 }),
    monthly_other_expenses: num(input.monthly_other_expenses ?? 0, 'monthly_other_expenses', { min: 0 }),
  };
  const cashToSeller = Math.max(0, i.purchase_price - i.existing_loan_balance);
  const cashNeeded = cashToSeller + i.arrears + i.closing_costs;
  const equity = i.market_value - i.existing_loan_balance;
  const spread = i.monthly_rent - i.existing_monthly_piti - i.monthly_other_expenses;
  return calc('subject_to', i,
    'cash to seller = price − loan balance; cash needed = cash to seller + arrears + closing; equity = value − loan balance; monthly spread = rent − PITI − other expenses',
    {
      cash_to_seller: round2(cashToSeller), cash_needed_at_close: round2(cashNeeded),
      equity_at_purchase: round2(equity), equity_capture: round2(i.market_value - i.purchase_price - i.arrears - i.closing_costs),
      monthly_spread: round2(spread), annual_spread: round2(spread * 12),
      price_below_loan_balance: i.purchase_price < i.existing_loan_balance,
    },
    ['The existing loan stays in the seller\'s name; most mortgages contain a due-on-sale clause - attorney and title review required']);
}

function leaseOption(input) {
  const i = {
    purchase_price: num(input.purchase_price, 'purchase_price', { min: 0 }),
    option_fee: num(input.option_fee, 'option_fee', { min: 0 }),
    monthly_rent: num(input.monthly_rent, 'monthly_rent', { min: 0 }),
    monthly_rent_credit: num(input.monthly_rent_credit ?? 0, 'monthly_rent_credit', { min: 0 }),
    option_months: num(input.option_months, 'option_months', { min: 1, integer: true }),
    option_fee_credited: input.option_fee_credited !== false,
    operator_monthly_cost: num(input.operator_monthly_cost ?? 0, 'operator_monthly_cost', { min: 0 }),
  };
  const credits = i.monthly_rent_credit * i.option_months + (i.option_fee_credited ? i.option_fee : 0);
  const netStrike = i.purchase_price - credits;
  const operatorMonthly = i.monthly_rent - i.operator_monthly_cost;
  return calc('lease_option', { ...i },
    'credits = monthly credit × months (+ option fee if credited); price at exercise = price − credits; operator monthly = rent − operator cost',
    {
      total_credits_at_exercise: round2(credits), net_price_at_exercise: round2(netStrike),
      operator_monthly_cash_flow: round2(operatorMonthly),
      operator_total_cash_flow_over_option: round2(operatorMonthly * i.option_months + i.option_fee),
      tenant_buyer_upfront: round2(i.option_fee),
    },
    ['Tenant-buyer may not exercise; if not, the option fee is typically kept - terms and local law govern']);
}

// ── Financing ────────────────────────────────────────────────────────────────
function hardMoney(input) {
  const i = {
    loan_amount: num(input.loan_amount, 'loan_amount', { min: 0 }),
    rate_pct: num(input.rate_pct, 'rate_pct', { min: 0, max: 100 }),
    points_pct: num(input.points_pct ?? 0, 'points_pct', { min: 0, max: 100 }),
    months: num(input.months, 'months', { min: 0 }),
    lender_fees: num(input.lender_fees ?? 0, 'lender_fees', { min: 0 }),
    property_value: num(input.property_value ?? null, 'property_value', { min: 0, optional: true }),
    total_project_cost: num(input.total_project_cost ?? null, 'total_project_cost', { min: 0, optional: true }),
  };
  const interest = i.loan_amount * i.rate_pct / 100 / 12 * i.months;
  const points = i.loan_amount * i.points_pct / 100;
  return calc('hard_money', i, 'cost = interest-only (loan × rate / 12 × months) + points + lender fees',
    {
      monthly_interest: round2(i.loan_amount * i.rate_pct / 100 / 12), total_interest: round2(interest),
      points_cost: round2(points), total_financing_cost: round2(interest + points + i.lender_fees),
      ltv_pct: i.property_value ? round4((i.loan_amount / i.property_value) * 100) : null,
      ltc_pct: i.total_project_cost ? round4((i.loan_amount / i.total_project_cost) * 100) : null,
    },
    ['Interest-only, full balance outstanding for the whole term (draw schedules would lower interest)']);
}

function dscrLoan({ annual_noi, rate_pct, term_months = 360, min_dscr, property_value = null, max_ltv_pct = null }) {
  const N = num(annual_noi, 'annual_noi', { min: 0 });
  const rate = num(rate_pct, 'rate_pct', { min: 0, max: 100 });
  const n = num(term_months, 'term_months', { min: 1, integer: true });
  const d = num(min_dscr, 'min_dscr', { min: 0.01 });
  const maxAnnualDebt = N / d;
  const maxMonthly = maxAnnualDebt / 12;
  const r = rate / 100 / 12;
  const byDscr = r === 0 ? maxMonthly * n : maxMonthly * (1 - Math.pow(1 + r, -n)) / r;
  let byLtv = null;
  if (property_value != null && max_ltv_pct != null) {
    byLtv = num(property_value, 'property_value', { min: 0 }) * num(max_ltv_pct, 'max_ltv_pct', { min: 0, max: 100 }) / 100;
  }
  const maxLoan = byLtv == null ? byDscr : Math.min(byDscr, byLtv);
  return calc('dscr_max_loan', { annual_noi: N, rate_pct: rate, term_months: n, min_dscr: d, property_value, max_ltv_pct },
    'max annual debt service = NOI / min DSCR; max loan = present value of that payment; capped by value × max LTV if given',
    { max_annual_debt_service: round2(maxAnnualDebt), max_loan_by_dscr: round2(byDscr), max_loan_by_ltv: byLtv == null ? null : round2(byLtv), max_loan: round2(maxLoan), binding_constraint: byLtv != null && byLtv < byDscr ? 'ltv' : 'dscr' },
    ['Minimum DSCR and max LTV are lender-specific - supply the lender\'s actual terms']);
}

// ── Equity / JV waterfall (single hurdle) ────────────────────────────────────
function equityWaterfall(input) {
  const i = {
    investor_equity: num(input.investor_equity, 'investor_equity', { min: 0 }),
    sponsor_equity: num(input.sponsor_equity ?? 0, 'sponsor_equity', { min: 0 }),
    total_distributions: num(input.total_distributions, 'total_distributions', { min: 0 }),
    hold_years: num(input.hold_years, 'hold_years', { min: 0 }),
    preferred_return_pct: num(input.preferred_return_pct, 'preferred_return_pct', { min: 0, max: 100 }),
    sponsor_promote_pct: num(input.sponsor_promote_pct, 'sponsor_promote_pct', { min: 0, max: 100 }),
  };
  const equity = i.investor_equity + i.sponsor_equity;
  let remaining = i.total_distributions;
  const investorShare = equity > 0 ? i.investor_equity / equity : 0;
  const rocTotal = Math.min(remaining, equity);
  remaining -= rocTotal;
  const prefOwed = i.investor_equity * i.preferred_return_pct / 100 * i.hold_years;
  const prefPaid = Math.min(remaining, prefOwed);
  remaining -= prefPaid;
  const promote = remaining * i.sponsor_promote_pct / 100;
  const splitPool = remaining - promote;
  const investorTotal = rocTotal * investorShare + prefPaid + splitPool * investorShare;
  const sponsorTotal = rocTotal * (1 - investorShare) + promote + splitPool * (1 - investorShare);
  return calc('equity_waterfall', i,
    '1) return of capital pro rata; 2) investor simple preferred return (equity × pref × years); 3) sponsor promote % of remainder; 4) rest pro rata',
    {
      return_of_capital: round2(rocTotal), preferred_return_owed: round2(prefOwed), preferred_return_paid: round2(prefPaid),
      preferred_return_shortfall: round2(prefOwed - prefPaid), sponsor_promote: round2(promote),
      investor_total: round2(investorTotal), sponsor_total: round2(sponsorTotal),
      investor_multiple: i.investor_equity > 0 ? round4(investorTotal / i.investor_equity) : null,
      sponsor_multiple: i.sponsor_equity > 0 ? round4(sponsorTotal / i.sponsor_equity) : null,
    },
    ['Single hurdle, simple (non-compounding) preferred return, no catch-up; real operating agreements vary - have counsel review']);
}

module.exports = {
  wholesaleMao, assignmentFee, doubleClose, holdingCosts, closingCosts,
  fixFlip, buyHold, brrrr, sellerFinance, subjectTo, leaseOption,
  hardMoney, dscrLoan, equityWaterfall,
};
