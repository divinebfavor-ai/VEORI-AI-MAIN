// ─── Learning: the network's results, and the operator's own ────────────────
// Two separate stores, deliberately.
//
//  creative_performance_learnings is the cross-operator pool. It holds no user
//  id, no market name and no address - only the shape of the creative, the
//  platform, and what it produced. Rows carry a one-way contributor hash so the
//  system can require several distinct operators behind any figure it reports
//  without being able to identify any of them.
//
//  operator_learning_model is the operator's own history. As it fills, the
//  recommendation blend shifts from the network toward the operator. It never
//  reaches 100% own data: a floor of network weight stops one operator's local
//  result from hardening into a rule.

const crypto = require('crypto');
const supabase = require('../config/supabase');

const MIN_ROWS_BENCHMARK = 10;        // below this a network figure is not benchmarked
const MIN_CONTRIBUTORS = 3;           // and it must come from at least this many operators
const MIN_ROWS_SIGNAL = 3;            // below this nothing is reported at all
const OWN_DATA_FULL_WEIGHT_AT = 25;   // own results needed for the maximum own-weight
const MAX_OWN_WEIGHT = 0.8;           // the network floor that never goes away

function contributorHash(userId) {
  const salt = process.env.ADS_LEARNING_SALT || process.env.JWT_SECRET;
  if (!salt) throw new Error('ADS_LEARNING_SALT (or JWT_SECRET) must be set before results can be contributed anonymously');
  return crypto.createHmac('sha256', salt).update(`ads-learning:${userId}`).digest('hex');
}

// Coarse enough that a row cannot be traced back to a market or an operator.
function volumeTier(leadSample) {
  const n = Number(leadSample) || 0;
  return n >= 500 ? 'high_volume' : n >= 100 ? 'medium_volume' : 'low_volume';
}
const seasonOf = (d = new Date()) => ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'][d.getMonth()];

const int = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 ? n : 0; };
const money = (v) => { const n = Math.round(Number(v) * 100); return Number.isFinite(n) && n >= 0 ? n : null; };
const median = (arr) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

// ── Contributing a result ───────────────────────────────────────────────────
async function record(userId, result = {}) {
  const impressions = int(result.impressions), clicks = int(result.clicks), leads = int(result.leads);
  const qualified = Math.min(int(result.qualified_leads), leads);
  const contracts = Math.min(int(result.contracts), Math.max(qualified, leads));
  const spend = Number(result.spend);
  if (!Number.isFinite(spend) || spend < 0) throw Object.assign(new Error('spend is required and must be a number'), { status: 400 });
  if (clicks > impressions && impressions > 0) throw Object.assign(new Error('clicks cannot exceed impressions'), { status: 400 });

  const row = {
    contributor_hash: contributorHash(userId),
    market_type: volumeTier(result.market_lead_sample),
    distress_type: result.distress_type || null,
    campaign_angle: result.angle || null,
    psychological_driver: result.psychological_driver || null,
    image_format: result.image_format || null,
    hook_style: result.hook_style || null,
    platform: result.platform || null,
    audience_age_range: result.audience_age_range || null,
    impressions, clicks, leads, qualified_leads: qualified, contracts,
    ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 10000 : null,
    cpl_cents: leads > 0 ? money(spend / leads) : null,
    cpql_cents: qualified > 0 ? money(spend / qualified) : null,
    cost_per_contract_cents: contracts > 0 ? money(spend / contracts) : null,
    market_competitive_density: 'unknown',
    season: seasonOf(), year: new Date().getFullYear(),
  };
  const { data, error } = await supabase.from('creative_performance_learnings').insert(row).select('id').single();
  if (error) throw error;
  await rebuildOperatorModel(userId).catch(e => console.error('[ads.learning] operator model rebuild failed:', e.message));
  return { recorded: data.id, anonymised: true, stored_fields: Object.keys(row).filter(k => k !== 'contributor_hash') };
}

