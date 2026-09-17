// ─── Disposition domain: DispositionAgent, BuyerMatchingAgent ───────────────

const { defineAgent } = require('../agentKit');
const { claim, STATUS } = require('../provenance');
const buyerDispo = require('../../services/buyerDispoService');
const supabase = require('../../config/supabase');
const H = require('./_shared');

const disposition = defineAgent({
  declaration: {
    id: 'disposition', name: 'Disposition Agent', domain: 'disposition', version: '1.0.0',
    capabilities: ['exit_strategy_selection', 'deal_package_readiness'],
    required_inputs: ['deal_understanding'], outputs: ['disposition_plan'],
    tools: ['deal_graph.read'], knowledge_sources: ['deal understanding', 'wholesale analysis', 'buyer matches'],
    permissions: 'RECOMMEND', risk_level: 'medium', handoff_agents: ['buyer_matching'], jurisdiction_aware: false, last_knowledge_update: H.KNOWLEDGE_DATE,
  },
  async analyze(ctx) {
    const rep = ctx.understanding;
    const w = ctx.priorOutputs?.wholesale;
    const rent = H.c(rep, 'financial.market_rent');
    const arv = H.c(rep, 'financial.arv');
    const exits = [
      { exit: 'assign_to_cash_buyer', viability: w?.data?.mao != null ? (w.data.verdict === 'above_mao' ? 'weak - price above MAO' : 'possible') : 'unknown - needs MAO', needs: ['ARV evidence', 'repair estimate', 'photos', 'access'] },
      { exit: 'double_close', viability: w?.data?.mao != null ? 'possible when assignment is restricted or the fee should stay private' : 'unknown', needs: ['transactional funding', 'two closings scheduled'] },
      { exit: 'sell_to_landlord', viability: rent.status !== STATUS.UNKNOWN ? 'possible - rent on record' : 'unknown - needs rent', needs: ['rent comps', 'expense estimate'] },
      { exit: 'fix_and_flip_retail', viability: arv.status !== STATUS.UNKNOWN ? 'possible - requires capital and rehab management' : 'unknown - needs ARV', needs: ['rehab budget', 'financing'] },
      { exit: 'creative_terms_resale', viability: 'depends on seller terms', needs: ['agreed seller-finance or subject-to terms'] },
    ];
    const pkg = [
      { item: 'Photos', ready: false, note: 'Photo availability is not tracked in the deal understanding yet' },
      { item: 'ARV with sold comparables', ready: ctx.priorOutputs?.arv?.data?.status === STATUS.CALCULATED },
      { item: 'Repair estimate', ready: H.known(rep, 'financial.repairs') },
      { item: 'Buyer price', ready: H.known(rep, 'transaction.buyer_price') || w?.data?.end_buyer_max_price != null },
      { item: 'Signed purchase agreement', ready: (H.val(rep, 'transaction.contracts') || []).some(c => c.status === 'fully_signed') },
    ];
    return {
      summary: `${exits.filter(e => e.viability.startsWith('possible')).length} exit(s) possible; deal package ${pkg.filter(p => p.ready).length}/${pkg.length} ready.`,
      findings: exits.map(e => H.finding(e.exit, claim(e.viability, STATUS.INFERRED, { basis: `needs: ${e.needs.join(', ')}` }))),
      recommendations: pkg.filter(p => !p.ready).slice(0, 2).map(p => ({ action: `Prepare: ${p.item}`, why: 'Buyers ask for it before committing; missing items slow disposition.', urgency: 'medium', impact: 'Faster buyer commitment', assigned_to: 'operator' })),
      missing: H.missingFrom(rep, ['financial.arv', 'financial.repairs', 'financial.market_rent']),
      confidence: H.evidenceConfidence(rep, ['financial.arv', 'financial.repairs', 'financial.market_rent', 'transaction.contract_price'], { base: 75 }),
      handoffs: ['buyer_matching'],
      data: { exits, package_checklist: pkg },
    };
  },
});

function criteriaReport(b, deal) {
  const specific = [];
  const open = [];
  const state = (deal.property_state || '').toUpperCase();
  const check = (list, value, label, norm = (x) => String(x).trim().toLowerCase()) => {
    const arr = (list || []).map(norm).filter(Boolean);
    if (!arr.length) open.push(`${label}: any`);
    else if (value && arr.includes(norm(value))) specific.push(`${label}: ${value}`);
  };
  check(b.buy_box_states, state, 'state', (x) => String(x).trim().toUpperCase());
  check(b.property_cities, deal.property_city, 'city');
  check(b.buy_box_zips, String(deal.property_zip || '').slice(0, 5), 'zip', (x) => String(x).trim().slice(0, 5));
  check(b.buy_box_types, deal.property_type, 'property type');
  if (b.max_price != null) specific.push(`max price ${H.money(b.max_price)}`); else open.push('max price: none set');
  return { specific, open };
}

