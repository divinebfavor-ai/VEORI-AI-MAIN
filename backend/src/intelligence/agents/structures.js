// ─── Deal structures: ContractAssignmentAgent, DoubleCloseAgent, LeaseOptionAgent,
//     NovationAgent, DSCRAgent, HardMoneyAgent, EquityJVAgent ───────────────────
// Economics are computed; legality is never assumed. Anything jurisdiction-specific
// is routed to the Real Estate Law Intelligence Agent's verified knowledge or to an
// attorney.

const { defineAgent } = require('../agentKit');
const { claim, STATUS, derived } = require('../provenance');
const S = require('../calc/strategies');
const core = require('../calc/core');
const H = require('./_shared');

const decl = (id, name, domain, capabilities, outputs, tools, extra = {}) => ({
  id, name, domain, version: '1.0.0', capabilities, required_inputs: ['deal_understanding'], outputs, tools,
  knowledge_sources: ['deal understanding', 'operator inputs', 'operator worksheets'], permissions: 'RECOMMEND', risk_level: 'high',
  handoff_agents: [], jurisdiction_aware: true, last_knowledge_update: H.KNOWLEDGE_DATE, ...extra,
});
const numIn = (ctx, key) => H.pos(ctx.inputs?.[key]);
const miss = (item, why, how) => ({ item, why_it_matters: why, how_to_get: how });

const contractAssignment = defineAgent({
  declaration: decl('contract_assignment', 'Contract Assignment Agent', 'wholesale', ['assignment_economics', 'assignment_restrictions_check', 'disclosure_flags'], ['assignment_analysis'], ['calc.assignment_fee'], { handoff_agents: ['real_estate_law'] }),
  async analyze(ctx) {
    const rep = ctx.understanding;
    const contract = H.input(ctx, 'contract_price', 'transaction.contract_price');
    const buyer = H.input(ctx, 'buyer_price', 'transaction.buyer_price');
    const arv = H.c(rep, 'financial.arv'), repairs = H.c(rep, 'financial.repairs');
    const findings = [], calculations = [], missing = [];
    if (contract.status !== STATUS.UNKNOWN && buyer.status !== STATUS.UNKNOWN) {
      const fee = S.assignmentFee({ contract_price: contract.value, buyer_price: buyer.value });
      calculations.push(fee);
      findings.push(H.finding('Assignment fee', derived(fee.output.assignment_fee, [contract, buyer])));
      if (arv.status !== STATUS.UNKNOWN && repairs.status !== STATUS.UNKNOWN) {
        const buyerAllIn = buyer.value + repairs.value;
        findings.push(H.finding('End buyer all-in (price + repairs)', derived(buyerAllIn, [buyer, repairs])));
        findings.push(H.finding('End buyer margin to ARV', derived(arv.value - buyerAllIn, [arv, buyer, repairs], { basis: 'ARV − buyer price − repairs (before their holding, financing and selling costs)' })));
      }
      findings.push(H.finding('Seller receives', claim(contract.value, contract.status, { source: contract.source, basis: 'contract price, before seller closing costs and payoffs' })));
    } else {
      if (contract.status === STATUS.UNKNOWN) missing.push(H.missingItem('transaction.contract_price'));
      if (buyer.status === STATUS.UNKNOWN) missing.push(H.missingItem('transaction.buyer_price'));
    }
    const signed = (H.val(rep, 'transaction.contracts') || []).some(c => c.status === 'fully_signed');
    const law = ctx.priorOutputs?.real_estate_law?.data;
    const risks = [
      { risk: 'The purchase agreement\'s assignment clause has not been checked here; many contracts restrict or prohibit assignment.', severity: 'high', category: 'legal', mitigation: 'Read the assignment clause (look for "and/or assigns" and any consent requirement).' },
      { risk: law?.verified_items ? `${law.verified_items} verified rule(s) on file for this state - review them.` : 'No verified wholesaling/assignment rules on file for this jurisdiction.', severity: law?.verified_items ? 'medium' : 'high', category: 'legal', mitigation: 'Confirm licensing, disclosure and marketing rules with a local real estate attorney before assigning.' },
    ];
    if (fee_negative(findings)) risks.push({ risk: 'Buyer price is below the contract price: no assignment fee.', severity: 'critical', category: 'financial', mitigation: 'Renegotiate or find a higher-paying buyer.' });
    return {
      status: calculations.length ? 'complete' : 'insufficient_data',
      summary: calculations.length ? `Assignment fee ${H.money(calculations[0].output.assignment_fee)}. ${signed ? 'Purchase agreement is signed.' : 'No signed purchase agreement on file.'} Assignability and state rules not verified.` : 'I cannot calculate assignment economics without contract and buyer prices.',
      findings, calculations, risks, missing,
      confidence: calculations.length ? H.evidenceConfidence({ c: contract, b: buyer }, ['c', 'b'], { base: 80 }) : { score: 0, reasoning: 'Prices unknown.' },
      attorney_review: true, handoffs: ['real_estate_law'],
      data: { signed_purchase_agreement: signed, legal_requirements_verified: false },
    };
  },
});
function fee_negative(findings) { const f = findings.find(x => x.label === 'Assignment fee'); return f && f.claim.value < 0; }

