// ─── RentCast connector (licensed data provider) ────────────────────────────
// Endpoints and fields checked against developers.rentcast.io (2026-09-17):
//   GET /v1/properties?address=      property record (public-record derived)
//   GET /v1/avm/value?address=       value estimate + comparables
//   GET /v1/avm/rent/long-term       rent estimate + comparables
//   GET /v1/markets?zipCode=         zip-level sale and rental statistics
// Important: AVM "comparables" are LISTINGS (they carry status, listedDate and
// removedDate; price is the listing price). They are labelled price_type 'listed',
// never as closed sales. AVM figures are ESTIMATED, not VERIFIED.
// Auth: X-Api-Key header. Rate limit: 20 requests/second.

const axios = require('axios');
const { claim, STATUS } = require('../provenance');

const BASE = 'https://api.rentcast.io/v1';
const SOURCE = 'RentCast';
const TIER = 'licensed_provider';
const TIMEOUT_MS = 12000;
const CACHE_TTL_MS = Number(process.env.RENTCAST_CACHE_TTL_MS) || 6 * 60 * 60 * 1000;

let http = axios;
const cache = new Map();

const isConfigured = () => !!process.env.RENTCAST_API_KEY;

async function get(path, params) {
  if (!isConfigured()) throw Object.assign(new Error('RentCast is not connected (RENTCAST_API_KEY not set)'), { code: 'NOT_CONFIGURED' });
  const key = `${path}?${JSON.stringify(params)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { data: hit.data, retrieved_at: hit.retrieved_at, cached: true };
  try {
    const res = await http.get(`${BASE}${path}`, {
      params, timeout: TIMEOUT_MS,
      headers: { 'X-Api-Key': process.env.RENTCAST_API_KEY, Accept: 'application/json' },
    });
    const retrieved_at = new Date().toISOString();
    cache.set(key, { at: Date.now(), data: res.data, retrieved_at });
    if (cache.size > 2000) cache.delete(cache.keys().next().value);
    return { data: res.data, retrieved_at, cached: false };
  } catch (err) {
    const status = err.response?.status;
    const providerError = err.response?.data?.error;
    if (status === 404) return { data: null, retrieved_at: new Date().toISOString(), cached: false, not_found: true };
    let message = `RentCast request failed${status ? ` (${status})` : ''}`;
    let code = 'PROVIDER_ERROR';
    if (providerError === 'billing/subscription-inactive') { message = 'RentCast subscription is inactive - reactivate it at app.rentcast.io/app/api'; code = 'SUBSCRIPTION_INACTIVE'; }
    else if (status === 401 || status === 403) { message = 'RentCast rejected the API key'; code = 'AUTH_FAILED'; }
    else if (status === 429) { message = 'RentCast rate limit reached'; code = 'RATE_LIMITED'; }
    throw Object.assign(new Error(message), { code, status });
  }
}

const c = (value, status, as_of, extra = {}) => claim(value, status, { source: SOURCE, source_tier: TIER, as_of, ...extra });
const latestYearEntry = (obj) => {
  if (!obj || typeof obj !== 'object') return null;
  const years = Object.keys(obj).filter(k => /^\d{4}$/.test(k)).sort();
  return years.length ? { year: Number(years[years.length - 1]), ...obj[years[years.length - 1]] } : null;
};

async function propertyRecord(address) {
  const { data, retrieved_at, cached } = await get('/properties', { address, limit: 1 });
  const rec = Array.isArray(data) ? data[0] : null;
  if (!rec) return { found: false, retrieved_at, cached };
  const assessment = latestYearEntry(rec.taxAssessments);
  const tax = latestYearEntry(rec.propertyTaxes);
  const sales = rec.history && typeof rec.history === 'object'
    ? Object.values(rec.history).filter(h => h && h.event === 'Sale').map(h => ({ date: h.date, price: h.price })).sort((a, b) => String(b.date).localeCompare(String(a.date)))
    : [];
  // Public-record derived attributes from a licensed aggregator: UNVERIFIED until
  // confirmed against the county record or a title report.
  const U = STATUS.UNVERIFIED;
  return {
    found: true, cached, retrieved_at, provider_id: rec.id,
    facts: {
      formatted_address: c(rec.formattedAddress, U, retrieved_at),
      county: c(rec.county, U, retrieved_at),
      parcel_id: c(rec.assessorID, U, retrieved_at),
      property_type: c(rec.propertyType, U, retrieved_at),
      bedrooms: c(rec.bedrooms, U, retrieved_at),
      bathrooms: c(rec.bathrooms, U, retrieved_at),
      sqft: c(rec.squareFootage, U, retrieved_at),
      lot_sqft: c(rec.lotSize, U, retrieved_at),
      year_built: c(rec.yearBuilt, U, retrieved_at),
      zoning: c(rec.zoning, U, retrieved_at),
      units: c(rec.features?.unitCount, U, retrieved_at),
      last_sale_date: c(rec.lastSaleDate, U, retrieved_at),
      last_sale_price: c(rec.lastSalePrice, U, retrieved_at),
      owner_names: c(Array.isArray(rec.owner?.names) && rec.owner.names.length ? rec.owner.names : null, U, retrieved_at),
      owner_type: c(rec.owner?.type, U, retrieved_at),
      owner_mailing_address: c(rec.owner?.mailingAddress?.formattedAddress, U, retrieved_at),
      owner_occupied: c(typeof rec.ownerOccupied === 'boolean' ? rec.ownerOccupied : null, U, retrieved_at),
      assessed_value: c(assessment?.value, U, retrieved_at, { basis: assessment ? `Tax assessment ${assessment.year}` : null }),
      annual_property_tax: c(tax?.total, U, retrieved_at, { basis: tax ? `Property tax ${tax.year}` : null }),
      hoa_monthly_fee: c(rec.hoa?.fee, U, retrieved_at),
    },
    sale_history: sales,
  };
}

async function valueEstimate(address, { compCount = 10 } = {}) {
  const { data, retrieved_at, cached } = await get('/avm/value', { address, compCount: Math.min(Math.max(5, compCount), 25) });
  if (!data || data.price == null) return { found: false, retrieved_at, cached };
  const E = STATUS.ESTIMATED;
  const comps = (data.comparables || []).map(x => ({
    address: x.formattedAddress, price: x.price ?? null, price_type: 'listed',
    listing_status: x.status || null, listed_date: x.listedDate || null, removed_date: x.removedDate || null,
    days_on_market: x.daysOnMarket ?? null, days_old: x.daysOld ?? null,
    sqft: x.squareFootage ?? null, bedrooms: x.bedrooms ?? null, bathrooms: x.bathrooms ?? null, year_built: x.yearBuilt ?? null,
    property_type: x.propertyType || null, distance_miles: x.distance ?? null, correlation: x.correlation ?? null,
    source: SOURCE, source_record_id: x.id || null, retrieved_at,
  }));
  return {
    found: true, cached, retrieved_at,
    value: c(data.price, E, retrieved_at, { basis: 'RentCast automated valuation (AVM), current condition' }),
    value_low: c(data.priceRangeLow, E, retrieved_at),
    value_high: c(data.priceRangeHigh, E, retrieved_at),
    comparables: comps,
    note: 'AVM comparables are sale listings, not closed sales; listing prices can differ from final sale prices.',
  };
}

async function rentEstimate(address, { compCount = 10 } = {}) {
  const { data, retrieved_at, cached } = await get('/avm/rent/long-term', { address, compCount: Math.min(Math.max(5, compCount), 25) });
  if (!data || data.rent == null) return { found: false, retrieved_at, cached };
  const E = STATUS.ESTIMATED;
  return {
    found: true, cached, retrieved_at,
    rent: c(data.rent, E, retrieved_at, { basis: 'RentCast long-term rent AVM' }),
    rent_low: c(data.rentRangeLow, E, retrieved_at),
    rent_high: c(data.rentRangeHigh, E, retrieved_at),
    comparables: (data.comparables || []).map(x => ({ address: x.formattedAddress, rent: x.price ?? null, listing_status: x.status || null, distance_miles: x.distance ?? null, correlation: x.correlation ?? null, bedrooms: x.bedrooms ?? null, sqft: x.squareFootage ?? null })),
  };
}

async function marketStatistics(zipCode) {
  if (!/^\d{5}$/.test(String(zipCode || ''))) return { found: false, reason: 'A 5-digit zip code is required' };
  const { data, retrieved_at, cached } = await get('/markets', { zipCode: String(zipCode), dataType: 'All', historyRange: 12 });
  if (!data) return { found: false, retrieved_at, cached };
  const s = data.saleData || {};
  const r = data.rentalData || {};
  const E = STATUS.UNVERIFIED; // aggregate of listings observed by the provider
  return {
    found: true, cached, retrieved_at, zip: String(zipCode),
    metrics: {
      median_list_price: c(s.medianPrice, E, retrieved_at, { basis: 'Median price of sale listings in the zip' }),
      median_price_per_sqft: c(s.medianPricePerSquareFoot, E, retrieved_at),
      median_days_on_market: c(s.medianDaysOnMarket, E, retrieved_at),
      total_sale_listings: c(s.totalListings, E, retrieved_at),
      new_sale_listings: c(s.newListings, E, retrieved_at),
      median_rent: c(r.medianRent, E, retrieved_at, { basis: 'Median rent of rental listings in the zip' }),
      total_rental_listings: c(r.totalListings, E, retrieved_at),
    },
    history: { sale: s.history || null, rental: r.history || null },
  };
}

module.exports = {
  id: 'rentcast', name: 'RentCast', provider_type: TIER, env: ['RENTCAST_API_KEY'],
  capabilities: ['property_record', 'value_estimate', 'rent_estimate', 'market_statistics'],
  terms: 'Licensed API access; data used within the RentCast API terms. No scraping.',
  isConfigured, propertyRecord, valueEstimate, rentEstimate, marketStatistics,
  _setHttp: (h) => { http = h; cache.clear(); },
};
