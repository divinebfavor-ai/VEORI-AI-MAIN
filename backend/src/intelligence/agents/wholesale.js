// ─── Wholesale domain: WholesaleAgent ───────────────────────────────────────

const { defineAgent } = require('../agentKit');
const { claim, STATUS, derived } = require('../provenance');
const S = require('../calc/strategies');
const BE = require('../calc/breakEven');
const H = require('./_shared');

// Best available ARV: this request's input > ARV agent output > deal record.
function arvClaim(ctx) {
  const explicit = H.input(ctx, 'arv');
  if (explicit.status !== STATUS.UNKNOWN) return explicit;
  const out = ctx.priorOutputs?.arv;
  if (out && out.data && out.data.value != null) return claim(out.data.value, out.data.status, { source: `ARV Agent (${out.data.basis})`, confidence: out.confidence?.score });
  return H.c(ctx.understanding, 'financial.arv');
}

const wholesale = defineAgent({
  declaration: {
    id: 'wholesale', name: 'Wholesale Agent', domain: 'wholesale', version: '1.0.0',
    capabilities: ['mao', 'assignment_fee', 'assignment_vs_double_close', 'wholesale_break_even'],
    required_inputs: ['deal_understanding', 'arv', 'repairs'], outputs: ['wholesale_analysis'],
    tools: ['deal_graph.read', 'calc.wholesale_mao', 'calc.assignment_fee', 'calc.double_close', 'calc.wholesale_break_even'],
    knowledge_sources: ['deal understanding', 'ARV Agent output', 'operator inputs'],
    permissions: 'HIGH_RISK', risk_level: 'high', handoff_agents: ['buyer_matching', 'disposition'], jurisdiction_aware: true, last_knowledge_update: H.KNOWLEDGE_DATE,
  },
  async analyze(ctx) {
    const rep = ctx.understanding;
    const arvC = arvClaim(ctx);
    const repairsC = H.input(ctx, 'repairs', 'financial.repairs');
    const missing = [];
    if (arvC.status === STATUS.UNKNOWN) missing.push(H.missingItem('financial.arv'));
    if (repairsC.status === STATUS.UNKNOWN) missing.push(H.missingItem('financial.repairs'));
    if (missing.length) {
      return {
        status: 'insufficient_data', summary: 'I cannot calculate a maximum offer: ARV and a repair estimate are both required.',
        missing, confidence: { score: 0, reasoning: 'MAO depends directly on ARV and repairs; at least one is unknown.' },
      };
    }
    const inputs = {
      arv: arvC.value, repairs: repairsC.value,
      flip_factor_pct: ctx.inputs?.flip_factor_pct, assignment_fee: ctx.inputs?.assignment_fee ?? ctx.inputs?.target_fee,
      closing_holding_buffer: ctx.inputs?.closing_holding_buffer,
    };
    const mao = S.wholesaleMao(inputs);
    const maoClaim = derived(mao.output.mao, [arvC, repairsC], { basis: mao.formula });
    const calculations = [mao];
    const findings = [H.finding('ARV used', arvC), H.finding('Repairs used', repairsC), H.finding('Maximum allowable offer', maoClaim), H.finding('End buyer maximum price', derived(mao.output.end_buyer_max_price, [arvC, repairsC]))];

    const asking = H.input(ctx, 'asking_price', 'transaction.asking_price');
    const offer = H.c(rep, 'transaction.offer_price');
    const contract = H.input(ctx, 'contract_price', 'transaction.contract_price');
    const buyer = H.input(ctx, 'buyer_price', 'transaction.buyer_price');
    const priceToTest = contract.status !== STATUS.UNKNOWN ? { label: 'contract price', c: contract } : asking.status !== STATUS.UNKNOWN ? { label: 'asking price', c: asking } : offer.status !== STATUS.UNKNOWN ? { label: 'offer on record', c: offer } : null;
    let verdict = 'unknown';
    if (priceToTest) {
      const gap = mao.output.mao - Number(priceToTest.c.value);
      verdict = gap >= 0 ? 'works_at_price' : 'above_mao';
      findings.push(H.finding(`Room between MAO and ${priceToTest.label}`, derived(gap, [maoClaim, priceToTest.c], { basis: `MAO − ${priceToTest.label}` })));
    }
    if (contract.status !== STATUS.UNKNOWN && buyer.status !== STATUS.UNKNOWN) {
      const fee = S.assignmentFee({ contract_price: contract.value, buyer_price: buyer.value });
      calculations.push(fee);
      findings.push(H.finding('Assignment fee at current prices', derived(fee.output.assignment_fee, [contract, buyer], { basis: fee.formula })));
    }
    const be = BE.wholesaleBreakEven({ ...inputs, contract_price: contract.status !== STATUS.UNKNOWN ? contract.value : null, target_fee: Number(ctx.inputs?.target_fee) || 0 });
    calculations.push(be);

    const risks = [];
    if (![STATUS.VERIFIED, STATUS.CALCULATED].includes(arvC.status)) risks.push({ risk: `ARV is ${arvC.status.toLowerCase()} (${arvC.source || 'unknown source'}); an overstated ARV overstates MAO dollar for dollar ×${(mao.inputs.flip_factor_pct / 100).toFixed(2)}.`, severity: 'high', category: 'valuation', mitigation: 'Confirm ARV with 3+ renovated sold comparables before contracting.' });
    if (repairsC.status !== STATUS.VERIFIED) risks.push({ risk: `Repair estimate is ${repairsC.status.toLowerCase()}; every $1 of underestimated repairs comes straight out of MAO.`, severity: 'medium', category: 'construction', mitigation: 'Get a contractor walkthrough or add an inspection contingency.' });
    if (verdict === 'above_mao') risks.push({ risk: `The ${priceToTest.label} is above MAO; a cash wholesale does not work at this price.`, severity: 'high', category: 'financial', mitigation: 'Negotiate down, or evaluate creative finance terms.' });

    const assignmentFactors = [
      'Whether the purchase agreement allows assignment (read the assignment clause; many standard forms restrict it).',
      'Whether the state regulates wholesaling or requires disclosure of the assignment - verify for this jurisdiction with a local attorney.',
      'Whether the end buyer\'s lender accepts an assignment (many institutional lenders do not; a double close avoids this).',
      'Whether disclosing the fee to seller and buyer on a settlement statement is a problem - a double close keeps the two sides separate but costs a second closing and transactional funding.',
    ];
    const recommendations = [];
    if (verdict === 'above_mao') {
      recommendations.push({ action: `Do not offer above ${H.money(mao.output.mao)}; re-negotiate or evaluate creative terms`, why: `The ${priceToTest.label} of ${H.money(priceToTest.c.value)} exceeds MAO by ${H.money(Number(priceToTest.c.value) - mao.output.mao)}.`, urgency: 'high', impact: 'Avoids a deal with no spread', assigned_to: 'operator' });
    } else {
      recommendations.push({ action: `Prepare an offer at or below ${H.money(mao.output.mao)}`, why: `MAO from ARV ${H.money(arvC.value)} and repairs ${H.money(repairsC.value)}; submitting it requires your approval.`, urgency: 'medium', impact: `Leaves room for a ${H.money(mao.inputs.assignment_fee)} fee`, action_type: 'submit_offer', payload: { max_price: mao.output.mao, basis: 'wholesale MAO' }, assigned_to: 'operator' });
    }
    const conf = H.evidenceConfidence({ a: arvC, r: repairsC }, ['a', 'r'], { base: 85 });
    return {
      summary: `MAO ${H.money(mao.output.mao)} (end buyer max ${H.money(mao.output.end_buyer_max_price)}).${priceToTest ? ` The ${priceToTest.label} ${verdict === 'above_mao' ? 'is above' : 'is within'} MAO.` : ' No asking or contract price on record to compare.'}`,
      findings, calculations, risks, recommendations,
      missing: [...(asking.status === STATUS.UNKNOWN && contract.status === STATUS.UNKNOWN ? [H.missingItem('transaction.asking_price')] : []), ...(!H.known(rep, 'property.condition') ? [H.missingItem('property.condition')] : [])],
      confidence: conf, sources: [arvC, repairsC].filter(x => x.source).map(x => ({ name: x.source })),
      positions: { 'offer.max_price': mao.output.mao },
      attorney_review: true, handoffs: ['buyer_matching', 'disposition'],
      data: { mao: mao.output.mao, end_buyer_max_price: mao.output.end_buyer_max_price, verdict, assumptions: mao.assumptions, assignment_vs_double_close_factors: assignmentFactors },
    };
  },
});

module.exports = { wholesale, arvClaim };
