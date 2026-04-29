/**
 * Comps Service — Rentcast API
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

/**
 * Look up property value + comps for an address.
 * Returns a structured result Alex can speak naturally.
 */
async function lookupPropertyValue(address) {
  if (!RENTCAST_KEY) throw new Error('RENTCAST_API_KEY not configured');

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

  const arv         = value.price || 0;
  const arvLow      = value.priceRangeLow  || Math.round(arv * 0.92);
  const arvHigh     = value.priceRangeHigh || Math.round(arv * 1.08);
  const comps       = value.comparables || [];
  const rentEst     = rent?.rent || null;

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

  return {
    found: true,
    address,
    arv,
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
}

function buildSpokenSummary({ arv, arvLow, arvHigh, maoLight, maoMedium, maoHeavy, recentComps, rentEst }) {
  const fmt = n => '$' + Math.round(n / 1000) + 'k';

  let summary = `Based on comparable sales in your area, properties like yours are selling between ${fmt(arvLow)} and ${fmt(arvHigh)}, with an estimated after-repair value around ${fmt(arv)}.`;

  if (recentComps.length > 0) {
    const c = recentComps[0];
    summary += ` For example, a similar home ${c.distance_miles ? c.distance_miles + ' miles away' : 'nearby'} sold for ${fmt(c.sale_price)}${c.sold_date ? ' in ' + c.sold_date : ''}.`;
  }

  summary += ` Depending on the condition of your property — if it needs light updates we could be around ${fmt(maoLight)}, if it needs more work we'd be closer to ${fmt(maoHeavy)}.`;

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
