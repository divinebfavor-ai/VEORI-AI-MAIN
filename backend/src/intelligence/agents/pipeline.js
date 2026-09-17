// ─── Pipeline intelligence: LeadScoringAgent, LeadGenerationAgent,
//     NegotiationIntelligenceAgent, BuyerIntelligenceAgent, PortfolioAgent ──────
// Rates come from the workspace's own history with Wilson confidence intervals.
// Nothing here presents a probability as a certainty or invents a benchmark.

const { defineAgent } = require('../agentKit');
const { claim, STATUS } = require('../provenance');
const core = require('../calc/core');
const llm = require('../llm');
const supabaseDefault = require('../../config/supabase');
const H = require('./_shared');

const decl = (id, name, domain, capabilities, outputs, extra = {}) => ({
  id, name, domain, version: '1.0.0', capabilities, required_inputs: ['deal_understanding'], outputs,
  tools: ['deal_graph.read', 'db.read_workspace'], knowledge_sources: ['workspace history'], permissions: 'RECOMMEND', risk_level: 'low',
  handoff_agents: [], jurisdiction_aware: false, last_knowledge_update: H.KNOWLEDGE_DATE, ...extra,
});
const db = (ctx) => ctx.tools?.supabase || supabaseDefault;

// Wilson score interval for k successes in n trials (95%).
function wilson(k, n, z = 1.96) {
  if (!n) return { rate_pct: null, low_pct: null, high_pct: null, n: 0, k };
  const p = k / n;
  const denom = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { rate_pct: core.round2(p * 100), low_pct: core.round2(Math.max(0, center - margin) * 100), high_pct: core.round2(Math.min(1, center + margin) * 100), n, k };
}

const STAGES = [['response', 'responded'], ['appointment', 'appointment'], ['offer', 'offer'], ['contract', 'contract'], ['closing', 'closed']];

const leadScoring = defineAgent({
  declaration: decl('lead_scoring', 'Lead Scoring Agent', 'acquisition', ['response_probability', 'appointment_probability', 'offer_probability', 'contract_probability', 'closing_probability'], ['lead_scores']),
  async analyze(ctx) {
    const tag = H.val(ctx.understanding, 'property.distress.primary_tag');
    const all = await db(ctx).rpc('lead_funnel_counts', { p_user_id: ctx.userId });
    if (all.error) throw all.error;
    let segment = null;
    if (tag) {
      const seg = await db(ctx).rpc('lead_funnel_counts', { p_user_id: ctx.userId, p_primary_tag: tag });
      if (!seg.error) segment = seg.data;
    }
    const useSegment = segment && segment.leads >= 30;
    const base = useSegment ? segment : all.data;
    const probabilities = STAGES.map(([label, key]) => ({ outcome: label, ...wilson(base[key] || 0, base.leads || 0) }));
    const n = base.leads || 0;
    const anyEvents = STAGES.some(([, k]) => (base[k] || 0) > 0);
    return {
      status: n ? 'complete' : 'insufficient_data',
      summary: !n ? 'No lead history to base probabilities on.' : anyEvents
        ? `From ${n} ${useSegment ? `${tag} ` : ''}leads in your history: response ${probabilities[0].rate_pct}% (95% range ${probabilities[0].low_pct}-${probabilities[0].high_pct}%), closing ${probabilities[4].rate_pct}%.`
        : `Your ${n} leads have no recorded responses, appointments, offers or contracts yet, so probabilities can't be estimated above 0% (upper bound ${probabilities[0].high_pct}% response).`,
      findings: probabilities.map(p => H.finding(`${p.outcome} probability`, claim(p.rate_pct, STATUS.CALCULATED, { source: 'your lead history', basis: `${p.k} of ${p.n}; 95% interval ${p.low_pct}-${p.high_pct}%` }))),
      calculations: [{ name: 'wilson_interval', inputs: { counts: base, segment: useSegment ? tag : 'all leads' }, formula: 'rate = k ÷ n; 95% Wilson score interval', output: { probabilities }, assumptions: ['Historical base rates for similar leads in your workspace; this lead\'s own behaviour is not modelled', useSegment ? `Segment: primary tag "${tag}" (${segment.leads} leads)` : tag ? `Segment "${tag}" has ${segment?.leads ?? 0} leads (<30), so all leads are used` : 'No tag on this lead: all leads used'] }],
      confidence: { score: n >= 200 && anyEvents ? 60 : n >= 30 && anyEvents ? 40 : 15, reasoning: 'Base rates from your own history; small samples and zero-event histories give wide intervals.' },
      data: { probabilities, sample: n, segment: useSegment ? tag : null },
    };
  },
});

