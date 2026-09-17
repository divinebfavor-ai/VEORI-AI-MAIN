// ─── Diligence and construction: ComparableSalesAgent, UnderwritingAgent,
//     DueDiligenceAgent, RealEstateLawIntelligenceAgent, RehabEstimationAgent,
//     ConstructionManagementAgent ────────────────────────────────────────────────
// Comparables are never fabricated; legal outputs come only from verified knowledge
// items with source, jurisdiction, effective date and review date; costs come only
// from the operator's scope or budget worksheets.

const { defineAgent } = require('../agentKit');
const { claim, STATUS } = require('../provenance');
const core = require('../calc/core');
const supabaseDefault = require('../../config/supabase');
const H = require('./_shared');

const decl = (id, name, domain, capabilities, outputs, extra = {}) => ({
  id, name, domain, version: '1.0.0', capabilities, required_inputs: ['deal_understanding'], outputs,
  tools: ['deal_graph.read'], knowledge_sources: ['deal understanding', 'operator worksheets'], permissions: 'RECOMMEND', risk_level: 'medium',
  handoff_agents: [], jurisdiction_aware: false, last_knowledge_update: H.KNOWLEDGE_DATE, ...extra,
});
const db = (ctx) => ctx.tools?.supabase || supabaseDefault;
const miss = (item, why, how) => ({ item, why_it_matters: why, how_to_get: how });
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const comparableSales = defineAgent({
  declaration: decl('comparable_sales', 'Comparable Sales Agent', 'valuation', ['comparable_relevance', 'size_adjustment', 'comp_quality'], ['comparable_analysis'], { handoff_agents: ['arv'] }),
  async analyze(ctx) {
    const rep = ctx.understanding;
    const comps = Array.isArray(rep.comparables) ? rep.comparables : [];
    const sqft = H.pos(H.val(rep, 'property.sqft'));
    if (!comps.length) return { status: 'insufficient_data', summary: 'No comparables on file. I will not invent any.', missing: [miss('comparables', 'Value and ARV need nearby sales of similar homes.', 'MLS sold search, title company, or a connected data provider.')], confidence: { score: 0, reasoning: 'No comparables.' } };
    const withPpsf = comps.filter(c => H.pos(c.price) && H.pos(c.sqft));
    const medPpsf = withPpsf.length ? median(withPpsf.map(c => c.price / c.sqft)) : null;
    const now = Date.now();
    const analysed = comps.map(c => {
      const ageDays = c.date ? Math.round((now - new Date(c.date).getTime()) / 86400000) : null;
      const sizeDiff = sqft && H.pos(c.sqft) ? c.sqft - sqft : null;
      const adjustment = sizeDiff != null && medPpsf != null ? core.round2(-sizeDiff * medPpsf) : null;
      const quality = [];
      if (c.price_type !== 'sold') quality.push(c.price_type === 'listed' ? 'listing price, not a sale' : 'price type unknown');
      if (ageDays != null && ageDays > 180) quality.push(`${ageDays} days old`);
      if (ageDays == null) quality.push('date unknown');
      if (c.distance_miles != null && c.distance_miles > 1) quality.push(`${c.distance_miles} mi away`);
      if (c.distance_miles == null) quality.push('distance unknown');
      if (sizeDiff != null && sqft && Math.abs(sizeDiff) / sqft > 0.2) quality.push(`size differs ${Math.round((sizeDiff / sqft) * 100)}%`);
      return {
        address: c.address, price: c.price, price_type: c.price_type, date: c.date, sqft: c.sqft, distance_miles: c.distance_miles, source: c.source,
        relevance: [c.distance_miles != null ? `${c.distance_miles} mi` : null, ageDays != null ? `${ageDays} days` : null, c.correlation != null ? `provider similarity ${Math.round(c.correlation * 100)}%` : null].filter(Boolean).join(', ') || 'not measurable',
        size_adjustment: adjustment, adjusted_price: adjustment != null ? core.round2(Number(c.price) + adjustment) : null,
        quality: quality.length ? quality : ['meets sold / recent / close / similar size'],
        usable: c.price_type === 'sold' && quality.length === 0,
      };
    });
    const usable = analysed.filter(a => a.usable);
    return {
      status: 'complete',
      summary: `${comps.length} comparable(s) on file; ${usable.length} meet sold, within 180 days, within 1 mile and within 20% of size.${sqft ? '' : ' Subject square footage unknown, so no size adjustments.'}`,
      findings: [H.finding('usable sold comparables', claim(usable.length, STATUS.CALCULATED, { source: 'comparables on file' }))],
      calculations: [{ name: 'comparable_size_adjustment', inputs: { subject_sqft: sqft, median_price_per_sqft: medPpsf == null ? null : core.round2(medPpsf) }, formula: 'adjustment = −(comp sqft − subject sqft) × median $/sqft of comparables', output: { comparables: analysed }, assumptions: ['Only size is adjusted; condition, bedrooms, bathrooms, lot and features are not', 'Median $/sqft includes listings when present - see each comparable\'s price type'] }],
      missing: usable.length < 3 ? [miss('sold comparables', 'At least 3 recent, nearby, similar sold comparables support a value.', 'MLS sold search or appraiser.')] : [],
      confidence: { score: Math.min(80, usable.length * 20), reasoning: `${usable.length} comparables meet all quality tests.` },
      handoffs: ['arv'],
      data: { comparables: analysed, usable_count: usable.length },
    };
  },
});