const doubleClose = defineAgent({
  declaration: decl('double_close', 'Double Close Agent', 'wholesale', ['ab_bc_costs', 'transactional_funding', 'double_close_profit'], ['double_close_analysis'], ['calc.double_close']),
  async analyze(ctx) {
    const contract = H.input(ctx, 'contract_price', 'transaction.contract_price');
    const buyer = H.input(ctx, 'buyer_price', 'transaction.buyer_price');
    const abCost = numIn(ctx, 'ab_closing_costs'), bcCost = numIn(ctx, 'bc_closing_costs'), fundFee = numIn(ctx, 'transactional_funding_fee_pct');
    const missing = [];
    if (contract.status === STATUS.UNKNOWN) missing.push(H.missingItem('transaction.contract_price'));
    if (buyer.status === STATUS.UNKNOWN) missing.push(H.missingItem('transaction.buyer_price'));
    if (abCost == null) missing.push(miss('ab_closing_costs', 'You pay closing costs on the A-B purchase.', 'Get a buyer-side estimate from the title company.'));
    if (bcCost == null) missing.push(miss('bc_closing_costs', 'You pay seller-side costs on the B-C sale.', 'Get a seller-side estimate from the title company.'));
    if (missing.length) return { status: 'insufficient_data', summary: 'I cannot price a double close without both prices and both sides\' closing costs.', missing, confidence: { score: 0, reasoning: 'Inputs unknown.' }, attorney_review: true };
    const dc = S.doubleClose({ ab_purchase_price: contract.value, bc_sale_price: buyer.value, ab_closing_costs: abCost, bc_closing_costs: bcCost, funding_fee_pct: fundFee ?? 0 });
    const assign = S.assignmentFee({ contract_price: contract.value, buyer_price: buyer.value });
    const risks = [
      { risk: 'If the end buyer does not close, you own (or must fund) the A-B purchase.', severity: 'high', category: 'exit', mitigation: 'Secure a non-refundable buyer deposit and schedule the closings back to back.' },
      { risk: 'Some title companies and lenders restrict same-day resale using the end buyer\'s funds.', severity: 'medium', category: 'title', mitigation: 'Confirm the title company will handle a double close and how funds are sourced.' },
    ];
    if (fundFee == null) risks.push({ risk: 'Transactional funding fee not supplied: 0% used.', severity: 'medium', category: 'financing', mitigation: 'Enter the funder\'s fee.' });
    return {
      summary: `Double close nets ${H.money(dc.output.net_profit)} vs ${H.money(assign.output.assignment_fee)} gross for an assignment (difference ${H.money(assign.output.assignment_fee - dc.output.net_profit)} in extra costs).`,
      findings: [H.finding('Double close net profit', derived(dc.output.net_profit, [contract, buyer]))],
      calculations: [dc, assign], risks,
      confidence: H.evidenceConfidence({ c: contract, b: buyer }, ['c', 'b'], { base: 80 }),
      attorney_review: true, data: { net_profit: dc.output.net_profit, extra_cost_vs_assignment: core.round2(assign.output.assignment_fee - dc.output.net_profit) },
    };
  },
});

