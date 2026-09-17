// ─── Investment strategy domain: FixFlipAgent, BuyHoldAgent, BRRRRAgent, RentalPropertyAgent ─

const { defineAgent } = require('../agentKit');
const { claim, STATUS, derived } = require('../provenance');
const S = require('../calc/strategies');
const core = require('../calc/core');
const BE = require('../calc/breakEven');
const scenarios = require('../engines/scenarios');
const H = require('./_shared');

const decl = (id, name, capabilities, outputs, tools, extra = {}) => ({
  id, name, domain: 'investment', version: '1.0.0', capabilities, required_inputs: ['deal_understanding'], outputs, tools,
  knowledge_sources: ['deal understanding', 'operator inputs'], permissions: 'RECOMMEND', risk_level: 'medium',
  handoff_agents: [], jurisdiction_aware: false, last_knowledge_update: H.KNOWLEDGE_DATE, ...extra,
});

const price = (ctx) => [H.input(ctx, 'purchase_price'), H.c(ctx.understanding, 'transaction.contract_price'), H.c(ctx.understanding, 'transaction.asking_price'), H.c(ctx.understanding, 'transaction.offer_price')].find(c => c.status !== STATUS.UNKNOWN) || claim(null, STATUS.UNKNOWN);
const arvOf = (ctx) => {
  const i = H.input(ctx, 'arv');
  if (i.status !== STATUS.UNKNOWN) return i;
  const o = ctx.priorOutputs?.arv?.data;
  if (o && o.value != null) return claim(o.value, o.status, { source: `ARV Agent (${o.basis})` });
  return H.c(ctx.understanding, 'financial.arv');
};
const numIn = (ctx, key) => H.pos(ctx.inputs?.[key]);
const missingInput = (key, why, how) => ({ item: key, why_it_matters: why, how_to_get: how });