const underwriting = defineAgent({
  declaration: decl('underwriting', 'Underwriting Agent', 'underwriting', ['sources_and_uses', 'returns_summary', 'sensitivity', 'exit_scenarios'], ['underwriting_package'], { tools: ['deal_graph.read', 'engines.scenarios'], knowledge_sources: ['strategy agent outputs', 'deal understanding'], risk_level: 'high' }),
  async analyze(ctx) {
    const rep = ctx.understanding;
    const o = ctx.priorOutputs || {};
    const price = [H.input(ctx, 'purchase_price'), H.c(rep, 'transaction.contract_price'), H.c(rep, 'transaction.asking_price')].find(c => c.status !== STATUS.UNKNOWN) || claim(null, STATUS.UNKNOWN);
    const repairs = H.input(ctx, 'repairs', 'financial.repairs');
    const closingPct = H.pos(ctx.inputs?.buy_closing_pct);
    const loan = H.pos(ctx.inputs?.loan_amount);
    const uses = [];
    if (price.value != null) uses.push({ use: 'Purchase price', amount: price.value, status: price.status });
    if (repairs.value != null) uses.push({ use: 'Rehab', amount: repairs.value, status: repairs.status });
    if (price.value != null && closingPct != null) uses.push({ use: 'Purchase closing costs', amount: core.round2(price.value * closingPct / 100), status: STATUS.USER_PROVIDED });
    const totalUses = core.round2(uses.reduce((s, u) => s + u.amount, 0));
    const sources = [];
    if (loan != null) sources.push({ source: 'Loan', amount: loan });
    if (uses.length) sources.push({ source: 'Operator equity', amount: core.round2(Math.max(0, totalUses - (loan || 0))) });
    const strategies = ['wholesale', 'fix_flip', 'buy_hold', 'brrrr', 'subject_to', 'seller_finance'].filter(id => o[id] && o[id].status === 'complete').map(id => ({ strategy: id, summary: o[id].summary, confidence: o[id].confidence.score, key: o[id].data?.mao ?? o[id].data?.profit ?? o[id].data?.monthly_cash_flow ?? null }));
    const sensitivity = o.fix_flip?.data?.scenarios || null;
    const risks = o.risk?.data?.register || [];
    const missing = [];
    if (price.value == null) missing.push(H.missingItem('transaction.contract_price'));
    if (repairs.value == null) missing.push(H.missingItem('financial.repairs'));
    if (closingPct == null) missing.push(miss('buy_closing_pct', 'Closing costs are part of total project cost.', 'Title company estimate.'));
    if (!strategies.length) missing.push(miss('strategy analysis', 'Returns come from a strategy model (flip, rental, wholesale...).', 'Ask Veori for a complete analysis with the inputs each strategy needs.'));
    return {
      status: uses.length && strategies.length ? 'complete' : 'insufficient_data',
      summary: `${uses.length ? `Total uses ${H.money(totalUses)}` : 'Uses unknown'}; ${strategies.length} strategy model(s) complete; ${risks.length} risk(s) in the register.`,
      findings: uses.map(u => H.finding(`use: ${u.use}`, claim(u.amount, u.status))),
      calculations: [{ name: 'sources_and_uses', inputs: { uses, loan }, formula: 'total uses = Σ uses; equity = total uses − loan', output: { uses, sources, total_uses: totalUses }, assumptions: loan == null ? ['No loan supplied: all cash'] : [] }],
      risks: risks.slice(0, 10), missing,
      confidence: { score: strategies.length ? Math.round(strategies.reduce((s, x) => s + x.confidence, 0) / strategies.length) : 0, reasoning: strategies.length ? 'Average confidence of the strategy models used.' : 'No strategy model completed.' },
      data: { sources, uses, total_uses: totalUses, strategies, sensitivity, exits: o.disposition?.data?.exits || null },
    };
  },
});

