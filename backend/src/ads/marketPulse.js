// ─── Market pulse: what Veori actually knows about a market ──────────────────
// Every figure here is counted from the operator's own leads and deals. Nothing
// is modelled, sampled from elsewhere, or borrowed from another operator. Where
// a number would need an external source that is not connected, the component is
// excluded from the score and recorded as a gap, and the remaining weights are
// renormalised so the score never silently absorbs a missing input.

const supabase = require('../config/supabase');
const { ANGLES } = require('./catalog');
const connectors = require('./connectors');

const MAX_ROWS = 5000;
const MIN_LEADS_FOR_SCORE = 20;      // below this no score is produced at all
const MIN_FIELD_SAMPLE = 10;         // below this a component is insufficient
// Two components only describe the operator's own list: what share of their leads
// look distressed, and what share have equity. Those are inventory ratios, and a
// list of 44 hand-picked leads scores 100 on both. A market score has to include
// at least one component about what actually happened - whether the market
// converts, or how fast - or it is not a score, it is a mirror. 50 points of
// weight is exactly the two inventory components, so the floor sits above it.
const MIN_MEASURED_WEIGHT = 55;
const BEHAVIOURAL = ['conversion_proof', 'velocity'];

const round = (n, p = 0) => { const f = 10 ** p; return Math.round(Number(n) * f) / f; };
const pct = (num, den) => (den > 0 ? round((num / den) * 100, 1) : null);

// "Austin, TX" | "78701" | "TX"
function resolveMarket(market) {
  const raw = String(market || '').trim();
  if (!raw) throw Object.assign(new Error('A market is required (a city and state, or a ZIP code)'), { status: 400 });
  if (raw.length > 120) throw Object.assign(new Error('Market name is too long'), { status: 400 });
  if (/^\d{5}$/.test(raw)) return { kind: 'zip', zip: raw, label: raw };
  const m = raw.match(/^(.+?)\s*,\s*([A-Za-z]{2})$/);
  if (m) return { kind: 'city', city: m[1].trim(), state: m[2].toUpperCase(), label: `${m[1].trim()}, ${m[2].toUpperCase()}` };
  if (/^[A-Za-z]{2}$/.test(raw)) return { kind: 'state', state: raw.toUpperCase(), label: raw.toUpperCase() };
  throw Object.assign(new Error('Market must be "City, ST", a 5-digit ZIP, or a 2-letter state'), { status: 400 });
}

function scopeQuery(q, r) {
  if (r.kind === 'zip') return q.eq('property_zip', r.zip);
  if (r.kind === 'city') return q.eq('property_state', r.state).ilike('property_city', r.city);
  return q.eq('property_state', r.state);
}

const LEAD_COLUMNS = 'id,created_at,property_zip,property_city,property_state,property_type,estimated_value,estimated_equity,status,distress_signals,primary_tag,secondary_tags,tags,is_vacant,is_absentee_owner,has_lis_pendens,probate_case,foreclosure_stage,years_delinquent,tax_owed,arrears_amount';

// Does this lead show evidence of the angle's situation? Matching is on recorded
// fields only - tags the operator or the sourcing pipeline actually set.
function matchesAngle(lead, a) {
  const bag = [
    ...(Array.isArray(lead.distress_signals) ? lead.distress_signals : []),
    ...(Array.isArray(lead.secondary_tags) ? lead.secondary_tags : []),
    ...(Array.isArray(lead.tags) ? lead.tags : []),
    lead.primary_tag, lead.foreclosure_stage,
  ].filter(Boolean).map(s => String(s).toLowerCase());
  if (bag.some(v => a.signals.some(s => v.includes(s)) || a.tags.some(t => v.includes(t)))) return true;
  for (const f of a.flags) if (lead[f] === true) return true;
  if (a.id === 'tax_delinquent' && (Number(lead.years_delinquent) > 0 || Number(lead.tax_owed) > 0)) return true;
  if (a.id === 'pre_foreclosure' && Number(lead.arrears_amount) > 0) return true;
  if (a.id === 'high_equity' && Number(lead.estimated_value) > 0 && Number(lead.estimated_equity) / Number(lead.estimated_value) >= 0.5) return true;
  return false;
}

const hasAnyDistress = (lead) => ANGLES.some(a => matchesAngle(lead, a));

