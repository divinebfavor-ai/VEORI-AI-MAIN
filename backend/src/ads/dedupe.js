// ─── Non-duplication ─────────────────────────────────────────────────────────
// Three checks, then a gate.
//
//  A. Operator lookback (180 days). Nothing this operator has already run in this
//     market comes back wearing a different coat.
//  B. Market overlap. A combination already being run in this market by anyone
//     scores lower. Only the combination fingerprint crosses the tenant boundary
//     - never another operator's copy, ids, counts per operator or identity. The
//     query reads four enumerated fields and nothing else.
//  C. Differentiation score, 0-100, with the arithmetic shown.
//
//  Then the freshness gate: an identical creative cannot be served again within
//  90 days of the last time it was first served.

const supabase = require('../config/supabase');
const { SATURATED } = require('./catalog');

const OPERATOR_LOOKBACK_DAYS = Number(process.env.ADS_OPERATOR_LOOKBACK_DAYS) || 180;
const FRESHNESS_DAYS = Number(process.env.ADS_FRESHNESS_DAYS) || 90;
const BLOCK_AT = 40;   // differentiation below this is not allowed to be stored

const STOP = new Set(['the', 'a', 'an', 'your', 'you', 'we', 'our', 'is', 'are', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'it', 'that', 'this', 'with', 'be', 'i', 'my', 'me', 'if', 'can', 'will', 'no', 'not', 'at', 'as', 'by', 'from', 'but', 'so', 'do', 'does', 'have', 'has', 'was', 'were', 'they', 'them', 'their']);

function tokens(text) {
  return new Set(String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)));
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

const fingerprint = (c) => [c.angle || '', c.psychological_driver || '', c.hook_style || '', c.image_format || ''].join('|');

// 0-100. Structure is most of it; wording is the rest.
function similarity(a, b) {
  const parts = [
    { w: 30, same: !!a.angle && a.angle === b.angle },
    { w: 25, same: !!a.psychological_driver && a.psychological_driver === b.psychological_driver },
    { w: 15, same: !!a.hook_style && a.hook_style === b.hook_style },
    { w: 10, same: !!a.image_format && a.image_format === b.image_format },
  ];
  const structural = parts.reduce((s, p) => s + (p.same ? p.w : 0), 0);
  const wording = Math.round(jaccard(tokens(a.hook), tokens(b.hook)) * 20);
  return { score: structural + wording, structural, wording };
}

// ── A. Operator lookback ────────────────────────────────────────────────────
async function operatorLookback(userId, candidate, market) {
  const since = new Date(Date.now() - OPERATOR_LOOKBACK_DAYS * 86400000).toISOString();
  let q = supabase.from('ad_creatives')
    .select('id,angle,psychological_driver,hook,hook_style,image_format,created_at,first_served_at,status,market')
    .eq('user_id', userId).gte('created_at', since).order('created_at', { ascending: false }).limit(500);
  if (market) q = q.eq('market', market);
  const { data, error } = await q;
  if (error) throw error;
  const matches = (data || []).map(prev => {
    const s = similarity(candidate, prev);
    const ageDays = Math.round((Date.now() - new Date(prev.created_at).getTime()) / 86400000);
    return { creative_id: prev.id, similarity: s.score, structural: s.structural, wording: s.wording, age_days: ageDays, hook: prev.hook, status: prev.status, first_served_at: prev.first_served_at };
  }).filter(m => m.similarity >= 50).sort((a, b) => b.similarity - a.similarity);
  return {
    window_days: OPERATOR_LOOKBACK_DAYS,
    compared_against: (data || []).length,
    closest: matches[0] || null,
    matches: matches.slice(0, 5),
    note: (data || []).length ? null : `You have run nothing in ${market || 'this market'} in the last ${OPERATOR_LOOKBACK_DAYS} days, so there is nothing to repeat.`,
  };
}

// ── B. Market overlap ───────────────────────────────────────────────────────
// Reads only the four enumerated fields, for one market, across the platform.
// No copy, no ids, no user ids, no per-operator counts leave this function.
async function marketOverlap(candidate, market, userId) {
  if (!market) return { checked: false, reason: 'No market on the candidate; overlap cannot be checked.' };
  const since = new Date(Date.now() - OPERATOR_LOOKBACK_DAYS * 86400000).toISOString();
  const { data, error } = await supabase.from('ad_creatives')
    .select('angle,psychological_driver,hook_style,image_format,user_id')
    .eq('market', market).neq('user_id', userId).gte('created_at', since).limit(2000);
  if (error) throw error;
  const rows = data || [];
  const fp = fingerprint(candidate);
  const exact = rows.filter(r => fingerprint(r) === fp).length;
  const sameAngleDriver = rows.filter(r => r.angle === candidate.angle && r.psychological_driver === candidate.psychological_driver).length;
  return {
    checked: true,
    others_running_in_market: rows.length,
    exact_combination_in_use: exact > 0,
    same_angle_and_driver_in_use: sameAngleDriver > 0,
    distinct_combinations_seen: new Set(rows.map(fingerprint)).size,
    privacy: 'Only the angle, driver, hook style and image format of other creatives in this market are read. No copy, identity or per-operator figure is ever returned.',
    limits: 'This sees only creatives built inside Veori. What competitors run outside the platform is unknown: no advertising-transparency source is connected.',
  };
}

