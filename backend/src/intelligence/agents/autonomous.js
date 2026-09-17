// ─── Autonomous systems: DealDeathPreventionAgent, DealRescueAgent,
//     MarketIntelligenceAgent, OpportunityDiscoveryAgent ─────────────────────────

const { defineAgent } = require('../agentKit');
const { claim, STATUS } = require('../provenance');
const connectors = require('../connectors');
const core = require('../calc/core');
const supabaseDefault = require('../../config/supabase');
const H = require('./_shared');

const decl = (id, name, domain, capabilities, outputs, extra = {}) => ({
  id, name, domain, version: '1.0.0', capabilities, required_inputs: ['deal_understanding'], outputs,
  tools: ['deal_graph.read'], knowledge_sources: ['deal understanding', 'agent outputs'], permissions: 'RECOMMEND', risk_level: 'medium',
  handoff_agents: [], jurisdiction_aware: false, last_knowledge_update: H.KNOWLEDGE_DATE, ...extra,
});
const db = (ctx) => ctx.tools?.supabase || supabaseDefault;
const DAY = 86400000;
const POST_CONTRACT = ['under_contract', 'sent_to_title', 'closing_prep'];

// Deterministic post-contract checks. Each alert has a stable key so the monitor
// can open it once and resolve it when the condition clears.
function deathPreventionAlerts(rep, now = Date.now()) {
  const alerts = [];
  const add = (key, severity, message, action) => alerts.push({ key, severity, message, recommended_action: action });
  const stage = H.val(rep, 'transaction.stage');
  if (!POST_CONTRACT.includes(stage)) return { applicable: false, alerts };
  const closing = H.val(rep, 'transaction.closing_date');
  const contracts = H.val(rep, 'transaction.contracts') || [];
  const title = H.val(rep, 'transaction.title');
  const titleOpen = Array.isArray(title) && title.length > 0;
  const emd = H.val(rep, 'transaction.emd.status');
  const buyer = H.val(rep, 'people.buyer.id');
  const structure = String(H.val(rep, 'transaction.structure') || '');
  const signed = contracts.find(c => c.signed_at);
  const signedDays = signed ? Math.floor((now - new Date(signed.signed_at).getTime()) / DAY) : null;
  const days = closing ? Math.ceil((new Date(closing).getTime() - now) / DAY) : null;

  if (!closing) add('no_closing_date', 'high', 'Under contract with no closing date recorded.', 'Enter the closing date from the purchase agreement.');
  if (days != null && days < 0) add('closing_passed', 'critical', `Closing date passed ${Math.abs(days)} day(s) ago and the deal is not closed.`, 'Get a written extension signed or close now.');
  if (!contracts.some(c => c.status === 'fully_signed' || c.signed_at)) add('no_signed_contract', 'high', 'Deal is marked under contract but no fully signed purchase agreement is on file.', 'Upload or send the purchase agreement for signature.');
  if (!titleOpen && (signedDays == null || signedDays >= 3)) add('title_not_opened', days != null && days <= 14 ? 'critical' : 'high', `Title has not been opened${signedDays != null ? ` ${signedDays} days after signing` : ''}.`, 'Send the contract to the title company and open the file.');
  if (days != null && days >= 0 && days <= 7) {
    if (!buyer && /wholesale|assign/i.test(structure || 'wholesale')) add('no_buyer_near_close', 'critical', `Closing in ${days} day(s) and no end buyer is assigned.`, 'Send the deal to matched buyers now, or line up transactional funding.');
    if (emd !== 'received') add('emd_not_received_near_close', 'medium', `Closing in ${days} day(s) and earnest money is not recorded as received.`, 'Confirm EMD receipt with the title company.');
  }
  if (signedDays != null && signedDays >= 5 && emd !== 'received') add('emd_late', 'medium', `Earnest money not recorded as received ${signedDays} days after signing.`, 'Confirm the deposit; many contracts require it within a few business days.');
  const dd = H.worksheet(rep, 'due_diligence') || {};
  for (const [item, status] of Object.entries(dd)) if (status === 'issue') add(`diligence_issue_${item}`.slice(0, 80), 'high', `Due diligence issue flagged: ${item.replace(/_/g, ' ')}.`, 'Resolve or renegotiate before the diligence period ends.');
  return { applicable: true, alerts, days_to_close: days };
}

