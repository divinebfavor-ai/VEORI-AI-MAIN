// ─── Creative finance domain: CreativeFinanceAgent, SubjectToAgent, SellerFinanceAgent ─
// Financial attractiveness never implies legal permissibility: every structure here
// carries attorney and title review.

const { defineAgent } = require('../agentKit');
const { claim, STATUS, derived } = require('../provenance');
const S = require('../calc/strategies');
const H = require('./_shared');

const LEGAL_NOTE = 'Structure is shown for its economics only. Whether it is permitted, and how it must be documented, depends on the loan documents and state law - attorney and title review required before offering it.';

function priceClaim(ctx) {
  for (const [key, path] of [['purchase_price', null], ['contract_price', 'transaction.contract_price'], ['asking_price', 'transaction.asking_price'], [null, 'transaction.offer_price']]) {
    const c = key ? H.input(ctx, key, path) : H.c(ctx.understanding, path);
    if (c.status !== STATUS.UNKNOWN) return c;
  }
  return claim(null, STATUS.UNKNOWN);
}

const subjectTo = defineAgent({
  declaration: {
    id: 'subject_to', name: 'Subject-To Agent', domain: 'creative_finance', version: '1.0.0',
    capabilities: ['subject_to_viability', 'cash_to_close', 'equity_capture', 'monthly_spread'],
    required_inputs: ['loan_balance', 'monthly_payment', 'market_value'], outputs: ['subject_to_analysis'],
    tools: ['deal_graph.read', 'calc.subject_to'], knowledge_sources: ['seller mortgage information', 'deal understanding'],
    permissions: 'RECOMMEND', risk_level: 'high', handoff_agents: [], jurisdiction_aware: true, last_knowledge_update: H.KNOWLEDGE_DATE,
  },
  async analyze(ctx) {
    const rep = ctx.understanding;
    const bal = H.input(ctx, 'loan_balance', 'property.financing.loan_balance');
    const piti = H.input(ctx, 'monthly_payment', 'property.financing.monthly_payment');
    const value = H.input(ctx, 'market_value', 'financial.as_is_value');
    const rate = H.input(ctx, 'interest_rate', 'property.financing.interest_rate');
    const arrears = H.input(ctx, 'arrears', 'property.financing.arrears');
    const rent = H.input(ctx, 'monthly_rent', 'financial.market_rent');
    const price = priceClaim(ctx);
    const req = [['property.financing.loan_balance', bal], ['property.financing.monthly_payment', piti], ['financial.as_is_value', value]];
    const missing = req.filter(([, c]) => c.status === STATUS.UNKNOWN).map(([p]) => H.missingItem(p));
    if (missing.length) {
      return { status: 'insufficient_data', summary: 'I cannot evaluate subject-to without the loan balance, monthly payment and property value.', missing, confidence: { score: 0, reasoning: 'Required mortgage facts are unknown.' }, attorney_review: true };
    }
    const calc = S.subjectTo({
      purchase_price: price.status !== STATUS.UNKNOWN ? price.value : bal.value, existing_loan_balance: bal.value, existing_monthly_piti: piti.value,
      arrears: arrears.status !== STATUS.UNKNOWN ? arrears.value : 0, market_value: value.value, monthly_rent: rent.status !== STATUS.UNKNOWN ? rent.value : 0,
    });
    const inputsUsed = [bal, piti, value, ...(price.status !== STATUS.UNKNOWN ? [price] : [])];
    const risks = [
      { risk: 'Due-on-sale: the lender may call the loan when title transfers.', severity: 'high', category: 'legal', mitigation: 'Attorney review of the note and deed of trust; plan a refinance or sale exit if the loan is called.' },
      { risk: 'The loan stays in the seller\'s name; missed payments damage the seller\'s credit and expose you to claims.', severity: 'high', category: 'operational', mitigation: 'Use a loan servicing company and document payment obligations.' },
    ];
    if (arrears.status === STATUS.UNKNOWN) risks.push({ risk: 'Arrears are unknown; past-due amounts must be cured to stop foreclosure.', severity: 'medium', category: 'financial', mitigation: 'Get a reinstatement quote from the servicer.' });
    if (rate.status === STATUS.UNKNOWN) risks.push({ risk: 'The interest rate is unknown, so the advantage of keeping this loan cannot be judged.', severity: 'low', category: 'financing', mitigation: 'Get the mortgage statement.' });
    const viable = calc.output.equity_at_purchase > 0 && (rent.status === STATUS.UNKNOWN || calc.output.monthly_spread >= 0);
    return {
      summary: `Cash needed at close ${H.money(calc.output.cash_needed_at_close)}; equity at purchase ${H.money(calc.output.equity_at_purchase)}${rent.status !== STATUS.UNKNOWN ? `; monthly spread ${H.money(calc.output.monthly_spread)}` : ''}.`,
      findings: [
        H.finding('Cash needed at close', derived(calc.output.cash_needed_at_close, inputsUsed)),
        H.finding('Equity at purchase', derived(calc.output.equity_at_purchase, [value, bal])),
        ...(rent.status !== STATUS.UNKNOWN ? [H.finding('Monthly spread (rent − PITI − other)', derived(calc.output.monthly_spread, [rent, piti]))] : []),
      ],
      calculations: [calc], risks,
      missing: [...(rent.status === STATUS.UNKNOWN ? [H.missingItem('financial.market_rent')] : []), ...(rate.status === STATUS.UNKNOWN ? [H.missingItem('property.financing.interest_rate')] : []), ...(arrears.status === STATUS.UNKNOWN ? [H.missingItem('property.financing.arrears')] : [])],
      recommendations: viable ? [{ action: 'Request the mortgage statement and have an attorney review the loan documents', why: 'The numbers can work, but transfer rules and servicing must be confirmed first.', urgency: 'medium', impact: 'Confirms whether subject-to can be offered', assigned_to: 'operator' }] : [],
      confidence: H.evidenceConfidence({ b: bal, p: piti, v: value, r: rate }, ['b', 'p', 'v', 'r'], { base: 80 }),
      sources: inputsUsed.filter(x => x.source).map(x => ({ name: x.source })),
      attorney_review: true, data: { viable_on_numbers: viable, legal_note: LEGAL_NOTE },
    };
  },
});

