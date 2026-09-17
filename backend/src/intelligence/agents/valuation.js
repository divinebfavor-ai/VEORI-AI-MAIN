// ─── Valuation domain: ValuationAgent, ARVAgent ─────────────────────────────
// Values come from evidence on file. Sold comparables are the only basis for a
// comparable-sales value or ARV; listing prices and AVMs are shown as estimates
// with their limits. Nothing here invents a comparable.

const { defineAgent } = require('../agentKit');
const { claim, STATUS } = require('../provenance');
const { round2 } = require('../calc/core');
const H = require('./_shared');

const MIN_SOLD_COMPS = 3;

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function percentile(xs, p) {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  const i = (s.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

// Price per square foot approach over comparables that have price and sqft.
function ppsfIndication(comps, subjectSqft) {
  const usable = comps.filter(c => Number(c.price) > 0 && Number(c.sqft) > 0);
  if (!usable.length || !subjectSqft) return null;
  const ppsf = usable.map(c => Number(c.price) / Number(c.sqft));
  return {
    comps_used: usable.length,
    median_ppsf: round2(median(ppsf)),
    value: round2(median(ppsf) * subjectSqft),
    low: round2(percentile(ppsf, 0.25) * subjectSqft),
    high: round2(percentile(ppsf, 0.75) * subjectSqft),
    formula: 'value = median(price ÷ sqft of comparables) × subject sqft; range = 25th-75th percentile $/sqft × subject sqft',
    comparables: usable.map(c => ({ address: c.address, price: c.price, sqft: c.sqft, ppsf: round2(Number(c.price) / Number(c.sqft)), date: c.date, distance_miles: c.distance_miles, price_type: c.price_type, source: c.source,
      relevance: [c.distance_miles != null ? `${c.distance_miles} mi away` : 'distance unknown', c.correlation != null ? `provider similarity ${Math.round(c.correlation * 100)}%` : null].filter(Boolean).join(', '),
      differences: subjectSqft ? `${Math.round(((Number(c.sqft) - subjectSqft) / subjectSqft) * 100)}% size difference` : null })),
  };
}

const valuation = defineAgent({
  declaration: {
    id: 'valuation', name: 'Valuation Agent', domain: 'valuation', version: '1.0.0',
    capabilities: ['comparable_sales_value', 'income_value', 'avm_reference', 'value_range'],
    required_inputs: ['deal_understanding'], outputs: ['valuation'],
    tools: ['deal_graph.read', 'connectors.value_estimate', 'calc.value_from_cap_rate'], knowledge_sources: ['comparables on file', 'provider AVM', 'operator inputs'],
    permissions: 'RECOMMEND', risk_level: 'medium', handoff_agents: ['arv'], jurisdiction_aware: false, last_knowledge_update: H.KNOWLEDGE_DATE,
  },
  async analyze(ctx) {
    const rep = ctx.understanding;
    const comps = Array.isArray(rep.comparables) ? rep.comparables : [];
    const sold = comps.filter(c => c.price_type === 'sold');
    const listed = comps.filter(c => c.price_type === 'listed');
    const sqft = Number(H.val(rep, 'property.sqft')) || null;
    const methods = [];

    const soldInd = sold.length >= MIN_SOLD_COMPS ? ppsfIndication(sold, sqft) : null;
    if (soldInd) methods.push({ method: 'comparable_sales', status: STATUS.CALCULATED, ...soldInd, weight: 'primary' });
    else methods.push({ method: 'comparable_sales', not_available: sold.length < MIN_SOLD_COMPS ? `Only ${sold.length} sold comparable(s) on file; need ${MIN_SOLD_COMPS}` : 'Subject square footage unknown' });

    const listInd = listed.length ? ppsfIndication(listed, sqft) : null;
    if (listInd) methods.push({ method: 'listing_prices', status: STATUS.ESTIMATED, ...listInd, weight: 'reference only', caveat: 'Listing prices, not sale prices - buyers often pay less.' });

    const avm = H.c(rep, 'financial.as_is_value');
    if (avm.status !== STATUS.UNKNOWN) methods.push({ method: avm.source && /RentCast/.test(avm.source) ? 'avm' : 'value_on_record', status: avm.status, value: avm.value, source: avm.source, weight: 'reference only' });

    const noi = H.input(ctx, 'annual_noi');
    const capRate = H.input(ctx, 'cap_rate_pct');
    if (noi.status !== STATUS.UNKNOWN && capRate.status !== STATUS.UNKNOWN && Number(capRate.value) > 0) {
      methods.push({ method: 'income_approach', status: STATUS.CALCULATED, value: round2(Number(noi.value) / (Number(capRate.value) / 100)), formula: 'value = NOI ÷ cap rate', inputs: { annual_noi: noi.value, cap_rate_pct: capRate.value } });
    } else {
      methods.push({ method: 'income_approach', not_available: 'Needs annual NOI and a market cap rate (supply both to use it)' });
    }

    let value = null, low = null, high = null, basis = null, status = STATUS.UNKNOWN, score = 0, reasoning;
    if (soldInd) {
      ({ value, low, high } = soldInd); basis = `${soldInd.comps_used} sold comparables`; status = STATUS.CALCULATED;
      score = Math.min(85, 50 + soldInd.comps_used * 5);
      reasoning = `${soldInd.comps_used} sold comparables with price and size; no condition adjustments applied, so the range is the 25th-75th percentile.`;
    } else if (avm.status !== STATUS.UNKNOWN) {
      value = avm.value; basis = avm.source; status = avm.status;
      const range = rep.meta?.provider_snapshot?.value?.found ? [rep.meta.provider_snapshot.value.value_low?.value, rep.meta.provider_snapshot.value.value_high?.value] : [null, null];
      [low, high] = range;
      score = avm.status === STATUS.ESTIMATED ? 40 : 25;
      reasoning = `No qualifying sold comparables. Value is ${avm.status.toLowerCase()} (${avm.source}) and has not been checked against sales.`;
    } else if (listInd) {
      ({ value, low, high } = listInd); basis = 'listing prices'; status = STATUS.ESTIMATED; score = 25;
      reasoning = 'Only listing prices are available; sale prices are usually lower, so this is an upper-leaning estimate.';
    } else {
      reasoning = 'No sold comparables, AVM, listing data or value on record.';
    }

    const missing = [];
    if (!soldInd) missing.push(H.missingItem('financial.arv', { item: 'Sold comparable sales', why: 'A defensible value needs closed sales of similar nearby homes, not listings or automated estimates.', how: 'Pull 3+ sold comps within 0.5-1 mile and 6 months from MLS, a title company, or an appraiser.' }));
    if (!sqft) missing.push(H.missingItem('property.sqft'));
    if (!H.known(rep, 'property.condition')) missing.push(H.missingItem('property.condition'));
    const disagreeing = methods.filter(m => m.value != null);
    return {
      status: value == null ? 'insufficient_data' : 'complete',
      summary: value == null ? 'I cannot confirm a value: no sold comparables, AVM or value on record.' : `As-is value indication ${H.money(value)}${low != null && high != null ? ` (range ${H.money(low)}-${H.money(high)})` : ''} from ${basis}.`,
      findings: [H.finding('as-is value', claim(value, status, { source: basis, basis: soldInd?.formula || null, confidence: score }))],
      calculations: methods.filter(m => m.formula).map(m => ({ name: `value_${m.method}`, inputs: m.inputs || { comps_used: m.comps_used, subject_sqft: sqft }, formula: m.formula, output: { value: m.value, low: m.low ?? null, high: m.high ?? null }, assumptions: m.caveat ? [m.caveat] : [] })),
      missing, confidence: { score, reasoning },
      sources: [...new Set(methods.map(m => m.source).filter(Boolean))].map(n => ({ name: n })),
      positions: value != null ? { 'value.as_is': value } : {},
      data: { value, low, high, basis, methods, method_count_with_values: disagreeing.length },
    };
  },
});

const arv = defineAgent({
  declaration: {
    id: 'arv', name: 'ARV Agent', domain: 'valuation', version: '1.0.0',
    capabilities: ['after_repair_value'], required_inputs: ['deal_understanding'], outputs: ['arv_estimate'],
    tools: ['deal_graph.read'], knowledge_sources: ['sold comparables on file', 'ARV on record', 'operator inputs'],
    permissions: 'RECOMMEND', risk_level: 'medium', handoff_agents: ['wholesale'], jurisdiction_aware: false, last_knowledge_update: H.KNOWLEDGE_DATE,
  },
  async analyze(ctx) {
    const rep = ctx.understanding;
    const override = H.input(ctx, 'arv');
    const sqft = Number(H.val(rep, 'property.sqft')) || null;
    const sold = (rep.comparables || []).filter(c => c.price_type === 'sold' && (c.condition === 'renovated' || c.renovated === true));
    const soldAny = (rep.comparables || []).filter(c => c.price_type === 'sold');
    const record = H.c(rep, 'financial.arv');
    let result = null;

    if (override.status !== STATUS.UNKNOWN) {
      result = { value: override.value, status: override.status, basis: 'operator-supplied ARV for this request', score: 55 };
    } else if (sold.length >= MIN_SOLD_COMPS && sqft) {
      const ind = ppsfIndication(sold, sqft);
      result = { value: ind.value, low: ind.low, high: ind.high, status: STATUS.CALCULATED, basis: `${ind.comps_used} renovated sold comparables`, calc: ind, score: Math.min(85, 50 + ind.comps_used * 5) };
    } else if (soldAny.length >= MIN_SOLD_COMPS && sqft) {
      const ind = ppsfIndication(soldAny, sqft);
      result = { value: ind.high, low: ind.value, high: ind.high, status: STATUS.ESTIMATED, basis: `${ind.comps_used} sold comparables of unknown condition (75th percentile used as ARV)`, calc: ind, score: 45 };
    } else if (record.status !== STATUS.UNKNOWN) {
      result = { value: record.value, status: record.status, basis: record.source, score: record.status === STATUS.ESTIMATED ? 30 : 20 };
    }

    const missing = [];
    if (!(sold.length >= MIN_SOLD_COMPS)) missing.push({ item: 'Renovated sold comparables', why_it_matters: 'ARV is what a renovated home like this one sells for; only closed sales of renovated homes prove it.', how_to_get: 'MLS sold search (renovated condition, 0.5-1 mile, last 6 months) or a broker price opinion.' });
    if (!H.known(rep, 'property.condition')) missing.push(H.missingItem('property.condition'));
    return {
      status: result ? 'complete' : 'insufficient_data',
      summary: result ? `ARV ${H.money(result.value)}${result.low != null ? ` (range ${H.money(result.low)}-${H.money(result.high)})` : ''} - ${result.status.toLowerCase()}, based on ${result.basis}.` : 'I cannot confirm an ARV: no sold comparables and no ARV on record.',
      findings: result ? [H.finding('ARV', claim(result.value, result.status, { source: result.basis, confidence: result.score }))] : [],
      calculations: result?.calc ? [{ name: 'arv_ppsf', inputs: { comps_used: result.calc.comps_used, subject_sqft: sqft }, formula: result.calc.formula, output: { value: result.calc.value, low: result.calc.low, high: result.calc.high }, assumptions: ['No per-comparable condition or feature adjustments applied'] }] : [],
      missing,
      confidence: { score: result ? result.score : 0, reasoning: result ? `ARV status ${result.status}; basis: ${result.basis}.${result.status === STATUS.UNVERIFIED ? ' The origin of the ARV on record is not tracked.' : ''}` : 'No evidence for an ARV.' },
      sources: result ? [{ name: result.basis }] : [],
      positions: result ? { 'value.arv': result.value } : {},
      data: result || {},
    };
  },
});

module.exports = { valuation, arv, ppsfIndication, MIN_SOLD_COMPS };