const dealDeathPrevention = defineAgent({
  declaration: decl('deal_death_prevention', 'Deal Death Prevention Agent', 'transaction', ['post_contract_monitoring', 'early_warning_alerts'], ['deal_alerts'], { permissions: 'RECOMMEND', risk_level: 'high' }),
  async analyze(ctx) {
    const res = deathPreventionAlerts(ctx.understanding, ctx.now || Date.now());
    if (!res.applicable) return { status: 'not_applicable', summary: 'Monitoring starts once the deal is under contract.', confidence: { score: 90, reasoning: 'Stage is before contract.' }, data: { alerts: [] } };
    const sevMap = { critical: 'critical', high: 'high', medium: 'medium', low: 'low' };
    return {
      summary: res.alerts.length ? `${res.alerts.length} warning(s) on this contract; most urgent: ${[...res.alerts].sort((a, b) => ['critical', 'high', 'medium', 'low'].indexOf(a.severity) - ['critical', 'high', 'medium', 'low'].indexOf(b.severity))[0].message}` : 'No warning signs on this contract right now.',
      risks: res.alerts.map(a => ({ risk: a.message, severity: sevMap[a.severity], category: 'timeline', mitigation: a.recommended_action })),
      recommendations: res.alerts.slice(0, 3).map(a => ({ action: a.recommended_action, why: a.message, urgency: a.severity, impact: 'Keeps the deal from dying', assigned_to: 'operator' })),
      confidence: { score: 80, reasoning: 'Checks read the deal, contract, title, EMD and diligence records directly; anything tracked outside Veori is not visible.' },
      data: { alerts: res.alerts, days_to_close: res.days_to_close },
    };
  },
});