// Standard diligence items by asset type. These are common practice items, not legal
// requirements; the one federal rule cited is sourced.
function checklistFor({ propertyType, yearBuilt, structure, isRental, isLand }) {
  const items = [
    { key: 'title_commitment', item: 'Preliminary title report / commitment reviewed', category: 'title' },
    { key: 'payoffs', item: 'Payoff letters for all loans and liens', category: 'title' },
    { key: 'inspection', item: 'Property inspection or contractor walkthrough', category: 'physical' },
    { key: 'repair_bids', item: 'Itemised repair bids', category: 'physical' },
    { key: 'comparables', item: '3+ sold comparables supporting value/ARV', category: 'valuation' },
    { key: 'flood_zone', item: 'FEMA flood zone checked', category: 'physical' },
    { key: 'tax_status', item: 'Property tax status and amount confirmed with the county', category: 'financial' },
    { key: 'insurance_quote', item: 'Insurance quote obtained', category: 'financial' },
    { key: 'permits', item: 'Open permits / code violations checked with the city', category: 'legal' },
  ];
  if (yearBuilt != null && yearBuilt < 1978) items.push({ key: 'lead_paint', item: 'Lead-based paint disclosure (housing built before 1978)', category: 'legal', source: 'Residential Lead-Based Paint Hazard Reduction Act of 1992 (42 U.S.C. 4852d); 24 CFR Part 35 / 40 CFR Part 745' });
  if (isRental) items.push({ key: 'leases', item: 'Leases, rent roll and tenant estoppels', category: 'financial' }, { key: 'security_deposits', item: 'Security deposit ledger', category: 'financial' });
  if (/condo|townhouse|hoa/i.test(propertyType || '')) items.push({ key: 'hoa_docs', item: 'HOA documents, dues, special assessments', category: 'legal' });
  if (isLand) items.push({ key: 'survey', item: 'Boundary survey', category: 'physical' }, { key: 'zoning_letter', item: 'Zoning verification letter', category: 'legal' }, { key: 'utilities', item: 'Utility availability letters / perc test', category: 'physical' }, { key: 'environmental', item: 'Phase I environmental (if commercial or suspect)', category: 'environmental' });
  if (/commercial|office|retail|industrial|storage|multi/i.test(propertyType || '')) items.push({ key: 'operating_statements', item: 'Trailing-12 operating statements verified to bank records', category: 'financial' }, { key: 'environmental', item: 'Phase I environmental report', category: 'environmental' });
  if (['subject_to', 'seller_finance', 'lease_option', 'novation', 'wholesale'].includes(structure)) items.push({ key: 'attorney_review', item: 'Attorney review of structure and documents for this state', category: 'legal' });
  if (structure === 'subject_to') items.push({ key: 'loan_documents', item: 'Existing note and deed of trust reviewed (due-on-sale)', category: 'legal' });
  const seen = new Set();
  return items.filter(i => (seen.has(i.key) ? false : (seen.add(i.key), true)));
}

