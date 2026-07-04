/**
 * Comps Service - Rentcast API
 * Gives Alex real ARV, comparable sales, and repair-adjusted offers
 * during live calls. Called as a Vapi tool.
 */

const axios = require('axios');

const RENTCAST_KEY = process.env.RENTCAST_API_KEY;
const BASE = 'https://api.rentcast.io/v1';

const headers = () => ({
  'X-Api-Key': RENTCAST_KEY,
  Accept: 'application/json',
});

// ─── In-process comps cache ──────────────────────────────────────────────────
// Rentcast bills per request and a single live call can trigger the lookup tool
// several times (seller restates address, AI re-checks before countering). An
// address-keyed TTL cache collapses those into one API hit and makes retries
// free. Process-local (no Redis dependency) - fine because a call lives on one
// worker; a cold start simply re-fetches. TTL is long enough to cover a full
// call + immediate follow-up, short enough that values don't go stale.
const COMPS_TTL_MS = Number(process.env.COMPS_CACHE_TTL_MS) || 6 * 60 * 60 * 1000; // 6h
const _compsCache = new Map(); // normalizedAddress -> { at, result }

function _cacheKey(address) {
  return String(address || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// ─── Comps-based ARV ─────────────────────────────────────────────────────────
// WHY: Rentcast's avm `value.price` is the AS-IS market value - what the home is
// worth in its CURRENT condition. For a distressed/wholesale lead that is NOT the
// ARV (After-Repair Value), which is what comparable RENOVATED homes sell for.
// Using as-is value as ARV understates ARV → understates MAO → offers come in too
// low → fewer contracts. The truest ARV signal we have is the comparable sales
// themselves: renovated homes that actually closed. We take the median $/sqft of
// the returned comps and multiply by the subject's sqft. We only trust this when
// we have enough comps with usable price+sqft; otherwise we fall back to the AVM
// (never fabricate). Returns null when no reliable comps-derived figure exists.
function deriveArvFromComps(comps, subjectSqft) {
  if (!Array.isArray(comps) || comps.length < 3 || !subjectSqft) return null;
  const ppsf = comps
    .map(c => (c.price && c.squareFootage ? c.price / c.squareFootage : null))
    .filter(v => v && isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  if (ppsf.length < 3) return null;
  const mid = Math.floor(ppsf.length / 2);
  const medianPpsf = ppsf.length % 2 ? ppsf[mid] : (ppsf[mid - 1] + ppsf[mid]) / 2;
  const arv = Math.round(medianPpsf * subjectSqft);
  return arv > 0 ? arv : null;
}

/**
 * Look up property value + comps for an address.
 * Returns a structured result Alex can speak naturally.
 */
async function lookupPropertyValue(address) {
  if (!RENTCAST_KEY) throw new Error('RENTCAST_API_KEY not configured');

  // Serve from cache if a recent lookup for this address exists.
  const key = _cacheKey(address);
  const cached = _compsCache.get(key);
  if (cached && Date.now() - cached.at < COMPS_TTL_MS) {
    return cached.result;
  }

  const [valueRes, rentRes] = await Promise.allSettled([
    axios.get(`${BASE}/avm/value`, {
      params: { address, propertyType: 'Single Family', compCount: 5 },
      headers: headers(),
      timeout: 10000,
    }),
    axios.get(`${BASE}/avm/rent/long-term`, {
      params: { address, propertyType: 'Single Family', compCount: 3 },
      headers: headers(),
      timeout: 10000,
    }),
  ]);

  const value = valueRes.status === 'fulfilled' ? valueRes.value.data : null;
  const rent  = rentRes.status  === 'fulfilled' ? rentRes.value.data  : null;

  if (!value) {
    return {
      found: false,
      message: 'Could not find comparable sales for that address. Try providing the full address with city and state.',
    };
  }

  const comps       = value.comparables || [];
  const rentEst     = rent?.rent || null;
  const asIsValue   = value.price || 0;        // Rentcast AVM = AS-IS market value
  const subjectSqft = value.squareFootage || null;

  // True ARV = renovated-comp value. Prefer the comps-derived figure (median $/sqft
  // of recent comparable sales × subject sqft); fall back to the AVM only when the
  // comps are too thin to be reliable. This is the accuracy fix: as-is value is no
  // longer mislabeled as ARV.
  const compsArv    = deriveArvFromComps(comps, subjectSqft);
  const arv         = compsArv || asIsValue || 0;
  const arvSource   = compsArv ? 'comps' : (asIsValue ? 'avm_as_is' : 'none');
  const arvLow      = value.priceRangeLow  || Math.round(arv * 0.92);
  const arvHigh     = value.priceRangeHigh || Math.round(arv * 1.08);

  // MAO at 70% ARV with placeholder repair buckets
  const maoLight  = Math.round(arv * 0.70 - 15000);  // light repairs
  const maoMedium = Math.round(arv * 0.70 - 35000);  // medium repairs
  const maoHeavy  = Math.round(arv * 0.70 - 65000);  // heavy repairs

  const recentComps = comps.slice(0, 3).map(c => ({
    address: c.formattedAddress || c.address,
    sale_price: c.price,
    sqft: c.squareFootage,
    sold_date: c.lastSaleDate ? new Date(c.lastSaleDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : null,
    distance_miles: c.distance ? Math.round(c.distance * 10) / 10 : null,
  }));

  const result = {
    found: true,
    address,
    arv,
    arv_source: arvSource,   // 'comps' (renovated-comp ARV) | 'avm_as_is' (fallback)
    as_is_value: asIsValue,  // Rentcast AVM, current condition - kept for reference
    arv_range: { low: arvLow, high: arvHigh },
    mao: {
      light_repairs:  maoLight,
      medium_repairs: maoMedium,
      heavy_repairs:  maoHeavy,
    },
    rent_estimate: rentEst,
    comps: recentComps,
    // Pre-formatted summary Alex can speak directly
    spoken_summary: buildSpokenSummary({ arv, arvLow, arvHigh, maoLight, maoMedium, maoHeavy, recentComps, rentEst }),
  };

  _compsCache.set(key, { at: Date.now(), result });
  return result;
}

function buildSpokenSummary({ arv, arvLow, arvHigh, maoLight, maoMedium, maoHeavy, recentComps, rentEst }) {
  const fmt = n => '$' + Math.round(n / 1000) + 'k';

  let summary = `Based on comparable sales in your area, properties like yours are selling between ${fmt(arvLow)} and ${fmt(arvHigh)}, with an estimated after-repair value around ${fmt(arv)}.`;

  if (recentComps.length > 0) {
    const c = recentComps[0];
    summary += ` For example, a similar home ${c.distance_miles ? c.distance_miles + ' miles away' : 'nearby'} sold for ${fmt(c.sale_price)}${c.sold_date ? ' in ' + c.sold_date : ''}.`;
  }

  // E - never leak the ceiling. MAO is the MAXIMUM we'd pay; speaking it anchors
  // the seller to the top and kills all negotiating room. A real wholesaler opens
  // BELOW their ceiling and lets the seller pull them up. So we speak a conservative
  // OPENING range (~82% of MAO for light, MAO-heavy as the low end) - leaving the
  // spread between this and the true MAO as live negotiating room. The true MAO is
  // still returned in `mao` + formatForAlex() for the AI's private context only.
  const openLight = Math.round(maoLight * 0.82);
  const openHeavy = Math.round(maoHeavy * 0.82);
  summary += ` Depending on the condition of your property, I'd likely be somewhere between ${fmt(openHeavy)} and ${fmt(openLight)} - but I'd want to know more about what it needs before I lock in a number.`;

  if (rentEst) {
    summary += ` For a buyer looking to rent, estimated monthly rent in that area is around $${Math.round(rentEst).toLocaleString()}.`;
  }

  return summary;
}

/**
 * Format the result as a short Alex-readable string for the tool response.
 * Vapi injects this back into the conversation context.
 */
function formatForAlex(result) {
  if (!result.found) return result.message;

  const fmt = n => '$' + Number(n).toLocaleString();
  const lines = [
    `ARV: ${fmt(result.arv)} (range ${fmt(result.arv_range.low)}–${fmt(result.arv_range.high)})`,
    `MAO (light repairs ~$15k): ${fmt(result.mao.light_repairs)}`,
    `MAO (medium repairs ~$35k): ${fmt(result.mao.medium_repairs)}`,
    `MAO (heavy repairs ~$65k): ${fmt(result.mao.heavy_repairs)}`,
  ];

  if (result.comps.length > 0) {
    lines.push('Recent comps:');
    result.comps.forEach(c => {
      lines.push(`  - ${c.address}: ${fmt(c.sale_price)}${c.sold_date ? ' (' + c.sold_date + ')' : ''}${c.distance_miles ? ', ' + c.distance_miles + ' mi away' : ''}`);
    });
  }

  if (result.rent_estimate) {
    lines.push(`Rent estimate: $${Math.round(result.rent_estimate).toLocaleString()}/mo`);
  }

  lines.push('', result.spoken_summary);
  return lines.join('\n');
}

module.exports = { lookupPropertyValue, formatForAlex };