const leaseOption = defineAgent({
  declaration: decl('lease_option', 'Lease Option Agent', 'creative_finance', ['option_economics', 'rent_credits', 'exercise_price'], ['lease_option_analysis'], ['calc.lease_option']),
  async analyze(ctx) {
    const price = [H.input(ctx, 'purchase_price'), H.c(ctx.understanding, 'transaction.contract_price'), H.c(ctx.understanding, 'transaction.asking_price')].find(c => c.status !== STATUS.UNKNOWN);
    const rent = H.input(ctx, 'monthly_rent', 'financial.market_rent');
    const fee = numIn(ctx, 'option_fee'), months = numIn(ctx, 'option_months');
    const missing = [];
    if (!price) missing.push(H.missingItem('transaction.asking_price'));
    if (rent.status === STATUS.UNKNOWN) missing.push(H.missingItem('financial.market_rent'));
    if (fee == null) missing.push(miss('option_fee', 'Option consideration paid by the tenant-buyer.', 'Set with the tenant-buyer.'));
    if (months == null || !Number.isInteger(months)) missing.push(miss('option_months', 'The option period decides credits and exit timing.', 'Set with the parties (whole months).'));
    if (missing.length) return { status: 'insufficient_data', summary: 'I cannot model the lease option without price, rent, option fee and option period.', missing, confidence: { score: 0, reasoning: 'Inputs unknown.' }, attorney_review: true };
    const lo = S.leaseOption({ purchase_price: price.value, option_fee: fee, monthly_rent: rent.value, monthly_rent_credit: numIn(ctx, 'monthly_rent_credit') ?? 0, option_months: months, operator_monthly_cost: numIn(ctx, 'monthly_payment') ?? 0 });
    const risks = [
      { risk: 'Some states treat lease options with large credits as installment sales, adding foreclosure-style protections for the tenant-buyer.', severity: 'high', category: 'legal', mitigation: 'Have a local attorney draft the lease and option as separate agreements.' },
      { risk: 'Most tenant-buyers do not exercise the option.', severity: 'medium', category: 'exit', mitigation: 'Model the hold as a rental if the option is not exercised.' },
    ];
    if (numIn(ctx, 'monthly_payment') == null) risks.push({ risk: 'Your monthly cost (mortgage/taxes/insurance) not supplied: $0 used, so cash flow is overstated.', severity: 'medium', category: 'financial', mitigation: 'Enter your monthly carrying cost as monthly_payment.' });
    return {
      summary: `Tenant-buyer pays ${H.money(fee)} up front; price at exercise ${H.money(lo.output.net_price_at_exercise)} after ${H.money(lo.output.total_credits_at_exercise)} credits; your cash flow ${H.money(lo.output.operator_monthly_cash_flow)}/mo.`,
      findings: [H.finding('Net price at exercise', derived(lo.output.net_price_at_exercise, [price]))],
      calculations: [lo], risks,
      confidence: H.evidenceConfidence({ p: price, r: rent }, ['p', 'r'], { base: 70 }),
      attorney_review: true, data: lo.output,
    };
  },
});