const leadGeneration = defineAgent({
  declaration: decl('lead_generation', 'Lead Generation Agent', 'acquisition', ['source_performance', 'cost_per_acquisition', 'sourcing_strategy'], ['sourcing_strategy']),
  async analyze(ctx) {
    const res = await db(ctx).rpc('lead_source_performance', { p_user_id: ctx.userId });
    if (res.error) throw res.error;
    const spend = ctx.inputs?.lead_source_spend && typeof ctx.inputs.lead_source_spend === 'object' ? ctx.inputs.lead_source_spend : null;
    const sources = (Array.isArray(res.data) ? res.data : []).map(s => {
      const cost = spend && H.pos(spend[s.source]) != null ? H.pos(spend[s.source]) : null;
      const contractRate = wilson(s.contracts, s.leads);
      return {
        ...s, contract_rate: contractRate,
        cost_per_lead: cost != null && s.leads ? core.round2(cost / s.leads) : null,
        cost_per_contract: cost != null && s.contracts ? core.round2(cost / s.contracts) : null,
        cost_per_closed_deal: cost != null && s.closed ? core.round2(cost / s.closed) : null,
        roi_pct: cost ? core.round2(((s.closed_fees - cost) / cost) * 100) : null,
      };
    });
    const ranked = [...sources].sort((a, b) => (a.cost_per_contract ?? Infinity) - (b.cost_per_contract ?? Infinity) || (b.contract_rate.rate_pct ?? 0) - (a.contract_rate.rate_pct ?? 0));
    const channels = ['county records / public lists', 'MLS expired and long days-on-market', 'direct mail', 'Google and Meta ads', 'zip-code targeted lists', 'data providers (connect BatchData / others)'];
    return {
      status: sources.length ? 'complete' : 'insufficient_data',
      summary: sources.length ? `${sources.length} lead source(s) on record; ${sources.some(s => s.contracts) ? `best contract rate: ${ranked[0].source}` : 'none has produced a contract yet'}. ${spend ? 'Cost per acquisition computed from your spend figures.' : 'No spend figures: cost per acquisition cannot be ranked.'}` : 'No leads on record, so sources cannot be compared.',
      findings: sources.map(s => H.finding(`${s.source}: contract rate`, claim(s.contract_rate.rate_pct, STATUS.CALCULATED, { source: 'your lead history', basis: `${s.contracts} of ${s.leads} leads; 95% ${s.contract_rate.low_pct}-${s.contract_rate.high_pct}%` }))),
      calculations: [{ name: 'source_performance', inputs: { spend_supplied: !!spend }, formula: 'contract rate = contracts ÷ leads; cost per contract = spend ÷ contracts; ROI = (closed fees − spend) ÷ spend', output: { sources: ranked }, assumptions: ['Spend figures as entered by you; attribution by the lead\'s source field'] }],
      missing: spend ? [] : [{ item: 'lead_source_spend', why_it_matters: 'Cost per acquisition needs what each source cost.', how_to_get: 'Enter total spend per source (e.g. {"csv_import": 1200, "lead_engine": 0}).' }],
      recommendations: [{ action: 'Track spend per source and tag every lead with its source', why: 'Without cost and outcome by source, channels cannot be ranked by cost per deal.', urgency: 'medium', impact: 'Lets budget move to the channels that close', assigned_to: 'operator' }],
      confidence: { score: sources.some(s => s.contracts) ? 45 : 15, reasoning: 'Based on your own recorded outcomes; channels without history cannot be scored.' },
      data: { sources: ranked, candidate_channels: channels },
    };
  },
});