const dueDiligence = defineAgent({
  declaration: decl('due_diligence', 'Due Diligence Agent', 'transaction', ['diligence_checklist', 'diligence_tracking'], ['diligence_checklist'], { jurisdiction_aware: true }),
  async analyze(ctx) {
    const rep = ctx.understanding;
    const propertyType = H.val(rep, 'property.property_type');
    const structure = H.val(rep, 'transaction.structure');
    const ws = H.worksheet(rep, 'due_diligence') || {};
    const list = checklistFor({ propertyType, yearBuilt: H.pos(H.val(rep, 'property.year_built')), structure, isRental: !!H.val(rep, 'financial.market_rent'), isLand: /land|lot|acre/i.test(propertyType || '') || !!H.worksheet(rep, 'land') });
    const items = list.map(i => ({ ...i, status: ['done', 'in_progress', 'not_applicable', 'issue'].includes(ws[i.key]) ? ws[i.key] : 'open' }));
    const open = items.filter(i => i.status === 'open'), issues = items.filter(i => i.status === 'issue');
    if (H.val(rep, 'property.year_built') == null) items.push({ key: 'year_built_check', item: 'Confirm year built (decides whether lead-paint disclosure applies)', category: 'legal', status: 'open' });
    return {
      summary: `${items.length - open.length}/${items.length} diligence items addressed; ${issues.length} flagged as issues.`,
      findings: items.map(i => H.finding(i.item, claim(i.status, ws[i.key] ? STATUS.USER_PROVIDED : STATUS.UNKNOWN, { source: i.source || 'diligence checklist' }))),
      risks: issues.map(i => ({ risk: `Diligence issue: ${i.item}`, severity: 'high', category: i.category, mitigation: 'Resolve before the diligence period ends.' })),
      recommendations: open.slice(0, 3).map(i => ({ action: i.item, why: `Open ${i.category} diligence item.`, urgency: 'medium', impact: 'Finds problems before money goes hard', assigned_to: 'operator' })),
      confidence: { score: 70, reasoning: 'Checklist reflects common practice for this asset type and structure; state-specific requirements need local counsel.' },
      data: { items, open: open.length, issues: issues.length },
    };
  },
});

const realEstateLaw = defineAgent({
  declaration: decl('real_estate_law', 'Real Estate Law Intelligence Agent', 'legal', ['verified_rules_lookup', 'attorney_review_flags'], ['legal_intelligence'], { jurisdiction_aware: true, risk_level: 'high', permissions: 'READ', tools: ['knowledge_items.read'], knowledge_sources: ['verified knowledge items (source, jurisdiction, effective date, review date)'] }),
  async analyze(ctx) {
    const state = H.val(ctx.understanding, 'property.state');
    const jurisdictions = ['US', ...(state ? [String(state).toUpperCase()] : [])];
    const { data, error } = await db(ctx).from('knowledge_items').select('id, topic, jurisdiction, content, source, source_url, effective_date, last_verified_at, review_by, confidence, user_id')
      .in('jurisdiction', jurisdictions).or(`user_id.is.null,user_id.eq.${ctx.userId}`).limit(200);
    if (error) throw error;
    const today = new Date().toISOString().slice(0, 10);
    const items = (data || []).map(k => ({
      topic: k.topic, jurisdiction: k.jurisdiction, summary: typeof k.content === 'object' ? (k.content.summary || JSON.stringify(k.content)) : String(k.content),
      source: k.source, source_url: k.source_url, effective_date: k.effective_date, last_verified_at: k.last_verified_at, review_by: k.review_by,
      confidence: k.confidence, scope: k.user_id ? 'your workspace' : 'platform',
      stale: !k.review_by || k.review_by < today, stale_reason: !k.review_by ? 'No review date: freshness cannot be established' : k.review_by < today ? `Past its review date (${k.review_by})` : null,
    }));
    const fresh = items.filter(i => !i.stale);
    return {
      status: items.length ? 'complete' : 'insufficient_data',
      summary: items.length ? `${items.length} verified knowledge item(s) for ${jurisdictions.join(' + ')}; ${items.length - fresh.length} past review or undated. This is not legal advice.` : `I cannot confirm the legal requirements for ${state || 'this property\'s state'}: no verified knowledge items are on file. Attorney review is recommended.`,
      findings: items.map(i => H.finding(`${i.jurisdiction} · ${i.topic}`, claim(i.summary, i.stale ? STATUS.UNVERIFIED : STATUS.VERIFIED, { source: i.source, jurisdiction: i.jurisdiction, as_of: i.last_verified_at, confidence: i.confidence, note: i.stale_reason }))),
      missing: [!state ? H.missingItem('property.state') : null, fresh.length ? null : miss('verified legal knowledge', 'Wholesaling, assignment, disclosure, licensing and tenant rules vary by state and change.', 'Add items from statutes or regulator guidance (with source, effective and review dates), or consult a local real estate attorney.')].filter(Boolean),
      confidence: { score: fresh.length ? Math.min(80, Math.round(fresh.reduce((s, i) => s + (i.confidence || 0), 0) / fresh.length)) : 0, reasoning: fresh.length ? 'Average confidence of in-date verified items.' : 'No in-date verified knowledge.' },
      attorney_review: true,
      data: { jurisdictions, items, verified_items: fresh.length, legal_advice: false },
    };
  },
});