const novation = defineAgent({
  declaration: decl('novation', 'Novation Agent', 'creative_finance', ['novation_fit', 'novation_spread'], ['novation_assessment'], ['calc.closing_costs']),
  async analyze(ctx) {
    const rep = ctx.understanding;
    const retail = numIn(ctx, 'retail_value');
    const contract = H.input(ctx, 'contract_price', 'transaction.contract_price');
    const repairs = H.input(ctx, 'repairs', 'financial.repairs');
    const listPct = numIn(ctx, 'listing_cost_pct');
    const fit = [];
    const condition = H.val(rep, 'property.condition');
    fit.push({ factor: 'Seller wants closer to retail price and can wait for a listing sale', known: H.known(rep, 'people.seller.objectives') || H.known(rep, 'people.seller.timeline_days'), evidence: H.val(rep, 'people.seller.objectives') || H.val(rep, 'people.seller.timeline_days') });
    fit.push({ factor: 'Property is listable after light cosmetic work', known: !!condition, evidence: condition });
    fit.push({ factor: 'Existing debt can be paid off from a retail sale', known: H.known(rep, 'property.financing.loan_balance'), evidence: H.val(rep, 'property.financing.loan_balance') });
    const missing = [];
    if (retail == null) missing.push(miss('retail_value', 'Novation profit is the spread between retail sale and the seller\'s net.', 'Sold comps for renovated/retail-condition homes or a broker price opinion.'));
    if (contract.status === STATUS.UNKNOWN) missing.push(H.missingItem('transaction.contract_price'));
    if (repairs.status === STATUS.UNKNOWN) missing.push(H.missingItem('financial.repairs'));
    if (listPct == null) missing.push(miss('listing_cost_pct', 'Agent commissions and seller costs on the retail sale.', 'Listing agreement terms plus title estimate.'));
    let calc = null, spread = null;
    if (!missing.length) {
      calc = S.closingCosts({ price: retail, pct: listPct });
      spread = core.round2(retail - calc.output.closing_costs - contract.value - repairs.value);
    }
    return {
      status: missing.length ? 'insufficient_data' : 'complete',
      summary: spread == null ? `Fit factors: ${fit.filter(f => f.known).length}/3 known. Spread needs retail value, contract price, repairs and listing costs.` : `Estimated novation spread ${H.money(spread)} (retail ${H.money(retail)} − listing costs ${H.money(calc.output.closing_costs)} − seller price − repairs).`,
      findings: fit.map(f => H.finding(f.factor, claim(f.known ? f.evidence : null, f.known ? STATUS.USER_PROVIDED : STATUS.UNKNOWN))),
      calculations: calc ? [calc, { name: 'novation_spread', inputs: { retail_value: retail, listing_costs: calc.output.closing_costs, contract_price: contract.value, repairs: repairs.value }, formula: 'spread = retail − listing costs − seller price − repairs', output: { spread }, assumptions: ['Excludes holding costs during the listing period'] }] : [],
      risks: [
        { risk: 'Novation agreements require clear disclosure to the seller of the resale plan; courts and regulators look closely at this.', severity: 'high', category: 'legal', mitigation: 'Use an attorney-drafted novation agreement with plain-language disclosure.' },
        { risk: 'Listing and buyer financing timelines are long; the deal depends on a retail buyer\'s appraisal and loan.', severity: 'medium', category: 'exit', mitigation: 'Price to comps and budget for 60-120 days.' },
      ],
      missing, confidence: { score: missing.length ? 20 : 55, reasoning: missing.length ? 'Key novation inputs are missing.' : 'Spread uses operator-supplied retail value and costs.' },
      attorney_review: true, data: { fit, spread },
    };
  },
});

function loanQuote(ctx, type) {
  const q = H.worksheet(ctx.understanding, 'loan_quotes');
  const list = Array.isArray(q) ? q : Array.isArray(q?.quotes) ? q.quotes : [];
  return list.find(x => String(x.type || '').toLowerCase() === type) || null;
}