async function fetchMarket(userId, r) {
  let lq = supabase.from('leads').select(LEAD_COLUMNS).eq('user_id', userId).order('created_at', { ascending: false }).limit(MAX_ROWS);
  let dq = supabase.from('deals').select('id,lead_id,status,created_at,property_zip,property_city,property_state,assignment_fee,fee_collected_amount').eq('user_id', userId).order('created_at', { ascending: false }).limit(MAX_ROWS);
  const [{ data: leads, error: le }, { data: deals, error: de }] = await Promise.all([scopeQuery(lq, r), scopeQuery(dq, r)]);
  if (le) throw le;
  if (de) throw de;
  // The operator's own baseline across every market, used to judge this one.
  const [{ count: allLeads }, { count: allDeals }] = await Promise.all([
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('deals').select('id', { count: 'exact', head: true }).eq('user_id', userId),
  ]);
  return { leads: leads || [], deals: deals || [], baseline: { leads: allLeads || 0, deals: allDeals || 0 } };
}

// ── Score components ────────────────────────────────────────────────────────
// Each returns { id, label, weight, score, status, basis, sample }.
// status: 'measured' | 'insufficient_data' | 'unavailable'
function components({ leads, deals, baseline }) {
  const n = leads.length;
  const out = [];

  const distressed = leads.filter(hasAnyDistress).length;
  out.push({
    id: 'distress_supply', label: 'Sellers with a reason to move', weight: 30,
    score: n >= MIN_FIELD_SAMPLE ? pct(distressed, n) : null,
    status: n >= MIN_FIELD_SAMPLE ? 'measured' : 'insufficient_data',
    sample: n,
    basis: n >= MIN_FIELD_SAMPLE
      ? `${distressed} of ${n} leads you hold in this market carry at least one recorded distress signal. Score is that share.`
      : `Only ${n} leads in this market; at least ${MIN_FIELD_SAMPLE} are needed before a share means anything.`,
  });

  const priced = leads.filter(l => Number(l.estimated_value) > 0 && Number(l.estimated_equity) >= 0);
  const withRoom = priced.filter(l => Number(l.estimated_equity) / Number(l.estimated_value) >= 0.2).length;
  out.push({
    id: 'equity_room', label: 'Equity to work with', weight: 20,
    score: priced.length >= MIN_FIELD_SAMPLE ? pct(withRoom, priced.length) : null,
    status: priced.length >= MIN_FIELD_SAMPLE ? 'measured' : 'insufficient_data',
    sample: priced.length,
    basis: priced.length >= MIN_FIELD_SAMPLE
      ? `${withRoom} of ${priced.length} leads with both a value and an equity figure have 20% equity or more.`
      : `Only ${priced.length} leads here carry both an estimated value and an estimated equity figure.`,
  });

  const marketRate = n > 0 ? deals.length / n : null;
  const baseRate = baseline.leads > 0 ? baseline.deals / baseline.leads : null;
  let convScore = null, convStatus = 'insufficient_data', convBasis;
  if (n >= MIN_LEADS_FOR_SCORE && baseline.leads >= 50 && baseRate > 0) {
    const ratio = marketRate / baseRate;
    convScore = Math.min(100, round(50 * ratio, 1));
    convStatus = 'measured';
    convBasis = `${deals.length} deals from ${n} leads here (${pct(deals.length, n)}%), against ${pct(baseline.deals, baseline.leads)}% across all your markets. A market matching your own average scores 50; twice your average scores 100.`;
  } else {
    convBasis = `Needs at least ${MIN_LEADS_FOR_SCORE} leads in this market and 50 across your workspace to compare against. You have ${n} here and ${baseline.leads} in total.`;
  }
  out.push({ id: 'conversion_proof', label: 'Does this market convert for you', weight: 25, score: convScore, status: convStatus, sample: n, basis: convBasis });

  // Competition is the one component that cannot be measured from inside Veori.
  out.push({
    id: 'competition_pressure', label: 'How crowded the feed is', weight: 15,
    score: null, status: 'unavailable', sample: 0,
    basis: 'Requires the Meta Ad Library or Google Ads Transparency Center to count advertisers running in this market. Neither is connected, so this is excluded from the score rather than guessed.',
  });

  const byLead = new Map(leads.map(l => [l.id, l]));
  const spans = deals.map(d => { const l = byLead.get(d.lead_id); return l ? (new Date(d.created_at) - new Date(l.created_at)) / 86400000 : null; })
    .filter(v => v != null && v >= 0).sort((a, b) => a - b);
  let velScore = null, velStatus = 'insufficient_data', velBasis = `Needs at least ${MIN_FIELD_SAMPLE} deals traceable to a lead in this market; there are ${spans.length}.`;
  if (spans.length >= MIN_FIELD_SAMPLE) {
    const median = spans.length % 2 ? spans[(spans.length - 1) / 2] : (spans[spans.length / 2 - 1] + spans[spans.length / 2]) / 2;
    velScore = round(Math.max(0, Math.min(100, ((90 - median) / 83) * 100)), 1);
    velStatus = 'measured';
    velBasis = `Median ${round(median)} days from lead to deal across ${spans.length} deals. 7 days or less scores 100, 90 days or more scores 0.`;
  }
  out.push({ id: 'velocity', label: 'How fast a lead becomes a deal', weight: 10, score: velScore, status: velStatus, sample: spans.length, basis: velBasis });

  return out;
}