const rehabEstimation = defineAgent({
  declaration: decl('rehab_estimation', 'Rehab Estimation Agent', 'construction', ['line_item_estimate', 'estimate_range', 'cost_drivers'], ['rehab_estimate']),
  async analyze(ctx) {
    const rep = ctx.understanding;
    const ws = H.worksheet(rep, 'rehab_scope');
    const lines = Array.isArray(ws) ? ws : Array.isArray(ws?.items) ? ws.items : [];
    const contingencyPct = H.pos(ws?.contingency_pct);
    if (!lines.length) return { status: 'insufficient_data', summary: 'I cannot estimate rehab without a scope: no local cost data is connected, so I will not guess per-square-foot costs.', missing: [miss('rehab_scope', 'A defensible estimate is line items × quantities × local unit costs.', 'Walk the property with a contractor and enter items with quantity and unit cost (optional low/high) in the rehab scope worksheet.')], confidence: { score: 0, reasoning: 'No scope.' } };
    const rows = [], problems = [];
    for (const [i, l] of lines.entries()) {
      const qty = H.pos(l.quantity) ?? 1, unit = H.pos(l.unit_cost), low = H.pos(l.unit_cost_low), high = H.pos(l.unit_cost_high);
      if (unit == null && (low == null || high == null)) { problems.push(`Line ${i + 1} (${l.item || 'unnamed'}) has no unit cost`); continue; }
      const mid = unit ?? (low + high) / 2;
      rows.push({ item: l.item || `Line ${i + 1}`, quantity: qty, unit_cost: mid, total: core.round2(qty * mid), low: low != null ? core.round2(qty * low) : null, high: high != null ? core.round2(qty * high) : null, source: l.source || null });
    }
    const subtotal = rows.reduce((s, r) => s + r.total, 0);
    const hasRange = rows.every(r => r.low != null && r.high != null);
    const contingency = contingencyPct != null ? subtotal * contingencyPct / 100 : 0;
    const total = core.round2(subtotal + contingency);
    const drivers = [...rows].sort((a, b) => b.total - a.total).slice(0, 3);
    // Contingency is the same percentage of each bound.
    const cFactor = 1 + (contingencyPct ?? 0) / 100;
    const rangeLow = hasRange ? core.round2(rows.reduce((s, r) => s + r.low, 0) * cFactor) : null;
    const rangeHigh = hasRange ? core.round2(rows.reduce((s, r) => s + r.high, 0) * cFactor) : null;
    const record = H.c(rep, 'financial.repairs');
    const risks = problems.map(p => ({ risk: p, severity: 'medium', category: 'construction', mitigation: 'Add the unit cost or remove the line.' }));
    if (contingencyPct == null) risks.push({ risk: 'No contingency included.', severity: 'medium', category: 'construction', mitigation: 'Add a contingency % to the worksheet.' });
    if (record.value != null && Math.abs(record.value - total) / Math.max(total, 1) > 0.15) risks.push({ risk: `Repair figure on the deal (${H.money(record.value)}) differs from this scope (${H.money(total)}) by more than 15%.`, severity: 'medium', category: 'construction', mitigation: 'Update the deal\'s repair estimate once the scope is confirmed.' });
    return {
      summary: `Rehab ${H.money(total)} from ${rows.length} line item(s)${hasRange ? ` (range ${H.money(rangeLow)}-${H.money(rangeHigh)})` : ''}. Biggest drivers: ${drivers.map(d => d.item).join(', ')}.`,
      findings: [H.finding('Rehab estimate', claim(total, STATUS.CALCULATED, { source: 'rehab scope you provided' }))],
      calculations: [{ name: 'rehab_line_items', inputs: { lines: lines.length, contingency_pct: contingencyPct }, formula: 'total = Σ quantity × unit cost + contingency % of subtotal; range from low/high unit costs when all lines have them', output: { rows, subtotal: core.round2(subtotal), contingency: core.round2(contingency), total, range_low: rangeLow, range_high: rangeHigh }, assumptions: ['Unit costs as entered by you; no local cost database connected'] }],
      risks,
      confidence: { score: hasRange ? 60 : 45, reasoning: `Operator line items${hasRange ? ' with ranges' : ' without low/high ranges'}; not a contractor bid.` },
      data: { total, subtotal: core.round2(subtotal), contingency: core.round2(contingency), what_would_change_it: drivers.map(d => `${d.item}: ${H.money(d.total)}`) },
    };
  },
});

