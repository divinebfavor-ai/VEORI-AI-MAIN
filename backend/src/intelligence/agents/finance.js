// ─── Finance domain: FinancingAgent ─────────────────────────────────────────
// Ranks financing routes by fit to the deal. Lender pricing changes daily and no
// rate feed is connected, so costs are computed only from terms the operator
// supplies (inputs.lender_terms) - never from assumed market rates.

const { defineAgent } = require('../agentKit');
const { claim, STATUS } = require('../provenance');
const S = require('../calc/strategies');
const H = require('./_shared');

const financing = defineAgent({
  declaration: {
    id: 'financing', name: 'Financing Agent', domain: 'finance', version: '1.0.0',
    capabilities: ['financing_options', 'financing_cost_comparison', 'dscr_sizing'],
    required_inputs: ['deal_understanding'], outputs: ['financing_options'],
    tools: ['deal_graph.read', 'calc.hard_money', 'calc.dscr_max_loan', 'calc.monthly_payment'],
    knowledge_sources: ['deal understanding', 'operator-supplied lender terms'],
    permissions: 'RECOMMEND', risk_level: 'medium', handoff_agents: [], jurisdiction_aware: false, last_knowledge_update: H.KNOWLEDGE_DATE,
  },
  async analyze(ctx) {
    const rep = ctx.understanding;
    const price = [H.input(ctx, 'purchase_price'), H.c(rep, 'transaction.contract_price'), H.c(rep, 'transaction.offer_price')].find(c => c.status !== STATUS.UNKNOWN) || claim(null, STATUS.UNKNOWN);
    const value = H.c(rep, 'financial.as_is_value');
    const arv = H.c(rep, 'financial.arv');
    const repairs = H.c(rep, 'financial.repairs');
    const rent = H.c(rep, 'financial.market_rent');
    const loanBal = H.c(rep, 'property.financing.loan_balance');
    const terms = ctx.inputs?.lender_terms || {};
    const calculations = [];
    const options = [];

    const holdMonths = Number(terms.hold_months) || null;
    // Hard money / private money: short-term, suits flips and wholesale double closes.
    const hm = { route: 'hard_money', fit: repairs.status !== STATUS.UNKNOWN || arv.status !== STATUS.UNKNOWN ? 'good for fix-and-flip or short holds' : 'possible', cost: null, needs: [] };
    if (terms.hard_money && price.value != null) {
      const t = terms.hard_money;
      const loanAmount = t.loan_amount != null ? Number(t.loan_amount) : Math.round(Number(price.value) * (Number(t.ltc_pct ?? 0) / 100));
      const c = S.hardMoney({ loan_amount: loanAmount, rate_pct: t.rate_pct, points_pct: t.points_pct, months: t.months ?? holdMonths, lender_fees: t.lender_fees, property_value: arv.value ?? value.value ?? undefined });
      calculations.push(c); hm.cost = c.output.total_financing_cost; hm.terms_source = 'operator-supplied quote';
    } else hm.needs.push('A hard money quote: rate, points, fees, max LTC/LTV and term');
    options.push(hm);

    // DSCR: rental exit, sized from NOI.
    const dscrOpt = { route: 'dscr_loan', fit: rent.status !== STATUS.UNKNOWN ? 'possible for a rental exit' : 'unknown - needs rent', cost: null, needs: [] };
    if (terms.dscr && ctx.inputs?.annual_noi != null) {
      const t = terms.dscr;
      const c = S.dscrLoan({ annual_noi: ctx.inputs.annual_noi, rate_pct: t.rate_pct, term_months: t.term_months ?? 360, min_dscr: t.min_dscr, property_value: value.value ?? arv.value ?? null, max_ltv_pct: t.max_ltv_pct ?? null });
      calculations.push(c); dscrOpt.max_loan = c.output.max_loan; dscrOpt.binding_constraint = c.output.binding_constraint; dscrOpt.terms_source = 'operator-supplied quote';
    } else dscrOpt.needs.push('Annual NOI and a DSCR lender quote (rate, minimum DSCR, max LTV)');
    options.push(dscrOpt);

    options.push({ route: 'conventional', fit: 'possible for owner-occupants or long holds; slow to close and usually requires the property to be in lendable condition', needs: ['Borrower qualification and a lender quote'] });
    options.push({ route: 'cash', fit: price.value != null ? `requires ${H.money(price.value)} plus closing costs` : 'price unknown', needs: price.value == null ? ['Purchase price'] : [] });
    options.push({ route: 'seller_finance', fit: loanBal.status !== STATUS.UNKNOWN && Number(loanBal.value) === 0 ? 'possible - property appears free and clear' : 'depends on seller equity and existing liens', needs: ['Seller willingness and terms'] });
    if (loanBal.status !== STATUS.UNKNOWN && Number(loanBal.value) > 0) options.push({ route: 'subject_to_existing_loan', fit: 'possible - see Subject-To analysis', needs: ['Mortgage statement', 'Attorney review'] });
    options.push({ route: 'equity_partner_jv', fit: 'possible when cash is the constraint', needs: ['Partner terms: contribution, preferred return, split'] });

    const priced = options.filter(o => o.cost != null).sort((a, b) => a.cost - b.cost);
    return {
      status: 'complete',
      summary: `${options.length} financing routes evaluated; ${priced.length ? `${priced.length} priced from your quotes` : 'none priced - no lender terms supplied and no rate feed is connected'}.`,
      findings: options.map(o => H.finding(`${o.route}`, claim(o.fit, STATUS.INFERRED, { basis: o.needs.length ? `needs: ${o.needs.join('; ')}` : null }))),
      calculations,
      missing: [
        ...(price.status === STATUS.UNKNOWN ? [H.missingItem('transaction.contract_price')] : []),
        ...(!terms.hard_money && !terms.dscr ? [{ item: 'Lender quotes', why_it_matters: 'Financing cost changes returns and break-even; rates are not assumed.', how_to_get: 'Request term sheets from 2-3 lenders, then enter rate, points, fees and LTV.' }] : []),
      ],
      confidence: { score: priced.length ? 70 : 40, reasoning: priced.length ? 'Costs computed from operator-supplied lender terms.' : 'Routes ranked by fit only; no lender pricing available to compare cost.' },
      data: { options, ranked_by_cost: priced.map(o => ({ route: o.route, total_cost: o.cost })) },
    };
  },
});

module.exports = { financing };