function opportunityScore(comps, leadCount) {
  const usable = comps.filter(c => c.status === 'measured' && c.score != null);
  const totalWeight = comps.reduce((s, c) => s + c.weight, 0);
  const usableWeight = usable.reduce((s, c) => s + c.weight, 0);
  if (leadCount < MIN_LEADS_FOR_SCORE || !usable.length) {
    return {
      score: null, status: 'insufficient_data',
      basis: `No score is produced. A market needs at least ${MIN_LEADS_FOR_SCORE} leads in your workspace before any of this arithmetic means anything, and ${leadCount} are present. Veori does not publish a number it cannot stand behind.`,
      weight_used: usableWeight, weight_total: totalWeight,
    };
  }
  if (usableWeight < MIN_MEASURED_WEIGHT || !usable.some(c => BEHAVIOURAL.includes(c.id))) {
    const short = comps.filter(c => c.status !== 'measured').map(c => `${c.label} (${c.status === 'unavailable' ? 'no source connected' : 'not enough data'})`);
    return {
      score: null, status: 'insufficient_data',
      basis: `No score is produced. Only ${usableWeight} of ${totalWeight} points of weight could be measured, and none of it says what actually happened in this market - only what share of your own leads look distressed and hold equity. Those are facts about your list, not about the market, and scoring on them alone would flatter any list. Still missing: ${short.join('; ')}.`,
      weight_used: usableWeight, weight_total: totalWeight,
      what_would_fix_it: `Close a few more deals here so lead-to-deal conversion and speed can be measured, or record enough workspace-wide history (50 leads) for this market to be compared against your own average.`,
    };
  }
  const score = round(usable.reduce((s, c) => s + c.score * c.weight, 0) / usableWeight);
  return {
    score, status: 'measured',
    basis: `Weighted from ${usable.length} of ${comps.length} components (${usableWeight} of ${totalWeight} points of weight). Missing components are excluded and the remaining weights renormalised, so the score is not diluted by what could not be measured.`,
    weight_used: usableWeight, weight_total: totalWeight,
  };
}

// ── Angle ranking ───────────────────────────────────────────────────────────
function rankAngles(leads, deals) {
  const dealsByLead = new Set(deals.map(d => d.lead_id).filter(Boolean));
  const ranked = [], no_evidence = [];
  for (const a of ANGLES) {
    const matched = leads.filter(l => matchesAngle(l, a));
    if (!matched.length) {
      no_evidence.push({ angle: a.id, name: a.name, why: 'No lead in this market carries a signal for this situation. Running it would be a guess.' });
      continue;
    }
    const converted = matched.filter(l => dealsByLead.has(l.id)).length;
    ranked.push({
      angle: a.id, name: a.name, audience: a.audience,
      leads: matched.length, share_of_market_leads: pct(matched.length, leads.length),
      deals_from_this_situation: converted,
      conversion: pct(converted, matched.length),
      drivers: a.drivers,
      evidence: `${matched.length} of your ${leads.length} leads here show this situation; ${converted} became deals.`,
      evidence_strength: matched.length >= 30 ? 'strong' : matched.length >= 10 ? 'moderate' : 'thin',
    });
  }
  // Volume first, then demonstrated conversion. Both are counted, neither is modelled.
  ranked.sort((a, b) => (b.leads - a.leads) || ((b.conversion || 0) - (a.conversion || 0)));
  return { ranked, no_evidence };
}