const constructionManagement = defineAgent({
  declaration: decl('construction_management', 'Construction Management Agent', 'construction', ['budget_tracking', 'overrun_alerts', 'schedule_slippage', 'change_orders'], ['construction_status']),
  async analyze(ctx) {
    const b = H.worksheet(ctx.understanding, 'construction_budget');
    if (!b) return { status: 'insufficient_data', summary: 'No construction budget on file.', missing: [miss('construction_budget', 'Tracking overruns needs budget, spend and schedule.', 'Enter budget lines, spent, committed, change orders and planned dates in the construction budget worksheet.')], confidence: { score: 0, reasoning: 'No budget.' } };
    const lines = Array.isArray(b.lines) ? b.lines : [];
    const budget = lines.reduce((s, l) => s + (H.pos(l.budget) || 0), 0);
    const spent = lines.reduce((s, l) => s + (H.pos(l.spent) || 0), 0);
    const committed = lines.reduce((s, l) => s + (H.pos(l.committed) || 0), 0);
    const changeOrders = (Array.isArray(b.change_orders) ? b.change_orders : []).reduce((s, c) => s + (H.pos(c.amount) || 0), 0);
    const projected = spent + committed + changeOrders;
    const risks = [];
    const overLines = lines.filter(l => (H.pos(l.spent) || 0) + (H.pos(l.committed) || 0) > (H.pos(l.budget) || 0) && H.pos(l.budget) != null);
    for (const l of overLines) risks.push({ risk: `${l.name || 'Line'} is over budget by ${H.money((H.pos(l.spent) || 0) + (H.pos(l.committed) || 0) - H.pos(l.budget))}.`, severity: 'high', category: 'construction', mitigation: 'Review scope and approve or reject the overrun.' });
    if (budget && projected > budget) risks.push({ risk: `Projected cost ${H.money(projected)} exceeds budget ${H.money(budget)} by ${H.money(projected - budget)}.`, severity: projected > budget * 1.1 ? 'critical' : 'high', category: 'construction', mitigation: 'Re-run deal returns with the new cost.' });
    let schedule = null;
    const start = b.start_date ? new Date(b.start_date) : null, end = b.planned_end_date ? new Date(b.planned_end_date) : null, pctDone = H.pos(b.percent_complete);
    if (start && end && !Number.isNaN(start) && !Number.isNaN(end) && end > start && pctDone != null) {
      const elapsedPct = Math.max(0, Math.min(100, ((Date.now() - start) / (end - start)) * 100));
      schedule = { elapsed_pct: core.round2(elapsedPct), complete_pct: pctDone, behind_by_pts: core.round2(elapsedPct - pctDone) };
      if (elapsedPct - pctDone >= 15) risks.push({ risk: `Schedule slipping: ${core.round2(elapsedPct)}% of time used, ${pctDone}% complete.`, severity: 'high', category: 'timeline', mitigation: 'Get a revised schedule from the contractor; add holding cost for the delay.' });
      if (Date.now() > end && pctDone < 100) risks.push({ risk: 'Planned end date has passed.', severity: 'critical', category: 'timeline', mitigation: 'Agree a new completion date in writing.' });
    }
    return {
      summary: `Budget ${H.money(budget)}; spent ${H.money(spent)}, committed ${H.money(committed)}, change orders ${H.money(changeOrders)}; ${risks.length} alert(s).`,
      findings: [H.finding('Projected cost', claim(core.round2(projected), STATUS.CALCULATED, { source: 'construction budget you provided' }))],
      calculations: [{ name: 'construction_budget_status', inputs: { lines: lines.length }, formula: 'projected = spent + committed + change orders; schedule gap = time elapsed % − percent complete', output: { budget, spent, committed, change_orders: changeOrders, projected: core.round2(projected), variance: core.round2(budget - projected), schedule }, assumptions: [] }],
      risks,
      confidence: { score: 65, reasoning: 'Figures from your budget worksheet; accuracy depends on how current it is.' },
      data: { budget, projected: core.round2(projected), schedule, alerts: risks.length },
    };
  },
});

module.exports = { comparableSales, underwriting, dueDiligence, realEstateLaw, rehabEstimation, constructionManagement, checklistFor };