const negotiation = defineAgent({
  declaration: decl('negotiation_intelligence', 'Negotiation Intelligence Agent', 'acquisition', ['negotiation_strategy', 'price_gap', 'scripts'], ['negotiation_plan'], { risk_level: 'medium', tools: ['deal_graph.read', 'llm.reasoning'], knowledge_sources: ['seller conversation evidence', 'negotiation notes', 'wholesale analysis'] }),
  timeoutMs: 25000,
  async analyze(ctx) {
    const rep = ctx.understanding;
    const notes = H.worksheet(rep, 'negotiation_notes');
    const asking = H.input(ctx, 'asking_price', 'transaction.asking_price');
    const mao = ctx.priorOutputs?.wholesale?.data?.mao ?? H.val(rep, 'financial.mao_calculated');
    const evidence = {
      asking_price: asking, mao_calculated: mao ?? null,
      seller_timeline_days: H.c(rep, 'people.seller.timeline_days'), seller_objectives: H.c(rep, 'people.seller.objectives'),
      motivation_score: H.c(rep, 'people.seller.motivation_score'), objections: H.c(rep, 'people.seller.objections'),
      key_signals: H.c(rep, 'people.seller.key_signals'), loan_balance: H.c(rep, 'property.financing.loan_balance'),
      distress: { probate: H.val(rep, 'property.distress.probate'), foreclosure_stage: H.val(rep, 'property.distress.foreclosure_stage') },
    };
    const gap = asking.value != null && mao != null ? core.round2(asking.value - mao) : null;
    const known = Object.values(evidence).filter(v => v && typeof v === 'object' && 'status' in v ? v.status !== STATUS.UNKNOWN : v != null).length;
    const deterministic = {
      price_gap: gap,
      position: gap == null ? 'unknown - need both the seller\'s price and your MAO' : gap <= 0 ? 'seller price is at or below MAO: room to agree' : `seller wants ${H.money(gap)} more than MAO: price alone won't close it - explore terms, timeline or creative structure`,
    };
    let plan = null, modelNote = null;
    if (ctx.useModel !== false && known >= 2) {
      const res = await llm.json({
        agentId: 'negotiation_intelligence',
        rolePrompt: 'You prepare negotiation strategy for a real estate acquisition. Reason only from the evidence given. Never invent facts about the seller, never suggest pressure tactics, false urgency or exploiting distress, and never suggest disclosing the operator\'s maximum price.',
        facts: { evidence, deterministic },
        untrusted: { 'operator negotiation notes': notes ? JSON.stringify(notes) : null },
        task: 'Give the seller\'s likely priorities (each tied to a piece of evidence), 3 negotiation levers other than price, and 3 short, respectful talking points. Mark anything not directly evidenced as an inference.',
        schema: '{"seller_priorities":[{"priority":"","evidence":"","inferred":true}],"levers":[{"lever":"","why":""}],"talking_points":[""],"what_to_learn_next":[""]}',
        maxTokens: 800,
      });
      if (res.ok) plan = res.data; else modelNote = `Model unavailable: ${res.error}`;
    }
    const missing = H.missingFrom(rep, ['transaction.asking_price', 'people.seller.timeline_days', 'people.seller.objectives', 'property.financing.loan_balance']);
    return {
      status: known >= 2 ? 'complete' : 'insufficient_data',
      summary: `${deterministic.position}.${plan ? ` ${plan.levers?.length || 0} non-price levers identified.` : ''}`,
      findings: [H.finding('Price gap (asking − MAO)', claim(gap, gap == null ? STATUS.UNKNOWN : STATUS.CALCULATED, { basis: 'seller asking price − calculated MAO' })),
        ...(plan?.seller_priorities || []).slice(0, 5).map(p => H.finding(`seller priority: ${p.priority}`, claim(p.evidence || null, STATUS.INFERRED, { source: 'model reasoning from evidence' })))],
      recommendations: (plan?.talking_points || []).slice(0, 3).map(t => ({ action: `Talking point: ${t}`, why: 'Grounded in the seller evidence on file.', urgency: 'medium', impact: 'Moves the conversation without pressure', assigned_to: 'operator' })),
      missing,
      confidence: { score: Math.min(60, 15 + known * 8), reasoning: `${known} pieces of seller evidence on file.${modelNote ? ` ${modelNote}` : ''} Seller priorities are inferences, not statements the seller made.` },
      data: { deterministic, plan, notes_on_file: !!notes },
    };
  },
});