const buyerMatching = defineAgent({
  declaration: {
    id: 'buyer_matching', name: 'Buyer Matching Agent', domain: 'disposition', version: '1.0.0',
    capabilities: ['buyer_ranking', 'match_criteria'],
    required_inputs: ['deal_understanding'], outputs: ['buyer_matches'],
    tools: ['buyerDispoService.matchBuyers', 'buyers.read'], knowledge_sources: ['operator buyer list', 'buyer deal history'],
    permissions: 'RECOMMEND', risk_level: 'low', handoff_agents: [], jurisdiction_aware: false, last_knowledge_update: H.KNOWLEDGE_DATE,
  },
  async analyze(ctx) {
    const rep = ctx.understanding;
    const deal = {
      user_id: ctx.userId,
      property_state: H.val(rep, 'property.state'), property_city: H.val(rep, 'property.city'), property_zip: H.val(rep, 'property.zip'),
      property_type: H.val(rep, 'property.property_type'),
      buyer_price: H.val(rep, 'transaction.buyer_price') ?? ctx.priorOutputs?.wholesale?.data?.end_buyer_max_price ?? null,
      offer_price: H.val(rep, 'transaction.offer_price'), seller_agreed_price: H.val(rep, 'transaction.contract_price'),
    };
    const tools = ctx.tools?.matchBuyers ? ctx.tools : buyerMatching.defaultTools;
    const matches = await tools.matchBuyers(deal);
    // Tenant isolation: only this operator's buyers are named; opted-in pool buyers are counted.
    const own = matches.filter(b => b.user_id === ctx.userId);
    const poolCount = matches.length - own.length;
    const ids = own.map(b => b.id);
    let history = {};
    if (ids.length) {
      const { data } = await tools.supabase.from('buyer_deal_history').select('buyer_id').eq('user_id', ctx.userId).in('buyer_id', ids.slice(0, 500));
      history = (data || []).reduce((m, r) => { m[r.buyer_id] = (m[r.buyer_id] || 0) + 1; return m; }, {});
    }
    const ranked = own.map(b => {
      const crit = criteriaReport(b, deal);
      const score = crit.specific.length * 10 + (b.proof_of_funds ? 8 : 0) + (b.cash_only ? 4 : 0) + Math.min(10, (history[b.id] || 0) * 5);
      return { buyer_id: b.id, name: b.name, score, matched_criteria: crit.specific, open_criteria: crit.open, proof_of_funds: !!b.proof_of_funds, cash_only: !!b.cash_only, past_deals: history[b.id] || 0 };
    }).sort((a, b) => b.score - a.score);
    const askBasis = H.known(rep, 'transaction.buyer_price') ? 'buyer price on record' : ctx.priorOutputs?.wholesale?.data?.end_buyer_max_price != null ? 'wholesale end-buyer max price' : 'no price (buyers not price-filtered)';
    return {
      status: 'complete',
      summary: `${ranked.length} of your buyers fit this deal${poolCount ? `, plus ${poolCount} shared-pool buyer(s)` : ''}. Price filter: ${askBasis}.`,
      findings: [H.finding('matching buyers', claim(ranked.length, STATUS.VERIFIED, { source: 'your buyer list' }))],
      recommendations: ranked.length ? [{ action: `Send the deal to the top ${Math.min(ranked.length, 10)} matched buyers`, why: 'They match on location, type and price as shown.', urgency: 'medium', impact: 'Starts disposition', action_type: 'send_sms', assigned_to: 'operator' }]
        : [{ action: 'Add cash buyers who buy in this area', why: 'No buyer on your list matches this deal.', urgency: 'high', impact: 'Creates an exit', assigned_to: 'operator' }],
      missing: H.known(rep, 'property.property_type') ? [] : [H.missingItem('property.property_type')],
      confidence: { score: 85, reasoning: 'Matches computed from your buyer list criteria; buyer interest is not confirmed until they respond.' },
      data: { ranked: ranked.slice(0, 50), pool_buyer_count: poolCount, price_basis: askBasis, total_matches: ranked.length },
    };
  },
});

buyerMatching.defaultTools = { matchBuyers: buyerDispo.matchBuyers, supabase };

module.exports = { disposition, buyerMatching, criteriaReport };