const fixFlip = defineAgent({
  declaration: decl('fix_flip', 'Fix & Flip Agent', ['flip_profit', 'flip_roi', 'flip_mao', 'rehab_overrun_sensitivity'], ['flip_analysis'], ['calc.fix_flip', 'calc.fix_flip_break_even', 'engines.scenarios'], { handoff_agents: ['financing'] }),
  async analyze(ctx) {
    const rep = ctx.understanding;
    const p = price(ctx), a = arvOf(ctx);
    // Repairs: this request's input > itemised scope from the Rehab Estimation Agent > deal record.
    const scope = ctx.priorOutputs?.rehab_estimation;
    const explicitRepairs = H.input(ctx, 'repairs');
    const r = explicitRepairs.status !== STATUS.UNKNOWN ? explicitRepairs
      : scope?.status === 'complete' && scope.data?.total != null ? claim(scope.data.total, STATUS.CALCULATED, { source: 'Rehab Estimation Agent (your line items)' })
      : H.c(ctx.understanding, 'financial.repairs');
    const hold = numIn(ctx, 'holding_months');
    const missing = [];
    if (p.status === STATUS.UNKNOWN) missing.push(H.missingItem('transaction.contract_price'));
    if (a.status === STATUS.UNKNOWN) missing.push(H.missingItem('financial.arv'));
    if (r.status === STATUS.UNKNOWN) missing.push(H.missingItem('financial.repairs'));
    if (hold == null) missing.push(missingInput('holding_months', 'Holding time drives interest and carrying costs.', 'Estimate rehab plus time to sell; enter it as holding months.'));
    if (missing.length) return { status: 'insufficient_data', summary: 'I cannot calculate flip returns without price, ARV, repairs and holding time.', missing, confidence: { score: 0, reasoning: 'Required flip inputs are unknown.' } };
    const input = {
      purchase_price: p.value, sale_price: a.value, rehab: r.value, holding_months: hold,
      monthly_holding: numIn(ctx, 'monthly_holding'), buy_closing_pct: numIn(ctx, 'buy_closing_pct'), sell_cost_pct: numIn(ctx, 'sell_cost_pct'),
      loan_amount: numIn(ctx, 'loan_amount'), loan_rate_pct: numIn(ctx, 'loan_rate_pct'), loan_points_pct: numIn(ctx, 'loan_points_pct'),
    };
    const clean = Object.fromEntries(Object.entries(input).filter(([, v]) => v != null));
    const f = S.fixFlip(clean);
    const be = BE.fixFlipBreakEven(clean);
    const sc = scenarios.run({ strategy: 'fix_flip', base: clean, scenarios: {} });
    const overrun = sc.scenarios.find(s => s.key === 'construction_overrun');
    const down = sc.scenarios.find(s => s.key === 'downside');
    const risks = [];
    if (f.output.profit <= 0) risks.push({ risk: `Loses ${H.money(-f.output.profit)} at these numbers.`, severity: 'critical', category: 'financial', mitigation: 'Lower the purchase price or rehab, or pick another exit.' });
    if (overrun.metrics.profit_loss < 0) risks.push({ risk: `A 40% rehab overrun (with 3 extra months) turns this into a ${H.money(overrun.metrics.profit_loss)} loss.`, severity: 'high', category: 'construction', mitigation: 'Get fixed-price bids and a contingency line.' });
    if (down.metrics.profit_loss < 0) risks.push({ risk: `The downside case (ARV −10%, rehab +15%, +2 months) loses ${H.money(-down.metrics.profit_loss)}.`, severity: 'high', category: 'market', mitigation: 'Confirm ARV with sold comps before committing.' });
    for (const x of f.assumptions.filter(a2 => /not supplied/.test(a2))) risks.push({ risk: x, severity: 'medium', category: 'financial', mitigation: 'Enter the real figure; the profit shown is overstated without it.' });
    return {
      summary: `Profit ${H.money(f.output.profit)} (ROI ${f.output.roi_pct ?? '—'}%) on ${H.money(f.output.cash_invested)} cash. Break-even sale price ${H.money(be.output.break_even_points.find(x => x.field === 'sale_price').value)}.`,
      findings: [H.finding('Flip profit', derived(f.output.profit, [p, a, r])), H.finding('Cash invested', derived(f.output.cash_invested, [p, r]))],
      calculations: [f, be], risks,
      missing: H.missingFrom(rep, ['property.condition']),
      confidence: H.evidenceConfidence({ p, a, r }, ['p', 'a', 'r'], { base: 85 }),
      positions: { 'flip.profit': f.output.profit },
      data: { profit: f.output.profit, roi_pct: f.output.roi_pct, break_even: be.output.break_even_points, scenarios: sc.scenarios.map(s => ({ key: s.key, label: s.label, profit_loss: s.metrics.profit_loss })) },
    };
  },
});

function holdInputs(ctx) {
  const p = price(ctx);
  const rent = H.input(ctx, 'monthly_rent', 'financial.market_rent');
  const taxesAnnual = H.c(ctx.understanding, 'property.taxes.annual');
  const insAnnual = H.c(ctx.understanding, 'property.insurance.annual');
  const i = {
    purchase_price: p.value, monthly_rent: rent.value,
    down_payment_pct: numIn(ctx, 'down_payment_pct'), loan_rate_pct: numIn(ctx, 'loan_rate_pct') ?? numIn(ctx, 'rate_pct'),
    vacancy_pct: numIn(ctx, 'vacancy_pct'),
    monthly_taxes: numIn(ctx, 'monthly_taxes') ?? (taxesAnnual.value != null ? core.round2(taxesAnnual.value / 12) : null),
    monthly_insurance: numIn(ctx, 'monthly_insurance') ?? (insAnnual.value != null ? core.round2(insAnnual.value / 12) : null),
    management_pct: numIn(ctx, 'management_pct'), maintenance_pct: numIn(ctx, 'maintenance_pct'), capex_pct: numIn(ctx, 'capex_pct'),
  };
  const missing = [];
  if (i.purchase_price == null) missing.push(H.missingItem('transaction.contract_price'));
  if (i.monthly_rent == null) missing.push(H.missingItem('financial.market_rent'));
  if (i.monthly_taxes == null) missing.push(H.missingItem('property.taxes.annual'));
  if (i.monthly_insurance == null) missing.push(H.missingItem('property.insurance.annual'));
  for (const [k, why] of [['down_payment_pct', 'Down payment sets the loan and cash invested.'], ['loan_rate_pct', 'The interest rate sets the mortgage payment.'], ['vacancy_pct', 'Vacancy reduces collected rent.']]) {
    if (i[k] == null) missing.push(missingInput(k, why, 'Enter it from a lender quote or your underwriting standard.'));
  }
  return { i, missing, claims: { p, rent, taxesAnnual, insAnnual } };
}