const dealRescue = defineAgent({
  declaration: decl('deal_rescue', 'Deal Rescue Agent', 'transaction', ['failure_diagnosis', 'rescue_options'], ['rescue_plan'], { risk_level: 'high' }),
  async analyze(ctx) {
    const rep = ctx.understanding;
    const o = ctx.priorOutputs || {};
    const closing = H.val(rep, 'transaction.closing_date');
    const deadline = (days) => closing ? String(closing).slice(0, 10) : new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
    const causes = [];
    const add = (cause, impact, options, next, days, responsible = 'operator') => causes.push({ cause, impact, options, recommended_next_action: next, deadline: deadline(days), responsible_party: responsible });
    const w = o.wholesale?.data;
    if (w?.verdict === 'above_mao') add('price', `The seller's price is above the maximum offer (${H.money(w.mao)}); a cash assignment has no spread.`, ['Renegotiate to MAO or below with the comparables', 'Offer creative terms (seller finance or subject-to) that meet the seller\'s number', 'Walk away and keep in long-term follow-up'], 'Present the comparables and a price at or below MAO', 7);
    if (o.buyer_matching?.data && o.buyer_matching.data.total_matches === 0) add('buyer', 'No buyer on your list fits this deal.', ['Market to new buyers (buyer lists, investor groups)', 'Double close with transactional funding and resell', 'Assign at a lower price to widen the buyer pool'], 'Add buyers who buy in this area and price range', 5);
    const titleRisks = (o.title_intelligence?.risks || []).filter(r => ['critical', 'high'].includes(r.severity));
    if (titleRisks.length) add('title', titleRisks[0].risk, ['Order title and cure defects before closing', 'Extend closing to clear the issue', 'Renegotiate price to cover payoffs'], titleRisks[0].mitigation || 'Order a title search', 7, 'title company');
    const alerts = deathPreventionAlerts(rep).alerts;
    const timelineAlert = alerts.find(a => ['closing_passed', 'no_buyer_near_close', 'title_not_opened'].includes(a.key));
    if (timelineAlert) add('timeline', timelineAlert.message, ['Get a written extension', 'Line up transactional funding to close on time', 'Escalate with the title company'], timelineAlert.recommended_action, 2);
    if (alerts.find(a => a.key === 'no_signed_contract')) add('contract', 'No signed purchase agreement on file.', ['Get the agreement signed', 'Verify signer authority'], 'Send the contract for signature', 2);
    const disagreement = (ctx.disagreements || []).find(d => d.material && /arv|as_is|max_price/.test(d.key));
    if (disagreement || (o.arv?.data?.status && ![STATUS.CALCULATED, STATUS.VERIFIED].includes(o.arv.data.status))) add('valuation', disagreement ? `Value figures disagree (${disagreement.key}, ${disagreement.spread_pct}% apart).` : 'ARV is not supported by sold comparables.', ['Pull sold comparables', 'Order a broker price opinion or appraisal', 'Re-underwrite with the supported value'], 'Get 3+ sold comparables', 5);
    const rehabRisk = (o.rehab_estimation?.risks || []).find(r => /differs from this scope/.test(r.risk));
    if (rehabRisk) add('rehab', rehabRisk.risk, ['Get a contractor bid', 'Renegotiate for repairs', 'Adjust MAO to the confirmed scope'], 'Get a contractor walkthrough', 7, 'contractor');
    if (o.financing && !(o.financing.data?.ranked_by_cost || []).length && ['fix_flip', 'buy_hold', 'brrrr'].some(id => o[id])) add('financing', 'Financing is not priced; the deal may not work at real rates.', ['Get 2-3 lender quotes', 'Model with the highest quote', 'Bring in an equity partner'], 'Request lender term sheets', 7, 'lender');
    const dom = Number(H.val(rep, 'property.market.median_days_on_market'));
    if (dom > 90) add('market', `Median days on market is ${dom}; resale will be slow.`, ['Price the exit below market', 'Budget extra holding months', 'Consider a rental exit'], 'Re-run scenarios with a longer hold', 14);
    const stale = ['contacted', 'offer_sent', 'negotiating'].includes(H.val(rep, 'transaction.stage')) && ctx.dealUpdatedAt && Date.now() - new Date(ctx.dealUpdatedAt).getTime() > 14 * DAY;
    if (stale) add('seller', 'No activity on this negotiation for 14+ days.', ['Follow up with a specific reason to talk (new comps, flexible close)', 'Ask what would make it work for them', 'Move to long-term nurture'], 'Follow up with the seller', 3);
    return {
      status: causes.length ? 'complete' : 'insufficient_data',
      summary: causes.length ? `${causes.length} reason(s) this deal is at risk: ${causes.map(c => c.cause).join(', ')}.` : 'No failure cause found in the analyses run. Run a complete analysis so all agents contribute.',
      findings: causes.map(c => H.finding(`cause: ${c.cause}`, claim(c.impact, STATUS.INFERRED, { basis: 'derived from agent outputs and deal records' }))),
      recommendations: causes.map((c, i) => ({ action: c.recommended_next_action, why: c.impact, urgency: i === 0 ? 'high' : 'medium', impact: `Addresses the ${c.cause} problem`, assigned_to: c.responsible_party })),
      confidence: { score: causes.length ? 65 : 30, reasoning: `Diagnosis uses ${Object.keys(o).length} agent analyses and the deal record.` },
      data: { causes },
    };
  },
});