const sellerFinance = defineAgent({
  declaration: {
    id: 'seller_finance', name: 'Seller Finance Agent', domain: 'creative_finance', version: '1.0.0',
    capabilities: ['seller_finance_structures', 'amortization', 'balloon', 'seller_yield'],
    required_inputs: ['purchase_price'], outputs: ['seller_finance_structures'],
    tools: ['calc.seller_finance', 'calc.amortization_schedule'], knowledge_sources: ['deal understanding', 'operator terms'],
    permissions: 'RECOMMEND', risk_level: 'high', handoff_agents: [], jurisdiction_aware: true, last_knowledge_update: H.KNOWLEDGE_DATE,
  },
  async analyze(ctx) {
    const price = priceClaim(ctx);
    if (price.status === STATUS.UNKNOWN) {
      return { status: 'insufficient_data', summary: 'I cannot design seller-finance terms without a price (asking, offer or contract).', missing: [H.missingItem('transaction.asking_price')], confidence: { score: 0, reasoning: 'No price to structure.' }, attorney_review: true };
    }
    // Operator terms win. Otherwise three illustrative term sets, each disclosed as an assumption.
    const provided = ctx.inputs && ctx.inputs.rate_pct != null ? [{ label: 'Operator terms', down_pct: Number(ctx.inputs.down_payment_pct ?? 10), rate_pct: Number(ctx.inputs.rate_pct), amortization_months: Number(ctx.inputs.amortization_months ?? 360), balloon_month: ctx.inputs.balloon_month != null ? Number(ctx.inputs.balloon_month) : null }] : null;
    const termSets = provided || [
      { label: 'Illustrative A: 10% down, 6% rate, 30-year amortization, 5-year balloon', down_pct: 10, rate_pct: 6, amortization_months: 360, balloon_month: 60 },
      { label: 'Illustrative B: 5% down, 4% rate, 30-year amortization, 7-year balloon', down_pct: 5, rate_pct: 4, amortization_months: 360, balloon_month: 84 },
      { label: 'Illustrative C: 20% down, 7% rate, 20-year amortization, no balloon', down_pct: 20, rate_pct: 7, amortization_months: 240, balloon_month: null },
    ];
    const calculations = [];
    const structures = termSets.map(t => {
      const calc = S.sellerFinance({ purchase_price: price.value, down_payment: Math.round(price.value * t.down_pct / 100), rate_pct: t.rate_pct, amortization_months: t.amortization_months, balloon_month: t.balloon_month ?? t.amortization_months });
      calculations.push(calc);
      return { label: t.label, terms: t, ...calc.output };
    });
    const rent = H.c(ctx.understanding, 'financial.market_rent');
    const rentCheck = rent.status !== STATUS.UNKNOWN ? structures.map(s => ({ label: s.label, rent_minus_payment: Math.round((rent.value - s.monthly_payment) * 100) / 100 })) : null;
    return {
      summary: `${structures.length} seller-finance structure(s) on a price of ${H.money(price.value)} (${price.status.toLowerCase()}).${provided ? '' : ' Terms are illustrative - replace them with what the seller will accept.'}`,
      findings: structures.map(s => H.finding(`${s.label}: monthly payment`, claim(s.monthly_payment, STATUS.CALCULATED, { source: 'calculation engine', basis: `price ${price.status}` }))),
      calculations,
      risks: [
        { risk: 'Balloon payments require a refinance or sale by the due date; if neither is possible the buyer defaults.', severity: 'high', category: 'exit', mitigation: 'Model the refinance at the balloon date with conservative rates and value.' },
        { risk: 'If the seller still has a mortgage, a wrap or seller carry may trigger the due-on-sale clause.', severity: 'high', category: 'legal', mitigation: 'Confirm the property is free and clear or have an attorney structure the wrap.' },
      ],
      missing: rent.status === STATUS.UNKNOWN ? [H.missingItem('financial.market_rent')] : [],
      confidence: { score: provided ? 70 : 45, reasoning: `Payments are exact for the stated terms; ${provided ? 'terms supplied by the operator' : 'terms are illustrative, not agreed'}; price is ${price.status.toLowerCase()}.` },
      attorney_review: true,
      data: { structures, rent_check: rentCheck, legal_note: LEGAL_NOTE, illustrative: !provided },
    };
  },
});