const buyHold = defineAgent({
  declaration: decl('buy_hold', 'Buy & Hold Agent', ['rental_cash_flow', 'noi', 'cash_on_cash', 'dscr', 'irr'], ['buy_hold_analysis'], ['calc.buy_hold', 'calc.buy_hold_break_even', 'calc.irr']),
  async analyze(ctx) {
    const { i, missing, claims } = holdInputs(ctx);
    if (missing.length) return { status: 'insufficient_data', summary: 'I cannot calculate rental returns until price, rent, taxes, insurance, financing and vacancy are known.', missing, confidence: { score: 0, reasoning: 'Required rental inputs are unknown.' } };
    const clean = Object.fromEntries(Object.entries(i).filter(([, v]) => v != null));
    const b = S.buyHold(clean);
    const be = BE.buyHoldBreakEven(clean);
    const calculations = [b, be];
    let irr = null;
    const holdYears = numIn(ctx, 'hold_years'), exitValue = numIn(ctx, 'exit_value');
    if (holdYears && exitValue != null && Number.isInteger(holdYears)) {
      const bal = core.remainingBalance({ principal: b.output.loan_amount, annual_rate_pct: clean.loan_rate_pct, term_months: clean.loan_term_months || 360, payments_made: Math.min(holdYears * 12, clean.loan_term_months || 360) }).output.balance;
      const sellCost = exitValue * (numIn(ctx, 'sell_cost_pct') ?? 0) / 100;
      const flows = [-b.output.cash_invested, ...Array.from({ length: holdYears }, (_, y) => b.output.annual_cash_flow + (y === holdYears - 1 ? exitValue - bal - sellCost : 0))];
      irr = core.irr({ cash_flows: flows, periods_per_year: 1 });
      irr.assumptions.push('Flat rent and expenses every year; exit at the stated value', numIn(ctx, 'sell_cost_pct') == null ? 'Selling cost not supplied: 0% used' : 'Selling cost as supplied');
      calculations.push(irr);
    }
    const risks = [];
    if (b.output.monthly_cash_flow < 0) risks.push({ risk: `Negative cash flow of ${H.money(b.output.monthly_cash_flow)} a month.`, severity: 'high', category: 'financial', mitigation: 'Lower price, increase down payment, or raise rent.' });
    if (b.output.dscr != null && b.output.dscr < 1.2) risks.push({ risk: `DSCR ${b.output.dscr} is below 1.20.`, severity: 'medium', category: 'financing', mitigation: 'Expect DSCR lenders to reduce the loan amount.' });
    for (const x of b.assumptions.filter(a => /not supplied/.test(a))) risks.push({ risk: x, severity: 'medium', category: 'financial', mitigation: 'Enter the figure; cash flow is overstated without it.' });
    return {
      summary: `Cash flow ${H.money(b.output.monthly_cash_flow)}/mo, cash-on-cash ${b.output.cash_on_cash_pct ?? '—'}%, DSCR ${b.output.dscr ?? '—'}, cap rate ${b.output.cap_rate_pct ?? '—'}%.${irr ? ` IRR ${irr.output.irr_annual_pct}% over ${holdYears} years.` : ' IRR needs hold years and an exit value.'}`,
      findings: [H.finding('Monthly cash flow', derived(b.output.monthly_cash_flow, [claims.p, claims.rent])), H.finding('Cash invested', derived(b.output.cash_invested, [claims.p]))],
      calculations, risks,
      missing: irr ? [] : [missingInput('hold_years + exit_value', 'IRR needs how long you hold and what you sell for.', 'Enter hold years and an exit value you can support with comps.')],
      confidence: H.evidenceConfidence({ p: claims.p, r: claims.rent }, ['p', 'r'], { base: 80 }),
      positions: { 'rental.monthly_cash_flow': b.output.monthly_cash_flow },
      data: { ...b.output, break_even: be.output.break_even_points, irr_annual_pct: irr?.output?.irr_annual_pct ?? null },
    };
  },
});

