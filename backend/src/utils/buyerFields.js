// ─── Buyer input validation + normalization ──────────────────────────────────
// One place that turns API/CSV input into a buyers row, so add, edit and import
// store identical shapes. Phones are stored in E.164 (+1XXXXXXXXXX): inbound
// texts arrive from Twilio in E.164 and a buyer's reply is matched by exact phone,
// so a phone saved as "(704) 555-0000" would never be recognised as that buyer.

const { toE164 } = require('./phone');

const STATE_RE = /^[A-Z]{2}$/;
const ZIP_RE = /^\d{5}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const REPAIR_TOLERANCE = ['any', 'light', 'medium', 'heavy'];

function splitList(v) {
  if (v == null || v === '') return [];
  const arr = Array.isArray(v) ? v : String(v).split(/[,;|]/);
  return arr.map(s => String(s).trim()).filter(Boolean);
}

function uniq(arr, keyFn = (x) => x) {
  const seen = new Set();
  return arr.filter(x => { const k = keyFn(x); if (seen.has(k)) return false; seen.add(k); return true; });
}

function toMoney(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

function toBool(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (['true', 'yes', 'y', '1'].includes(s)) return true;
  if (['false', 'no', 'n', '0'].includes(s)) return false;
  return NaN;
}

/**
 * @param {object} input
 * @param {object} [opts]
 * @param {boolean} [opts.partial=false]  edit: only fields present are validated/returned
 * @returns {{ row: object, errors: string[] }}
 */
function normalizeBuyer(input = {}, { partial = false } = {}) {
  const row = {};
  const errors = [];
  const has = (k) => Object.prototype.hasOwnProperty.call(input, k) && input[k] !== undefined;

  if (!partial || has('name')) {
    const name = String(input.name ?? '').trim();
    if (!name && !partial) errors.push('name is required');
    else if (name.length > 200) errors.push('name must be 200 characters or fewer');
    else if (name) row.name = name;
    else errors.push('name cannot be empty');
  }

  if (has('phone')) {
    const raw = String(input.phone ?? '').trim();
    if (!raw) row.phone = null;
    else {
      const e164 = toE164(raw);
      if (!e164) errors.push(`phone "${raw}" is not a valid US number`);
      else row.phone = e164;
    }
  }

  if (has('email')) {
    const email = String(input.email ?? '').trim().toLowerCase();
    if (!email) row.email = null;
    else if (email.length > 254 || !EMAIL_RE.test(email)) errors.push(`email "${email}" is not valid`);
    else row.email = email;
  }

  if (has('buyer_type')) row.buyer_type = String(input.buyer_type ?? '').trim().slice(0, 100) || null;

  if (has('buy_box_states')) {
    const states = uniq(splitList(input.buy_box_states).map(s => s.toUpperCase()));
    const bad = states.filter(s => !STATE_RE.test(s));
    if (bad.length) errors.push(`states must be 2-letter codes (got ${bad.join(', ')})`);
    else row.buy_box_states = states;
  }

  if (has('buy_box_types')) row.buy_box_types = uniq(splitList(input.buy_box_types).map(s => s.toLowerCase().slice(0, 50)));

  if (has('property_cities')) {
    row.property_cities = uniq(splitList(input.property_cities).map(s => s.slice(0, 100)), s => s.toLowerCase());
  }

  if (has('buy_box_zips')) {
    const zips = uniq(splitList(input.buy_box_zips).map(z => z.slice(0, 5)));
    const bad = zips.filter(z => !ZIP_RE.test(z));
    if (bad.length) errors.push(`zip codes must be 5 digits (got ${bad.join(', ')})`);
    else row.buy_box_zips = zips;
  }

  for (const k of ['max_price', 'min_price']) {
    if (!has(k)) continue;
    const n = toMoney(input[k]);
    if (Number.isNaN(n) || (n != null && n < 0)) errors.push(`${k} must be a positive number`);
    else row[k] = n;
  }
  if (row.min_price != null && row.max_price != null && row.min_price > row.max_price) {
    errors.push('min_price cannot be greater than max_price');
  }

  if (has('repair_tolerance')) {
    const r = String(input.repair_tolerance ?? '').trim().toLowerCase() || 'any';
    if (!REPAIR_TOLERANCE.includes(r)) errors.push(`repair_tolerance must be one of ${REPAIR_TOLERANCE.join(', ')}`);
    else row.repair_tolerance = r;
  }

  if (has('notes')) row.notes = String(input.notes ?? '').slice(0, 2000) || null;

  for (const k of ['is_active', 'cash_only', 'proof_of_funds', 'proof_of_funds_verified', 'nca_signed', 'is_tire_kicker', 'share_to_pool']) {
    if (!has(k)) continue;
    const b = toBool(input[k]);
    if (Number.isNaN(b)) errors.push(`${k} must be true or false`);
    else if (b === null && ['share_to_pool'].includes(k)) row[k] = false;
    else row[k] = b;
  }

  return { row, errors };
}

module.exports = { normalizeBuyer, splitList };