const creativeFinance = defineAgent({
  declaration: {
    id: 'creative_finance', name: 'Creative Finance Agent', domain: 'creative_finance', version: '1.0.0',
    capabilities: ['creative_applicability', 'structure_routing'],
    required_inputs: ['deal_understanding'], outputs: ['creative_finance_assessment'],
    tools: ['deal_graph.read'], knowledge_sources: ['deal understanding', 'wholesale analysis'],
    permissions: 'RECOMMEND', risk_level: 'high', handoff_agents: ['subject_to', 'seller_finance'], jurisdiction_aware: true, last_knowledge_update: H.KNOWLEDGE_DATE,
  },
  async analyze(ctx) {
    const rep = ctx.understanding;
    const bal = H.c(rep, 'property.financing.loan_balance');
    const value = H.c(rep, 'financial.as_is_value');
    const equity = H.c(rep, 'financial.equity');
    const wholesaleVerdict = ctx.priorOutputs?.wholesale?.data?.verdict;
    const assessments = [];
    const handoffs = [];
    if (bal.status !== STATUS.UNKNOWN && Number(bal.value) > 0) {
      assessments.push({ structure: 'subject_to', applicable: 'possible', why: `There is an existing loan (${H.money(bal.value)}, ${bal.status.toLowerCase()}).` });
      handoffs.push('subject_to');
    } else {
      assessments.push({ structure: 'subject_to', applicable: bal.status === STATUS.UNKNOWN ? 'unknown' : 'no', why: bal.status === STATUS.UNKNOWN ? 'Loan balance unknown.' : 'No existing loan to take over.' });
    }
    if (equity.status !== STATUS.UNKNOWN && value.value > 0 && equity.value / value.value >= 0.3) {
      assessments.push({ structure: 'seller_finance', applicable: 'possible', why: `Equity is about ${Math.round((equity.value / value.value) * 100)}% of value (${equity.status.toLowerCase()}), enough for the seller to carry a note.` });
      handoffs.push('seller_finance');
    } else if (bal.status !== STATUS.UNKNOWN && Number(bal.value) === 0) {
      assessments.push({ structure: 'seller_finance', applicable: 'possible', why: 'Property appears free and clear.' });
      handoffs.push('seller_finance');
    } else {
      assessments.push({ structure: 'seller_finance', applicable: 'unknown', why: 'Equity is unknown or thin.' });
      handoffs.push('seller_finance');
    }
    assessments.push({ structure: 'lease_option', applicable: H.known(rep, 'financial.market_rent') ? 'possible' : 'unknown', why: H.known(rep, 'financial.market_rent') ? 'Market rent is on record to size an option payment.' : 'Market rent unknown.' });
    assessments.push({ structure: 'novation', applicable: H.val(rep, 'property.condition') ? 'possible' : 'unknown', why: 'Novation fits sellers who want closer to retail and a property that can be listed after light work; needs condition and retail value.' });
    return {
      summary: `${assessments.filter(a => a.applicable === 'possible').length} creative structure(s) possibly applicable${wholesaleVerdict === 'above_mao' ? '; the seller\'s price is above cash MAO, which is when terms matter most' : ''}.`,
      findings: assessments.map(a => H.finding(`${a.structure} applicability`, claim(a.applicable, STATUS.INFERRED, { basis: a.why }))),
      missing: H.missingFrom(rep, ['property.financing.loan_balance', 'property.financing.interest_rate', 'people.seller.objectives']),
      confidence: H.evidenceConfidence(rep, ['property.financing.loan_balance', 'financial.as_is_value', 'financial.market_rent', 'property.condition'], { base: 75 }),
      attorney_review: true, handoffs,
      data: { assessments, legal_note: LEGAL_NOTE },
    };
  },
});

module.exports = { creativeFinance, subjectTo, sellerFinance, LEGAL_NOTE };
