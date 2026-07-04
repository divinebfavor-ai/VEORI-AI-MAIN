// ─── Contact Masking - circumvention protection (Feature 13 / Feature 10) ────
// The wholesaler's moat is the seller relationship. A buyer who sees the seller's
// real phone, email, or exact street address can go around the operator and close
// directly. This utility strips/obscures seller PII from any buyer-facing payload
// and redacts contact details out of free-text (notes, messages, descriptions).
//
// Pure functions, no DB, no external calls. Additive: callers opt in by running a
// payload through maskLeadForBuyer() / redactContactInfo() before it leaves the
// operator's trust boundary.

// Email, US/intl phone, and "street number + street" patterns.
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE_RE = /(\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const STREET_RE = /\b\d{1,6}\s+([A-Za-z0-9.'-]+\s){1,4}(st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|boulevard|ct|court|way|pl|place|ter|terrace|cir|circle|hwy|highway|pkwy|parkway)\b\.?/gi;

/**
 * Redact phones, emails, and street addresses from a free-text string so it can
 * be shown to a buyer without leaking how to reach the seller directly.
 */
function redactContactInfo(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(EMAIL_RE, '[contact hidden]')
    .replace(PHONE_RE, '[contact hidden]')
    .replace(STREET_RE, '[address hidden]');
}

/**
 * Mask a street address down to block-level. "1428 Maple Street" → "14XX Maple Street".
 * Keeps city/state/zip so a buyer can still assess the market, but not the exact door.
 */
function maskStreetAddress(address) {
  if (!address || typeof address !== 'string') return address;
  return address.replace(/^\s*(\d+)/, (m, num) => {
    if (num.length <= 1) return 'X';
    return num.slice(0, num.length - 2).padEnd(num.length, 'X');
  });
}

/**
 * Mask a phone number, keeping only the area code. "+14075551234" → "(407) ***-****".
 */
function maskPhone(phone) {
  if (!phone || typeof phone !== 'string') return null;
  const digits = phone.replace(/\D/g, '').slice(-10);
  if (digits.length < 10) return '***-****';
  return `(${digits.slice(0, 3)}) ***-****`;
}

/**
 * Mask an email, keeping the first character and domain. "jane.doe@gmail.com"
 * → "j***@gmail.com".
 */
function maskEmail(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return null;
  const [local, domain] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

/**
 * Produce a buyer-safe view of a lead/seller. Strips raw phone/email, blurs the
 * street address, and redacts any contact details that leaked into free text.
 * Returns a NEW object - never mutates the input. The operator's own record is
 * untouched; only what crosses to a buyer is masked.
 *
 * @param {object} lead
 * @param {object} [opts]
 * @param {boolean} [opts.includeMaskedContact=true] keep masked hints vs drop entirely
 */
function maskLeadForBuyer(lead, opts = {}) {
  if (!lead || typeof lead !== 'object') return lead;
  const { includeMaskedContact = true } = opts;

  const safe = { ...lead };

  // Remove the raw, directly-dialable / emailable fields.
  delete safe.phone;
  delete safe.email;
  delete safe.owner_phone;
  delete safe.owner_email;

  // Blur the exact street address but keep market location.
  if (safe.property_address) safe.property_address = maskStreetAddress(safe.property_address);
  if (safe.address)          safe.address          = maskStreetAddress(safe.address);

  // Redact any contact info that leaked into notes / description.
  if (safe.notes)       safe.notes       = redactContactInfo(safe.notes);
  if (safe.description) safe.description = redactContactInfo(safe.description);
  if (safe.seller_notes) safe.seller_notes = redactContactInfo(safe.seller_notes);

  // Drop owner name to first-name-only so the buyer can't look them up.
  if (safe.last_name) safe.last_name = `${String(safe.last_name).slice(0, 1)}.`;

  if (includeMaskedContact) {
    safe.masked_phone = maskPhone(lead.phone || lead.owner_phone);
    safe.masked_email = maskEmail(lead.email || lead.owner_email);
  }

  safe.contact_masked = true;
  return safe;
}

module.exports = {
  redactContactInfo,
  maskStreetAddress,
  maskPhone,
  maskEmail,
  maskLeadForBuyer,
};