const buyerIntelligence = defineAgent({
  declaration: decl('buyer_intelligence', 'Buyer Intelligence Agent', 'disposition', ['buyer_profiles', 'buyer_responsiveness', 'buyer_history'], ['buyer_profiles']),
  async analyze(ctx) {
    const { data: buyers, error } = await db(ctx).from('buyers').select('id, name, buyer_type, buy_box_states, property_cities, buy_box_zips, buy_box_types, min_price, max_price, cash_only, proof_of_funds, is_active, is_tire_kicker, last_contact_at').eq('user_id', ctx.userId).eq('is_active', true).limit(1000);
    if (error) throw error;
    if (!buyers?.length) return { status: 'insufficient_data', summary: 'No active buyers on your list.', missing: [{ item: 'buyers', why_it_matters: 'Disposition depends on buyers who fit the deal.', how_to_get: 'Import or add cash buyers with their buy box.' }], confidence: { score: 0, reasoning: 'No buyers.' } };
    const ids = buyers.map(b => b.id);
    const [{ data: history }, { data: offers }] = await Promise.all([
      db(ctx).from('buyer_deal_history').select('buyer_id, outcome').eq('user_id', ctx.userId).in('buyer_id', ids.slice(0, 1000)),
      db(ctx).from('buyer_deal_offers').select('buyer_id, status').eq('user_id', ctx.userId).in('buyer_id', ids.slice(0, 1000)),
    ]);
    const byBuyer = {};
    for (const h of history || []) (byBuyer[h.buyer_id] = byBuyer[h.buyer_id] || { deals: 0, closed: 0, offers: 0, interested: 0 }).deals++;
    for (const h of history || []) if (/closed|purchased|won/i.test(String(h.outcome || ''))) byBuyer[h.buyer_id].closed++;
    for (const o of offers || []) {
      const e = (byBuyer[o.buyer_id] = byBuyer[o.buyer_id] || { deals: 0, closed: 0, offers: 0, interested: 0 });
      e.offers++; if (['interested', 'assigned'].includes(o.status)) e.interested++;
    }
    const profiles = buyers.map(b => {
      const s = byBuyer[b.id] || { deals: 0, closed: 0, offers: 0, interested: 0 };
      return {
        buyer_id: b.id, name: b.name, type: b.buyer_type, markets: [...(b.buy_box_states || []), ...(b.property_cities || [])], zips: b.buy_box_zips || [],
        asset_types: b.buy_box_types || [], price_range: { min: b.min_price, max: b.max_price }, cash_only: !!b.cash_only, proof_of_funds: !!b.proof_of_funds,
        offers_received: s.offers, interested: s.interested, response_rate: wilson(s.interested, s.offers), deals: s.deals, closed: s.closed,
        tire_kicker: !!b.is_tire_kicker, last_contact_at: b.last_contact_at,
        profile_gaps: [!b.buy_box_states?.length && !b.property_cities?.length ? 'markets' : null, b.max_price == null ? 'max price' : null, !b.proof_of_funds ? 'proof of funds' : null].filter(Boolean),
      };
    }).sort((a, b) => b.closed - a.closed || b.interested - a.interested);
    const incomplete = profiles.filter(p => p.profile_gaps.length).length;
    return {
      summary: `${profiles.length} active buyers; ${profiles.filter(p => p.closed).length} have closed with you; ${incomplete} profiles missing markets, max price or proof of funds.`,
      findings: [H.finding('active buyers', claim(profiles.length, STATUS.VERIFIED, { source: 'your buyer list' }))],
      recommendations: incomplete ? [{ action: `Complete ${incomplete} buyer profile(s) (markets, max price, proof of funds)`, why: 'Incomplete profiles match every deal and waste buyers\' attention.', urgency: 'low', impact: 'Better matches', assigned_to: 'operator' }] : [],
      confidence: { score: 80, reasoning: 'Profiles and responsiveness come directly from your buyer records and offer replies.' },
      data: { profiles: profiles.slice(0, 200), incomplete_profiles: incomplete },
    };
  },
});