// ── Audience priority ───────────────────────────────────────────────────────
function audienceMatrix(ranked, leads, profile) {
  const overall = ranked.reduce((s, r) => s + r.deals_from_this_situation, 0) / Math.max(1, leads.length) * 100;
  const types = (profile?.property_types || []).map(t => String(t).toLowerCase());
  const min = Number(profile?.price_min) || null, max = Number(profile?.price_max) || null;
  return ranked.map(r => {
    const matched = leads.filter(l => {
      const a = ANGLES.find(x => x.id === r.angle);
      return a && matchesAngle(l, a);
    });
    const typed = types.length ? matched.filter(l => l.property_type && types.includes(String(l.property_type).toLowerCase())).length : null;
    const inBand = (min || max) ? matched.filter(l => {
      const v = Number(l.estimated_value);
      return v > 0 && (!min || v >= min) && (!max || v <= max);
    }).length : null;
    const fit = typed == null && inBand == null ? null
      : round(((typed ?? matched.length) / matched.length) * 0.5 * 100 + ((inBand ?? matched.length) / matched.length) * 0.5 * 100);

    let tier, why;
    const big = (r.share_of_market_leads || 0) >= 15;
    const converts = (r.conversion || 0) >= overall && r.deals_from_this_situation > 0;
    if (r.leads < 5) { tier = 'not enough evidence'; why = `Only ${r.leads} leads. Not enough to spend against.`; }
    else if (big && converts) { tier = 'first'; why = `${r.share_of_market_leads}% of your leads here and converting at or above your own average.`; }
    else if (big || converts) { tier = 'second'; why = big ? 'Large enough to matter, but it has not converted above your average yet.' : 'Converts above your average, but it is a small slice of this market.'; }
    else { tier = 'test'; why = 'Real evidence exists but neither volume nor conversion stands out. Worth a small, measured test.'; }

    return {
      segment: r.angle, name: r.name, tier, why,
      leads: r.leads, share: r.share_of_market_leads, conversion: r.conversion,
      operator_fit: fit,
      operator_fit_basis: fit == null
        ? 'No property types or price band recorded on your ad profile, so fit cannot be scored. Fill those in and it will be.'
        : `Share of these leads matching your recorded property types and price band.`,
      recommended_driver: (ANGLES.find(a => a.id === r.angle)?.drivers || [])[0] || null,
    };
  });
}

// Month-by-month lead flow. This is the operator's own intake, not market demand,
// and the label says so - there is no Trends connector to say otherwise.
function seasonality(leads) {
  const months = new Map();
  const cutoff = Date.now() - 730 * 86400000;
  for (const l of leads) {
    const t = new Date(l.created_at).getTime();
    if (!(t >= cutoff)) continue;
    const k = new Date(l.created_at).toISOString().slice(0, 7);
    months.set(k, (months.get(k) || 0) + 1);
  }
  const rows = [...months.entries()].sort().map(([month, count]) => ({ month, leads: count }));
  return {
    months: rows,
    status: rows.length >= 6 ? 'INFERRED' : 'UNKNOWN',
    note: rows.length >= 6
      ? 'This is when leads arrived in your workspace, which reflects your own activity as much as the market. It is not search demand: no Trends source is connected.'
      : 'Fewer than six months of lead history in this market. No seasonal pattern is claimed.',
  };
}

async function pulse(userId, market) {
  const r = resolveMarket(market);
  const { leads, deals, baseline } = await fetchMarket(userId, r);
  const { data: profile } = await supabase.from('operator_ad_profile').select('*').eq('user_id', userId).maybeSingle();

  const comps = components({ leads, deals, baseline });
  const score = opportunityScore(comps, leads.length);
  const { ranked, no_evidence } = rankAngles(leads, deals);
  const gaps = connectors.gapsFor(['keyword_volume', 'search_trend', 'competitor_ads', 'distress_lists', 'mls_market_stats']);

  // Confidence is the share of the score's weight that was actually measured,
  // scaled by how much data the market has. It is never above the evidence.
  const weightShare = score.weight_total ? score.weight_used / score.weight_total : 0;
  const sampleFactor = Math.min(1, leads.length / 200);
  const data_confidence = score.status === 'measured' ? Math.round(weightShare * (0.4 + 0.6 * sampleFactor) * 100) : 0;

  return {
    market: r.label, scope: r,
    target_zips: [...new Set(leads.map(l => l.property_zip).filter(Boolean))].sort().slice(0, 60),
    lead_sample: leads.length, deal_sample: deals.length, workspace_baseline: baseline,
    components: comps,
    opportunity_score: score.score, opportunity_status: score.status, opportunity_basis: score.basis,
    angle_ranking: ranked, angles_without_evidence: no_evidence,
    audience_matrix: audienceMatrix(ranked, leads, profile),
    seasonality: seasonality(leads),
    operator_profile_present: !!profile,
    data_gaps: gaps,
    data_confidence,
    data_confidence_basis: score.status === 'measured'
      ? `${Math.round(weightShare * 100)}% of the score's weight was measurable, on ${leads.length} leads. Confidence rises with both.`
      : 'No score was produced, so confidence is zero by definition.',
  };
}

module.exports = { pulse, resolveMarket, MIN_MEASURED_WEIGHT, components, opportunityScore, rankAngles, audienceMatrix, seasonality, matchesAngle, hasAnyDistress, MIN_LEADS_FOR_SCORE };