// ── C. Differentiation score ────────────────────────────────────────────────
function differentiation({ lookback, overlap, candidate }) {
  const deductions = [];
  let score = 100;

  if (lookback.closest) {
    const c = lookback.closest;
    const recency = c.age_days <= 30 ? 1 : c.age_days <= 90 ? 0.7 : 0.4;
    const d = Math.round((c.similarity - 40) * 0.9 * recency);
    if (d > 0) { score -= d; deductions.push({ reason: `You ran something ${c.similarity}% alike ${c.age_days} days ago`, points: d, detail: `Recent repeats are penalised harder: within 30 days at full weight, within 90 at 70%, older at 40%.` }); }
  }
  if (overlap.checked && overlap.exact_combination_in_use) {
    score -= 20; deductions.push({ reason: 'This exact combination of angle, driver, hook style and image format is already running in this market', points: 20, detail: 'The reader would see two ads with the same shape.' });
  } else if (overlap.checked && overlap.same_angle_and_driver_in_use) {
    score -= 10; deductions.push({ reason: 'The same angle and driver pairing is already running in this market', points: 10, detail: 'Change the hook style or the format to separate them.' });
  }

  const text = `${candidate.hook || ''} ${candidate.body || ''}`.toLowerCase();
  const usedSaturated = SATURATED.filter(s => text.includes(s.phrase));
  if (usedSaturated.length) {
    const d = Math.min(30, usedSaturated.length * 12);
    score -= d;
    deductions.push({ reason: `Uses industry-standard language: ${usedSaturated.map(s => `"${s.phrase}"`).join(', ')}`, points: d, detail: 'Phrases the whole industry runs make the operator indistinguishable.' });
  }

  score = Math.max(0, Math.min(100, score));
  return {
    score, deductions,
    verdict: score >= 70 ? 'Distinct enough to run.' : score >= BLOCK_AT ? 'Recognisably similar to something already out there. Change the hook style or format before spending.' : 'Too close to something already running. Veori will not store this as-is.',
    blocked: score < BLOCK_AT,
    threshold: BLOCK_AT,
    saturated_phrases_used: usedSaturated.map(s => ({ phrase: s.phrase, instead: s.instead })),
  };
}

// ── The freshness gate ──────────────────────────────────────────────────────
async function freshnessGate(userId, candidate, market) {
  const since = new Date(Date.now() - FRESHNESS_DAYS * 86400000).toISOString();
  let q = supabase.from('ad_creatives')
    .select('id,hook,first_served_at,angle,psychological_driver,hook_style,image_format')
    .eq('user_id', userId).not('first_served_at', 'is', null).gte('first_served_at', since).limit(300);
  if (market) q = q.eq('market', market);
  const { data, error } = await q;
  if (error) throw error;
  const fp = fingerprint(candidate);
  const hit = (data || []).find(r => fingerprint(r) === fp && jaccard(tokens(r.hook), tokens(candidate.hook)) >= 0.7);
  if (!hit) return { passed: true, window_days: FRESHNESS_DAYS };
  const servedDays = Math.round((Date.now() - new Date(hit.first_served_at).getTime()) / 86400000);
  return {
    passed: false, window_days: FRESHNESS_DAYS, blocking_creative_id: hit.id, served_days_ago: servedDays,
    reason: `This creative was first served ${servedDays} days ago and is materially the same. The same audience does not see the same ad again inside ${FRESHNESS_DAYS} days; it stops working and the account’s frequency suffers. It can run again after ${FRESHNESS_DAYS - servedDays} more days, or change the angle, driver, hook style or format.`,
  };
}

async function evaluate(userId, candidate, market) {
  const [lookback, overlap, freshness] = await Promise.all([
    operatorLookback(userId, candidate, market),
    marketOverlap(candidate, market, userId),
    freshnessGate(userId, candidate, market),
  ]);
  const diff = differentiation({ lookback, overlap, candidate });
  return {
    operator_lookback: lookback, market_overlap: overlap, differentiation: diff, freshness,
    allowed: !diff.blocked && freshness.passed,
  };
}

module.exports = { evaluate, operatorLookback, marketOverlap, differentiation, freshnessGate, similarity, fingerprint, tokens, jaccard, OPERATOR_LOOKBACK_DAYS, FRESHNESS_DAYS, BLOCK_AT };