const brrrr = defineAgent({
  declaration: decl('brrrr', 'BRRRR Agent', ['refinance_proceeds', 'cash_left_in_deal', 'capital_recycled', 'post_refi_cash_flow'], ['brrrr_analysis'], ['calc.brrrr']),
  async analyze(ctx) {
    const p = price(ctx), a = arvOf(ctx), r = H.input(ctx, 'repairs', 'financial.repairs'), rent = H.input(ctx, 'monthly_rent', 'financial.market_rent');
    const need = { refi_ltv_pct: numIn(ctx, 'refi_ltv_pct'), refi_rate_pct: numIn(ctx, 'refi_rate_pct'), vacancy_pct: numIn(ctx, 'vacancy_pct'), monthly_operating_expenses: numIn(ctx, 'monthly_operating_expenses') };
    const missing = [];
    if (p.status === STATUS.UNKNOWN) missing.push(H.missingItem('transaction.contract_price'));
    if (a.status === STATUS.UNKNOWN) missing.push(H.missingItem('financial.arv'));
    if (r.status === STATUS.UNKNOWN) missing.push(H.missingItem('financial.repairs'));
    if (rent.status === STATUS.UNKNOWN) missing.push(H.missingItem('financial.market_rent'));
    for (const [k, v] of Object.entries(need)) if (v == null) missing.push(missingInput(k, 'Required for the refinance and post-refinance cash flow.', 'Get refinance terms from a lender; estimate vacancy and operating expenses.'));
    if (missing.length) return { status: 'insufficient_data', summary: 'I cannot model the BRRRR cycle yet.', missing, confidence: { score: 0, reasoning: 'Required BRRRR inputs are unknown.' } };
    const c = S.brrrr({ purchase_price: p.value, rehab: r.value, arv: a.value, monthly_rent: rent.value, acquisition_closing_costs: numIn(ctx, 'ab_closing_costs') ?? 0, holding_costs: numIn(ctx, 'monthly_holding') != null && numIn(ctx, 'holding_months') != null ? numIn(ctx, 'monthly_holding') * numIn(ctx, 'holding_months') : 0, refi_closing_costs: numIn(ctx, 'refi_closing_costs') ?? 0, ...need });
    const risks = [{ risk: 'Refinance depends on the appraisal meeting ARV and on lender seasoning rules.', severity: 'high', category: 'financing', mitigation: 'Confirm seasoning period and appraisal approach with the refinance lender before buying.' }];
    if (!c.output.all_capital_recovered) risks.push({ risk: `${H.money(c.output.cash_left_in_deal)} stays in the deal after refinance.`, severity: 'medium', category: 'liquidity', mitigation: 'Buy lower or reduce rehab to recover more capital.' });
    if (c.output.monthly_cash_flow < 0) risks.push({ risk: `Post-refinance cash flow is ${H.money(c.output.monthly_cash_flow)} a month.`, severity: 'high', category: 'financial', mitigation: 'A lower LTV refinance or higher rent is needed.' });
    return {
      summary: `Refinance ${H.money(c.output.refi_loan)}; ${c.output.all_capital_recovered ? 'all capital recovered' : `${H.money(c.output.cash_left_in_deal)} left in the deal`}; equity ${H.money(c.output.equity_remaining)}; cash flow ${H.money(c.output.monthly_cash_flow)}/mo.`,
      findings: [H.finding('Cash left in deal', derived(c.output.cash_left_in_deal, [p, a, r]))],
      calculations: [c], risks,
      confidence: H.evidenceConfidence({ p, a, r, rent }, ['p', 'a', 'r', 'rent'], { base: 75 }),
      data: c.output,
    };
  },
});