const dscrAgent = defineAgent({
  declaration: decl('dscr', 'DSCR Agent', 'finance', ['dscr_ratio', 'dscr_max_loan', 'dscr_qualification'], ['dscr_analysis'], ['calc.dscr', 'calc.dscr_max_loan'], { risk_level: 'medium', jurisdiction_aware: false }),
  async analyze(ctx) {
    const quote = loanQuote(ctx, 'dscr') || {};
    const rent = H.input(ctx, 'monthly_rent', 'financial.market_rent');
    const opex = numIn(ctx, 'monthly_operating_expenses');
    const vac = numIn(ctx, 'vacancy_pct');
    const rate = numIn(ctx, 'loan_rate_pct') ?? H.pos(quote.rate_pct);
    const minD = numIn(ctx, 'min_dscr') ?? H.pos(quote.min_dscr);
    const missing = [];
    if (rent.status === STATUS.UNKNOWN) missing.push(H.missingItem('financial.market_rent'));
    if (opex == null) missing.push(miss('monthly_operating_expenses', 'DSCR uses NOI; expenses are needed.', 'Taxes, insurance, HOA, management and maintenance per month.'));
    if (vac == null) missing.push(miss('vacancy_pct', 'Lenders underwrite rent less vacancy.', 'Lender guideline or local data.'));
    if (rate == null) missing.push(miss('loan_rate_pct', 'Debt service depends on the rate.', 'DSCR lender quote (save it in the loan quotes worksheet).'));
    if (minD == null) missing.push(miss('min_dscr', 'Qualification is measured against the lender\'s minimum.', 'DSCR lender quote.'));
    if (missing.length) return { status: 'insufficient_data', summary: 'I cannot size a DSCR loan yet.', missing, confidence: { score: 0, reasoning: 'Inputs unknown.' } };
    const annualNoi = core.round2((rent.value * (1 - vac / 100) - opex) * 12);
    const sizing = S.dscrLoan({ annual_noi: Math.max(0, annualNoi), rate_pct: rate, term_months: H.pos(quote.term_months) ?? 360, min_dscr: minD, property_value: H.val(ctx.understanding, 'financial.as_is_value') ?? H.val(ctx.understanding, 'financial.arv') ?? null, max_ltv_pct: numIn(ctx, 'max_ltv_pct') ?? H.pos(quote.max_ltv_pct) });
    const loanWanted = numIn(ctx, 'loan_amount');
    let actual = null;
    if (loanWanted != null) {
      const pmt = core.monthlyPayment({ principal: loanWanted, annual_rate_pct: rate, term_months: H.pos(quote.term_months) ?? 360 });
      actual = core.dscr({ annual_noi: annualNoi, annual_debt_service: pmt.output.monthly_payment * 12 });
    }
    return {
      summary: `NOI ${H.money(annualNoi)}/yr supports up to ${H.money(sizing.output.max_loan)} at ${rate}% and ${minD} DSCR (limited by ${sizing.output.binding_constraint}).${actual ? ` Your ${H.money(loanWanted)} loan has DSCR ${actual.output.dscr} - ${actual.output.dscr >= minD ? 'qualifies' : `short by ${core.round4(minD - actual.output.dscr)}`}.` : ''}`,
      findings: [H.finding('Max DSCR loan', claim(sizing.output.max_loan, STATUS.CALCULATED, { basis: `rent ${rent.status}` }))],
      calculations: [sizing, ...(actual ? [actual] : [])],
      confidence: H.evidenceConfidence({ r: rent }, ['r'], { base: 80 }),
      data: { annual_noi: annualNoi, max_loan: sizing.output.max_loan, dscr_at_requested_loan: actual?.output?.dscr ?? null, qualifies: actual ? actual.output.dscr >= minD : null },
    };
  },
});

const hardMoney = defineAgent({
  declaration: decl('hard_money', 'Hard Money Agent', 'finance', ['hard_money_cost', 'ltv_ltc', 'financing_vs_return'], ['hard_money_analysis'], ['calc.hard_money'], { risk_level: 'medium', jurisdiction_aware: false }),
  async analyze(ctx) {
    const quote = loanQuote(ctx, 'hard_money') || {};
    const loan = numIn(ctx, 'loan_amount') ?? H.pos(quote.loan_amount);
    const rate = numIn(ctx, 'loan_rate_pct') ?? H.pos(quote.rate_pct);
    const months = numIn(ctx, 'holding_months') ?? H.pos(quote.months);
    const missing = [];
    if (loan == null) missing.push(miss('loan_amount', 'Cost scales with the amount borrowed.', 'Lender quote (LTC × purchase + rehab).'));
    if (rate == null) missing.push(miss('loan_rate_pct', 'Interest cost.', 'Hard money quote.'));
    if (months == null) missing.push(miss('holding_months', 'Interest accrues for the whole hold.', 'Rehab plus sale timeline.'));
    if (missing.length) return { status: 'insufficient_data', summary: 'I cannot price hard money without loan amount, rate and term.', missing, confidence: { score: 0, reasoning: 'No quote.' } };
    const contract = H.c(ctx.understanding, 'transaction.contract_price').value;
    const repairs = H.c(ctx.understanding, 'financial.repairs').value;
    const hm = S.hardMoney({ loan_amount: loan, rate_pct: rate, points_pct: numIn(ctx, 'loan_points_pct') ?? H.pos(quote.points_pct) ?? 0, months, lender_fees: H.pos(quote.fees) ?? 0, property_value: H.val(ctx.understanding, 'financial.arv') ?? undefined, total_project_cost: contract != null && repairs != null ? contract + repairs : undefined });
    const flipProfit = ctx.priorOutputs?.fix_flip?.data?.profit;
    return {
      summary: `Hard money costs ${H.money(hm.output.total_financing_cost)} over ${months} months${hm.output.ltc_pct != null ? ` (LTC ${hm.output.ltc_pct}%)` : ''}${flipProfit != null ? `; that is ${core.round2((hm.output.total_financing_cost / Math.max(1, Math.abs(flipProfit))) * 100)}% of projected flip profit` : ''}.`,
      findings: [H.finding('Total financing cost', claim(hm.output.total_financing_cost, STATUS.CALCULATED, { basis: quote.rate_pct ? 'saved lender quote' : 'your inputs' }))],
      calculations: [hm],
      risks: months > 12 ? [{ risk: 'Hold beyond 12 months; most hard money loans need an extension fee or refinance.', severity: 'medium', category: 'financing', mitigation: 'Confirm extension terms.' }] : [],
      confidence: { score: 75, reasoning: 'Exact for the stated terms; real draws on rehab funds usually lower interest.' },
      data: hm.output,
    };
  },
});