// ── What the network has seen ───────────────────────────────────────────────
// Groups are only reported when several distinct operators stand behind them.
function summarise(rows, key) {
  const groups = new Map();
  for (const r of rows) {
    const k = r[key];
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const out = [];
  for (const [value, list] of groups) {
    const contributors = new Set(list.map(r => r.contributor_hash).filter(Boolean)).size;
    if (list.length < MIN_ROWS_SIGNAL || contributors < 2) continue;
    const benchmarked = list.length >= MIN_ROWS_BENCHMARK && contributors >= MIN_CONTRIBUTORS;
    const cpls = list.map(r => r.cpl_cents).filter(v => v != null);
    const cpcs = list.map(r => r.cost_per_contract_cents).filter(v => v != null);
    const ctrs = list.map(r => r.ctr).filter(v => v != null);
    out.push({
      value, results: list.length, contributors,
      label: benchmarked ? 'BENCHMARKED' : 'ESTIMATED',
      label_meaning: benchmarked
        ? `Median of ${list.length} recorded results from ${contributors} operators.`
        : `Only ${list.length} results from ${contributors} operators. Directional, not a benchmark, and it may move a lot as more come in.`,
      median_cpl: cpls.length ? median(cpls) / 100 : null,
      cpl_range: cpls.length > 1 ? [Math.min(...cpls) / 100, Math.max(...cpls) / 100] : null,
      median_cost_per_contract: cpcs.length ? median(cpcs) / 100 : null,
      median_ctr: ctrs.length ? Math.round(median(ctrs.map(c => c * 10000)) / 100) / 100 : null,
      total_leads: list.reduce((s, r) => s + (r.leads || 0), 0),
      total_contracts: list.reduce((s, r) => s + (r.contracts || 0), 0),
    });
  }
  return out.sort((a, b) => (a.median_cpl == null ? Infinity : a.median_cpl) - (b.median_cpl == null ? Infinity : b.median_cpl));
}

async function networkGuidance({ angles = [], platform = null, marketType = null } = {}) {
  let q = supabase.from('creative_performance_learnings').select('*').limit(5000);
  if (platform) q = q.eq('platform', platform);
  if (marketType) q = q.eq('market_type', marketType);
  const { data, error } = await q;
  if (error) throw error;
  const rows = data || [];
  const relevant = angles.length ? rows.filter(r => !r.campaign_angle || angles.includes(r.campaign_angle)) : rows;
  const contributors = new Set(rows.map(r => r.contributor_hash).filter(Boolean)).size;

  return {
    data_points: rows.length,
    contributors,
    usable: rows.length >= MIN_ROWS_SIGNAL,
    by_angle: summarise(relevant, 'campaign_angle'),
    by_driver: summarise(relevant, 'psychological_driver'),
    by_hook_style: summarise(relevant, 'hook_style'),
    by_image_format: summarise(relevant, 'image_format'),
    by_platform: summarise(rows, 'platform'),
    cpl_note: 'Every cost figure here is what other operators actually recorded, for the shape of creative shown. It is not a quote, not a forecast and not a guarantee of what any campaign will cost.',
    empty_note: rows.length >= MIN_ROWS_SIGNAL ? null
      : `The network has ${rows.length} recorded results, below the ${MIN_ROWS_SIGNAL} needed to report anything. Nothing about performance is claimed until operators have recorded results. Recommendations come from evidence in your own workspace instead.`,
  };
}

// ── The operator's own model ────────────────────────────────────────────────
async function rebuildOperatorModel(userId) {
  const [{ data: creatives }, { data: leads }] = await Promise.all([
    supabase.from('ad_creatives').select('id,angle,psychological_driver,market,campaign_id,created_at').eq('user_id', userId).limit(2000),
    supabase.from('leads').select('id,property_zip,source,created_at,status').eq('user_id', userId).limit(5000),
  ]);
  const { data: rows } = await supabase.from('creative_performance_learnings').select('*').eq('contributor_hash', contributorHash(userId)).limit(2000);
  const mine = rows || [];

  const best = (key) => {
    const g = new Map();
    for (const r of mine) {
      const k = r[key];
      if (!k || r.cost_per_contract_cents == null) continue;
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(r.cost_per_contract_cents);
    }
    let winner = null, bestVal = Infinity;
    for (const [k, v] of g) { const m = median(v); if (m != null && m < bestVal) { bestVal = m; winner = k; } }
    return winner;
  };
  const byChannel = (field) => {
    const g = {};
    for (const r of mine) {
      if (!r.platform || r[field] == null) continue;
      (g[r.platform] = g[r.platform] || []).push(r[field]);
    }
    return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, median(v) / 100]));
  };

  const zipCounts = new Map();
  for (const l of leads || []) if (l.property_zip) zipCounts.set(l.property_zip, (zipCounts.get(l.property_zip) || 0) + 1);
  const topZips = [...zipCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([zip, leads]) => ({ zip, leads }));

  const totalLeads = mine.reduce((s, r) => s + (r.leads || 0), 0);
  const totalContracts = mine.reduce((s, r) => s + (r.contracts || 0), 0);

  const row = {
    user_id: userId,
    best_converting_distress_type: best('distress_type'),
    best_converting_audience_age_range: best('audience_age_range'),
    best_converting_platform: best('platform'),
    best_converting_angle: best('campaign_angle'),
    best_converting_zip_codes: topZips,
    avg_cpl_by_channel: byChannel('cpl_cents'),
    avg_cost_per_contract_by_channel: byChannel('cost_per_contract_cents'),
    leads_to_contract_rate: totalLeads > 0 ? Math.round((totalContracts / totalLeads) * 10000) / 10000 : null,
    data_points: mine.length,
    last_updated: new Date().toISOString(),
  };
  const { error } = await supabase.from('operator_learning_model').upsert(row, { onConflict: 'user_id' });
  if (error) throw error;
  return { ...row, creatives_on_file: (creatives || []).length };
}

async function operatorModel(userId) {
  const { data, error } = await supabase.from('operator_learning_model').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data || null;
}

// ── The weight shift ────────────────────────────────────────────────────────
// How much of a recommendation comes from this operator's own results versus the
// network's. Stated explicitly so the operator can see it move.
function blend(ownDataPoints) {
  const n = Math.max(0, Number(ownDataPoints) || 0);
  const own = Math.min(MAX_OWN_WEIGHT, (n / OWN_DATA_FULL_WEIGHT_AT) * MAX_OWN_WEIGHT);
  return {
    own_weight: Math.round(own * 100), network_weight: Math.round((1 - own) * 100),
    own_data_points: n,
    explanation: n === 0
      ? 'You have recorded no results yet, so everything here comes from what other operators have seen and from the evidence in your own leads. Record results and this shifts.'
      : `${n} of your own recorded results. Your data carries ${Math.round(own * 100)}% of the weight; it reaches its maximum of ${Math.round(MAX_OWN_WEIGHT * 100)}% at ${OWN_DATA_FULL_WEIGHT_AT} results.`,
    why_not_all_own: `The network keeps at least ${Math.round((1 - MAX_OWN_WEIGHT) * 100)}% of the weight permanently, so a run of luck in one workspace never becomes a rule.`,
  };
}

module.exports = { record, networkGuidance, operatorModel, rebuildOperatorModel, blend, contributorHash, volumeTier, summarise, MIN_ROWS_BENCHMARK, MIN_CONTRIBUTORS, OWN_DATA_FULL_WEIGHT_AT, MAX_OWN_WEIGHT };