const marketIntelligence = defineAgent({
  declaration: decl('market_intelligence', 'Market Intelligence Agent', 'market', ['zip_market_statistics', 'market_changes', 'deal_relevance'], ['market_update'], { tools: ['connectors.market_statistics', 'market_data.write'], knowledge_sources: ['licensed market data provider'] }),
  async analyze(ctx) {
    const zip = H.val(ctx.understanding, 'property.zip');
    const provider = connectors.providerFor('market_statistics');
    if (!zip || !/^\d{5}/.test(String(zip))) return { status: 'insufficient_data', summary: 'No zip code on this deal.', missing: [H.missingItem('property.zip')], confidence: { score: 0, reasoning: 'No zip.' } };
    if (!provider) return { status: 'insufficient_data', summary: 'No market data provider is connected.', missing: [{ item: 'market data provider', why_it_matters: 'Inventory, prices, rents and days on market come from a licensed feed.', how_to_get: 'Connect RentCast (RENTCAST_API_KEY with an active subscription) or another market data provider.' }], confidence: { score: 0, reasoning: 'No provider.' } };
    let stats;
    try { stats = await provider.marketStatistics(String(zip).slice(0, 5)); } catch (err) {
      return { status: 'insufficient_data', summary: `Market data unavailable: ${err.message}`, missing: [{ item: 'market data', why_it_matters: 'Needed to track what changed.', how_to_get: err.code === 'SUBSCRIPTION_INACTIVE' ? 'Reactivate the RentCast subscription.' : 'Retry later.' }], confidence: { score: 0, reasoning: err.message } };
    }
    if (!stats.found) return { status: 'insufficient_data', summary: `No market statistics for ${zip}.`, confidence: { score: 0, reasoning: 'Provider returned nothing.' } };
    const period = stats.retrieved_at.slice(0, 10);
    const { data: previous } = await db(ctx).from('market_data').select('metric, value, period').eq('user_id', ctx.userId).eq('geography', 'zip').eq('geo_key', stats.zip).lt('period', period).order('period', { ascending: false }).limit(50);
    const prevBy = {};
    for (const p of previous || []) if (!prevBy[p.metric]) prevBy[p.metric] = p;
    const changes = [];
    const rows = [];
    for (const [metric, c] of Object.entries(stats.metrics)) {
      if (c.value == null) continue;
      rows.push({ user_id: ctx.userId, geography: 'zip', geo_key: stats.zip, metric, value: c.value, period, source: 'RentCast', retrieved_at: stats.retrieved_at });
      const p = prevBy[metric];
      if (p && Number(p.value) !== 0) changes.push({ metric, previous: Number(p.value), current: c.value, change_pct: core.round2(((c.value - Number(p.value)) / Number(p.value)) * 100), since: p.period });
    }
    if (rows.length) await db(ctx).from('market_data').upsert(rows, { onConflict: 'user_id,geography,geo_key,metric,period,source' });
    const { count: openDeals } = await db(ctx).from('deals').select('id', { count: 'exact', head: true }).eq('user_id', ctx.userId).eq('property_zip', stats.zip).not('status', 'in', '(closed,lost)');
    const notable = changes.filter(c => Math.abs(c.change_pct) >= 5);
    return {
      summary: `${stats.zip}: median list price ${H.money(stats.metrics.median_list_price.value)}, ${stats.metrics.median_days_on_market.value ?? '—'} days on market, median rent ${H.money(stats.metrics.median_rent.value)}. ${changes.length ? `${notable.length} metric(s) moved 5%+ since ${changes[0].since}.` : 'First snapshot - changes will show on the next check.'} ${openDeals || 0} open deal(s) in this zip.`,
      findings: Object.entries(stats.metrics).map(([k, c]) => H.finding(k, c)),
      calculations: changes.length ? [{ name: 'market_change', inputs: { zip: stats.zip }, formula: 'change % = (current − previous) ÷ previous', output: { changes }, assumptions: ['Listing-based aggregates from the provider'] }] : [],
      confidence: { score: 55, reasoning: 'Provider aggregates of listings, not closed sales.' },
      data: { zip: stats.zip, changes, notable, open_deals_in_zip: openDeals || 0 },
    };
  },
});