const portfolio = defineAgent({
  declaration: decl('portfolio', 'Portfolio Agent', 'portfolio', ['pipeline_overview', 'attention_list', 'loan_maturities', 'capital_trapped'], ['portfolio_overview']),
  async analyze(ctx) {
    const [{ data: deals, error }, { data: loans }, { data: outs }] = await Promise.all([
      db(ctx).from('deals').select('id, property_address, status, closing_date, assignment_fee, seller_agreed_price, understanding_updated_at, updated_at').eq('user_id', ctx.userId).limit(2000),
      db(ctx).from('loans').select('property_id, lender, balance, rate_pct, maturity_date').eq('user_id', ctx.userId).limit(2000),
      db(ctx).from('agent_outputs').select('deal_id, agent_id, data, created_at').eq('user_id', ctx.userId).eq('agent_id', 'risk').order('created_at', { ascending: false }).limit(500),
    ]);
    if (error) throw error;
    const now = Date.now();
    const open = (deals || []).filter(d => !['closed', 'lost'].includes(d.status));
    const byStage = (deals || []).reduce((m, d) => { m[d.status] = (m[d.status] || 0) + 1; return m; }, {});
    const latestRisk = {};
    for (const o of outs || []) if (!latestRisk[o.deal_id]) latestRisk[o.deal_id] = o.data;
    const attention = [];
    for (const d of open) {
      const reasons = [];
      if (d.closing_date && new Date(d.closing_date).getTime() < now) reasons.push('closing date passed');
      else if (d.closing_date && new Date(d.closing_date).getTime() - now < 7 * 86400000) reasons.push('closes within 7 days');
      const counts = latestRisk[d.id]?.data?.counts || {};
      if (counts.critical) reasons.push(`${counts.critical} critical risk(s)`);
      if (now - new Date(d.updated_at).getTime() > 14 * 86400000) reasons.push('no activity for 14+ days');
      if (reasons.length) attention.push({ deal_id: d.id, address: d.property_address, stage: d.status, reasons });
    }
    const maturities = (loans || []).filter(l => l.maturity_date && new Date(l.maturity_date).getTime() - now < 365 * 86400000).sort((a, b) => String(a.maturity_date).localeCompare(String(b.maturity_date)));
    const underContractCapital = open.filter(d => ['under_contract', 'sent_to_title', 'closing_prep'].includes(d.status)).reduce((s, d) => s + (Number(d.seller_agreed_price) || 0), 0);
    return {
      status: (deals || []).length ? 'complete' : 'insufficient_data',
      summary: `${open.length} open deal(s); ${attention.length} need attention; ${maturities.length} recorded loan(s) mature within 12 months.`,
      findings: [H.finding('open deals', claim(open.length, STATUS.VERIFIED, { source: 'deals' })), H.finding('contract value under contract', claim(core.round2(underContractCapital), STATUS.CALCULATED, { source: 'deals', basis: 'sum of contract prices in under-contract stages' }))],
      recommendations: attention.slice(0, 3).map(a => ({ action: `Review ${a.address || a.deal_id}`, why: a.reasons.join('; '), urgency: a.reasons.some(r => /passed|critical/.test(r)) ? 'high' : 'medium', impact: 'Prevents a stalled or failed deal', assigned_to: 'operator' })),
      missing: (loans || []).length ? [] : [{ item: 'loans', why_it_matters: 'Refinancing risk and trapped capital need the debt on each owned property.', how_to_get: 'Record loans (balance, rate, maturity) on owned properties.' }],
      confidence: { score: 75, reasoning: 'Counts and dates come directly from your deals; owned-property debt is only as complete as the loans recorded.' },
      data: { by_stage: byStage, attention, maturities, open_count: open.length },
    };
  },
});

module.exports = { leadScoring, leadGeneration, negotiation, buyerIntelligence, portfolio, wilson };
