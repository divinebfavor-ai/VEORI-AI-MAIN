// US phone normalization. Twilio delivers inbound texts and caller IDs in E.164,
// so anything we look up by phone must be stored the same way.

/**
 * Strict US E.164. Returns '+1XXXXXXXXXX', or null when the input is not a
 * 10-digit US number (optionally prefixed with 1). Area codes and exchanges
 * cannot start with 0 or 1 under the North American Numbering Plan.
 */
function toE164(input) {
  if (input == null) return null;
  let digits = String(input).replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1);
  if (digits.length !== 10) return null;
  if (/^[01]/.test(digits) || /^[01]/.test(digits.slice(3))) return null;
  return `+1${digits}`;
}

module.exports = { toE164 };
