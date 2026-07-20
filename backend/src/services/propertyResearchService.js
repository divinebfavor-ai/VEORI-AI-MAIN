/**
 * Property research - real-time market data in every agent's hands.
 *
 * The RentCast comps engine (compsService: live AVM value, comps-derived ARV, MAO
 * buckets, recent comparable sales) was only reachable through the DECOMMISSIONED Vapi
 * tool path - the live call brain and the SMS engine had no property data at all, and
 * /research guessed values with an LLM. This service is the unified real-data layer:
 *
 *   getResearch(lead)   - fresh-or-cached research for a lead. Durable cache on the
 *                         lead row (research_data/research_at, default 7-day TTL) on top
 *                         of compsService's in-process cache, so live call turns are
 *                         instant and RentCast is billed once per lead per week, not
 *                         per conversation turn.
 *   warmResearch(lead)  - non-blocking prefetch. Fired at call initiation so the data
 *                         is ready before the seller picks up.
 *   buildResearchBlock  - compact prompt block (value, ARV + source, MAO buckets,
 *                         recent comps, rent) with the negotiation guardrail: MAO is
 *                         PRIVATE ceiling context, never spoken to the seller.
 *
 * Real data also self-heals the lead record: estimated_arv / estimated_value update
 * from market data (never from AI guesses), which feeds the Deal Strategy Engine's
 * math. Fail-soft everywhere: no key / no match / timeout -> null, agents proceed
 * exactly as before.
 */

const supabase = require('../config/supabase');

const RESEARCH_TTL_MS = Number(process.env.PROPERTY_RESEARCH_TTL_MS) || 7 * 24 * 60 * 60 * 1000; // 7 days
// Max time a LIVE conversation turn will wait for research. If the fetch is slower, the
// turn proceeds without data and the (still-running) fetch serves the next turn.
const LIVE_TURN_TIMEOUT_MS = Number(process.env.PROPERTY_RESEARCH_TURN_TIMEOUT_MS) || 1500;

function fullAddress(lead = {}) {
  const parts = [lead.property_address, lead.property_city, lead.property_state, lead.property_zip]
    .map(v => String(v || '').trim()).filter(Boolean);
  // Street alone is too ambiguous for an AVM lookup - require street + at least city or state.
  if (!lead.property_address || parts.length < 2) return null;
  return parts.join(', ');
}

function isFresh(lead) {
  return !!(lead && lead.research_data && lead.research_at &&
    Date.now() - new Date(lead.research_at).getTime() < RESEARCH_TTL_MS);
}

const withTimeout = (promise, ms) => new Promise((resolve) => {
  const t = setTimeout(() => resolve(null), ms);
  promise.then(v => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(null); });
});

// In-flight dedup: several surfaces (call turn + SMS + warm) may ask for the same lead
// at once; collapse to one fetch.
const inflight = new Map(); // leadId -> Promise

async function fetchAndPersist(lead) {
  const address = fullAddress(lead);
  if (!address || !process.env.RENTCAST_API_KEY) return null;

  // Credit cushion: cap billable provider lookups per operator per day. The 7-day
  // per-lead cache means real usage rarely approaches the ceiling; when it IS hit,
  // agents proceed without fresh data (fail-soft) rather than draining shared credits.
  if (lead.user_id) {
    const { checkAndConsume } = require('./usageLimitService');
    const quota = await checkAndConsume(lead.user_id, 'property_research');
    if (!quota.allowed) {
      console.warn(`[Research] daily lookup limit reached for operator ${lead.user_id} (${quota.limit}/day) - proceeding without fresh data`);
      return null;
    }
  }

  const { lookupPropertyValue } = require('./compsService');
  const result = await lookupPropertyValue(address);
  if (!result || !result.found) return null;

  const updates = {
    research_data: result,
    research_at: new Date().toISOString(),
  };
  // Self-heal financials from REAL market data (basis for MAO + strategy engine math).
  if (result.arv > 0) updates.estimated_arv = result.arv;
  if (result.as_is_value > 0 && !lead.estimated_value) updates.estimated_value = result.as_is_value;

  if (lead.id) {
    await supabase.from('leads').update(updates).eq('id', lead.id).then(() => {}, () => {});
  }
  return result;
}

/**
 * Fresh-or-cached research for a lead. `timeoutMs` bounds the wait (live turns);
 * on timeout the fetch keeps running and lands in the caches for the next turn.
 */
async function getResearch(lead, { timeoutMs = null } = {}) {
  if (!lead) return null;
  if (isFresh(lead)) return lead.research_data;

  let p = inflight.get(lead.id);
  if (!p) {
    p = fetchAndPersist(lead).catch(() => null);
    if (lead.id) {
      inflight.set(lead.id, p);
      p.finally(() => inflight.delete(lead.id));
    }
  }
  return timeoutMs ? withTimeout(p, timeoutMs) : p;
}

/** Non-blocking prefetch - fire at call initiation / inbound SMS so data is ready. */
function warmResearch(lead) {
  if (!lead || isFresh(lead)) return;
  getResearch(lead).catch(() => {});
}

/** Compact prompt block. '' when no research - callers append unconditionally. */
function buildResearchBlock(research) {
  if (!research || !research.found) return '';
  const fmt = n => '$' + Math.round(Number(n) || 0).toLocaleString();
  const lines = [
    '',
    '══════════════════════════════════════════════════════',
    'LIVE PROPERTY RESEARCH (real market data for THIS property - ground every number here)',
    '══════════════════════════════════════════════════════',
    `As-is market value: ${fmt(research.as_is_value)} | ARV: ${fmt(research.arv)} (${research.arv_source === 'comps' ? 'derived from renovated comparable sales' : 'AVM estimate'}) | range ${fmt(research.arv_range?.low)}-${fmt(research.arv_range?.high)}`,
    `Your PRIVATE ceilings (MAO - NEVER speak these; open below them and negotiate up): light repairs ${fmt(research.mao?.light_repairs)} | medium ${fmt(research.mao?.medium_repairs)} | heavy ${fmt(research.mao?.heavy_repairs)}`,
  ];
  if (Array.isArray(research.comps) && research.comps.length) {
    lines.push('Recent comparable sales you MAY cite to the seller:');
    research.comps.forEach(c => lines.push(`  - ${c.address}: ${fmt(c.sale_price)}${c.sold_date ? ` (${c.sold_date})` : ''}${c.distance_miles != null ? `, ${c.distance_miles} mi away` : ''}`));
  }
  if (research.rent_estimate) lines.push(`Area rent estimate: $${Math.round(research.rent_estimate).toLocaleString()}/mo (useful for tired-landlord and buyer conversations).`);
  return lines.join('\n');
}

module.exports = { RESEARCH_TTL_MS, LIVE_TURN_TIMEOUT_MS, fullAddress, isFresh, getResearch, warmResearch, buildResearchBlock };