const opportunityDiscovery = defineAgent({
  declaration: decl('opportunity_discovery', 'Opportunity Discovery Agent', 'market', ['high_equity_owners', 'distress_signals', 'opportunity_ranking'], ['opportunities'], { required_inputs: [], tools: ['leads.read'], knowledge_sources: ['workspace leads'] }),
  async analyze(ctx) {
    const { data: leads, error } = await db(ctx).from('leads')
      .select('id, first_name, last_name, property_address, property_city, property_state, property_zip, estimated_value, mortgage_balance, probate_case, foreclosure_stage, has_lis_pendens, years_delinquent, tax_owed, is_absentee_owner, is_vacant, years_owned, is_on_dnc, status')
      .eq('user_id', ctx.userId).limit(5000);
    if (error) throw error;
    const { data: withDeals } = await db(ctx).from('deals').select('lead_id').eq('user_id', ctx.userId).not('lead_id', 'is', null).limit(5000);
    const taken = new Set((withDeals || []).map(d => d.lead_id));
    const opps = [];
    for (const l of leads || []) {
      if (taken.has(l.id) || l.is_on_dnc === true || ['dnc', 'closed', 'dead'].includes(l.status)) continue;
      const evidence = [];
      const v = Number(l.estimated_value), m = l.mortgage_balance == null ? null : Number(l.mortgage_balance);
      if (v > 0 && m != null && (v - m) / v >= 0.5) evidence.push({ signal: 'high_equity', detail: `estimated equity ${Math.round(((v - m) / v) * 100)}% (value ${H.money(v)}, loan ${H.money(m)})` });
      if (l.probate_case) evidence.push({ signal: 'probate', detail: 'probate case on record' });
      if (l.foreclosure_stage || l.has_lis_pendens) evidence.push({ signal: 'pre_foreclosure', detail: l.foreclosure_stage ? `foreclosure stage: ${l.foreclosure_stage}` : 'lis pendens recorded' });
      if (Number(l.years_delinquent) >= 2 || Number(l.tax_owed) > 0) evidence.push({ signal: 'tax_delinquent', detail: `${l.years_delinquent ?? '?'} year(s) delinquent, ${H.money(l.tax_owed)} owed` });
      if (l.is_absentee_owner && l.is_vacant) evidence.push({ signal: 'vacant_absentee', detail: 'absentee owner and vacant' });
      if (Number(l.years_owned) >= 20) evidence.push({ signal: 'long_ownership', detail: `${l.years_owned} years owned` });
      if (evidence.length >= 2) opps.push({ lead_id: l.id, address: [l.property_address, l.property_city, l.property_state].filter(Boolean).join(', '), owner: [l.first_name, l.last_name].filter(Boolean).join(' ') || null, signal_count: evidence.length, evidence, evidence_status: STATUS.UNVERIFIED });
    }
    opps.sort((a, b) => b.signal_count - a.signal_count);
    return {
      status: 'complete',
      summary: `${opps.length} lead(s) without a deal show 2+ independent opportunity signals${opps.length ? `; top has ${opps[0].signal_count}` : ''}. Expired listings, price cuts and long days-on-market need an MLS feed, which is not connected.`,
      findings: [H.finding('opportunities', claim(opps.length, STATUS.CALCULATED, { source: 'your leads', basis: 'leads with 2+ signals and no deal' }))],
      recommendations: opps.slice(0, 3).map(op => ({ action: `Open a deal for ${op.address || op.lead_id}`, why: op.evidence.map(e => e.detail).join('; '), urgency: op.signal_count >= 3 ? 'high' : 'medium', impact: 'Moves a strong lead into active pursuit', assigned_to: 'operator' })),
      missing: [{ item: 'MLS / listing feed', why_it_matters: 'Underpriced listings, expired listings and price reductions come from listing data.', how_to_get: 'Connect an MLS/IDX data agreement or listing provider.' }],
      confidence: { score: 50, reasoning: 'Signals come from lead records whose origin is not verified; each opportunity lists its evidence.' },
      data: { opportunities: opps.slice(0, 100), scanned: (leads || []).length },
    };
  },
});

module.exports = { dealDeathPrevention, dealRescue, marketIntelligence, opportunityDiscovery, deathPreventionAlerts, POST_CONTRACT };