const rentalProperty = defineAgent({
  declaration: decl('rental_property', 'Rental Property Agent', ['long_term_rental', 'short_term_rental', 'mid_term_rental', 'section_8', 'room_by_room', 'student_housing'], ['rental_models'], ['calc.noi']),
  async analyze(ctx) {
    const rep = ctx.understanding;
    const models = [];
    const opex = numIn(ctx, 'monthly_operating_expenses');
    const vac = numIn(ctx, 'vacancy_pct');
    const add = (model, monthlyGross, basis, occupancyNote) => {
      if (monthlyGross == null) return;
      const vacancy = model === 'short_term' ? null : vac;
      const effective = model === 'short_term' ? monthlyGross : vacancy == null ? null : monthlyGross * (1 - vacancy / 100);
      const expenses = model === 'short_term' && numIn(ctx, 'str_expense_pct') != null ? monthlyGross * numIn(ctx, 'str_expense_pct') / 100 + (opex ?? 0) : opex;
      models.push({ model, monthly_gross: core.round2(monthlyGross), monthly_effective: effective == null ? null : core.round2(effective), monthly_expenses: expenses == null ? null : core.round2(expenses), monthly_noi: effective == null || expenses == null ? null : core.round2(effective - expenses), basis, note: occupancyNote || null });
    };
    const ltr = H.input(ctx, 'monthly_rent', 'financial.market_rent');
    add('long_term', ltr.value, `${ltr.status} (${ltr.source || 'operator'})`);
    if (numIn(ctx, 'adr') != null && numIn(ctx, 'str_occupancy_pct') != null) add('short_term', numIn(ctx, 'adr') * 30.4 * numIn(ctx, 'str_occupancy_pct') / 100, 'operator nightly rate × 30.4 nights × occupancy', 'Check local short-term rental rules and HOA restrictions before relying on this.');
    if (numIn(ctx, 'mtr_monthly_rent') != null) add('mid_term', numIn(ctx, 'mtr_monthly_rent'), 'operator mid-term rent');
    if (numIn(ctx, 'section8_payment_standard') != null) add('section_8', numIn(ctx, 'section8_payment_standard'), 'operator-entered housing authority payment standard', 'Contract rent must pass the housing authority\'s rent reasonableness test and inspection.');
    if (numIn(ctx, 'rooms') != null && numIn(ctx, 'rent_per_room') != null) add('room_by_room', numIn(ctx, 'rooms') * numIn(ctx, 'rent_per_room'), 'rooms × rent per room', 'Check local occupancy and rooming-house rules.');
    const missing = [];
    if (!models.length) missing.push(H.missingItem('financial.market_rent'));
    if (vac == null) missing.push(missingInput('vacancy_pct', 'Vacancy reduces collected rent for long-, mid-term and room rentals.', 'Use local rental vacancy data or your experience.'));
    if (opex == null) missing.push(missingInput('monthly_operating_expenses', 'NOI can\'t be computed without operating expenses.', 'Taxes, insurance, utilities, management, maintenance and reserves per month.'));
    missing.push({ item: 'Short-term, mid-term and Section 8 market data', why_it_matters: 'No rental-market data source is connected for these models.', how_to_get: 'Enter nightly rate and occupancy, mid-term rent, or the housing authority payment standard.' });
    const withNoi = models.filter(m => m.monthly_noi != null).sort((x, y) => y.monthly_noi - x.monthly_noi);
    return {
      status: models.length ? 'complete' : 'insufficient_data',
      summary: models.length ? `${models.length} rental model(s) computed${withNoi.length ? `; highest NOI ${withNoi[0].model.replace(/_/g, ' ')} at ${H.money(withNoi[0].monthly_noi)}/mo` : ' (NOI needs vacancy and expenses)'}.` : 'I cannot compare rental models without rent figures.',
      findings: models.map(m => H.finding(`${m.model} monthly gross`, claim(m.monthly_gross, STATUS.CALCULATED, { basis: m.basis }))),
      calculations: models.map(m => ({ name: `rental_${m.model}`, inputs: { basis: m.basis, vacancy_pct: vac, monthly_operating_expenses: opex }, formula: 'effective = gross × (1 − vacancy); NOI = effective − expenses', output: m, assumptions: m.note ? [m.note] : [] })),
      missing, confidence: { score: models.length ? 55 : 0, reasoning: 'Figures come from rent on record or your inputs; no rental market data source is connected.' },
      data: { models, property_type: H.val(rep, 'property.property_type') },
    };
  },
});

module.exports = { fixFlip, buyHold, brrrr, rentalProperty };