const equityJv = defineAgent({
  declaration: decl('equity_jv', 'Equity / JV Agent', 'finance', ['waterfall', 'preferred_return', 'promote', 'investor_returns'], ['jv_structure'], ['calc.equity_waterfall', 'calc.irr'], { jurisdiction_aware: true }),
  async analyze(ctx) {
    const t = H.worksheet(ctx.understanding, 'jv_terms') || {};
    const need = { investor_equity: H.pos(t.investor_equity), sponsor_equity: H.pos(t.sponsor_equity) ?? 0, total_distributions: H.pos(t.total_distributions), hold_years: H.pos(t.hold_years), preferred_return_pct: H.pos(t.preferred_return_pct), sponsor_promote_pct: H.pos(t.sponsor_promote_pct) };
    const missing = Object.entries(need).filter(([, v]) => v == null).map(([k]) => miss(k, 'Required to run the waterfall.', 'Save it in the JV terms worksheet.'));
    if (missing.length) return { status: 'insufficient_data', summary: 'I cannot run a JV waterfall until the JV terms worksheet has contributions, total distributions, hold years, preferred return and promote.', missing, confidence: { score: 0, reasoning: 'Terms unknown.' }, attorney_review: true };
    const w = S.equityWaterfall(need);
    const scenarioDist = [0.8, 1, 1.2].map(f => ({ factor: f, ...S.equityWaterfall({ ...need, total_distributions: need.total_distributions * f }).output }));
    return {
      summary: `Investors receive ${H.money(w.output.investor_total)} (${w.output.investor_multiple}x); sponsor ${H.money(w.output.sponsor_total)} including ${H.money(w.output.sponsor_promote)} promote.${w.output.preferred_return_shortfall > 0 ? ` Preferred return short by ${H.money(w.output.preferred_return_shortfall)}.` : ''}`,
      findings: [H.finding('Investor total', claim(w.output.investor_total, STATUS.CALCULATED, { basis: 'JV terms worksheet (you provided)' }))],
      calculations: [w],
      risks: [{ risk: 'Raising money from passive investors can be a securities offering.', severity: 'high', category: 'legal', mitigation: 'Have a securities attorney structure the raise and operating agreement.' }],
      confidence: { score: 70, reasoning: 'Exact for the stated terms; simple preferred return, single hurdle, no catch-up.' },
      attorney_review: true,
      data: { ...w.output, distribution_sensitivity: scenarioDist.map(s => ({ distributions_factor: s.factor, investor_total: s.investor_total, sponsor_total: s.sponsor_total })) },
    };
  },
});

module.exports = { contractAssignment, doubleClose, leaseOption, novation, dscrAgent, hardMoney, equityJv };
