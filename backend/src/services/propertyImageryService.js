// ─────────────────────────────────────────────────────────────────────────────
// propertyImageryService - Feature A: derive aerial + street-view imagery for a
// lead's property from the address Veori already has on file.
//
// WHY: an operator sizing up a lead wants to SEE the house - roof, lot, curb
// condition - without leaving the lead page. Google's Static Maps API (satellite)
// and Street View Static API render a property from just its address. This service
// builds those image URLs; the front end renders them.
//
// SAFETY / ZERO-REGRESSION:
//   • Pure helper. No DB writes, no mutation of any lead. Reads nothing.
//   • If GOOGLE_MAPS_API_KEY is unset, EVERY function returns null - the imagery
//     section simply shows "unavailable" and nothing else in the app changes.
//   • Optional URL signing (GOOGLE_MAPS_SIGNING_SECRET) is supported for accounts
//     that require signed Static API requests; without it we send the plain key.
//   • This is the only NEW imagery code - seller MMS/upload photos already flow
//     through mmsCaptureService.js / photoUpload.js and are NOT touched here.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');

const STATIC_MAPS_BASE  = 'https://maps.googleapis.com/maps/api/staticmap';
const STREET_VIEW_BASE  = 'https://maps.googleapis.com/maps/api/streetview';

function apiKey() {
  return process.env.GOOGLE_MAPS_API_KEY || null;
}

// Compose a single-line address string from the lead's stored parts.
// Returns null when there's nothing usable to geocode.
function addressFromLead(lead = {}) {
  const parts = [
    lead.property_address,
    lead.property_city,
    lead.property_state,
    lead.property_zip,
  ].filter(Boolean).map((p) => String(p).trim()).filter((p) => p.length);
  if (!parts.length) return null;
  return parts.join(', ');
}

// Google's optional URL-signing: HMAC-SHA1 over the path+query using the
// base64url-decoded signing secret, then base64url-encoded. Best-effort - if the
// secret is malformed we just skip signing rather than break the URL.
function signUrl(urlString, secret) {
  if (!secret) return urlString;
  try {
    const url = new URL(urlString);
    const pathAndQuery = url.pathname + url.search;
    const safeSecret = secret.replace(/-/g, '+').replace(/_/g, '/');
    const key = Buffer.from(safeSecret, 'base64');
    const signature = crypto
      .createHmac('sha1', key)
      .update(pathAndQuery)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    return `${urlString}&signature=${signature}`;
  } catch (e) {
    return urlString; // unsigned fallback - never throw
  }
}

function withKeyAndSign(baseUrl, params) {
  const key = apiKey();
  if (!key) return null;
  const qs = new URLSearchParams({ ...params, key });
  const url = `${baseUrl}?${qs.toString()}`;
  return signUrl(url, process.env.GOOGLE_MAPS_SIGNING_SECRET || null);
}

/**
 * Satellite (aerial) image URL for a lead's property, or null if no key/address.
 * @param {object} lead
 * @param {object} [opts] { size, zoom }
 */
function satelliteUrl(lead = {}, opts = {}) {
  const address = addressFromLead(lead);
  if (!address) return null;
  return withKeyAndSign(STATIC_MAPS_BASE, {
    center: address,
    zoom: String(opts.zoom || 19),
    size: opts.size || '640x400',
    maptype: 'satellite',
    scale: '2',
  });
}

/**
 * Street View image URL for a lead's property, or null if no key/address.
 * @param {object} lead
 * @param {object} [opts] { size, fov }
 */
function streetViewUrl(lead = {}, opts = {}) {
  const address = addressFromLead(lead);
  if (!address) return null;
  return withKeyAndSign(STREET_VIEW_BASE, {
    location: address,
    size: opts.size || '640x400',
    fov: String(opts.fov || 80),
    return_error_code: 'true',
  });
}

/**
 * Both imagery URLs + the resolved address. Always returns an object; URL fields
 * are null when imagery can't be built (no key, or no address on the lead).
 * @param {object} lead
 */
function buildLeadImagery(lead = {}) {
  const address = addressFromLead(lead);
  return {
    address,
    available: Boolean(apiKey() && address),
    satellite_url: satelliteUrl(lead),
    street_view_url: streetViewUrl(lead),
  };
}

module.exports = {
  addressFromLead,
  satelliteUrl,
  streetViewUrl,
  buildLeadImagery,
};
