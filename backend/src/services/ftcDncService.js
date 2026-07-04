// ─── FTC National Do Not Call Registry scrub ─────────────────────────────────
// Checks a phone number against the federal DNC registry before calling.
//
// SETUP REQUIRED (operator action - not code):
//   1. Register your Subscription Account Number (SAN) at telemarketing.donotcall.gov
//   2. Add these to your backend env:
//        FTC_DNC_API_KEY   - your DNC registry API key / SAN token
//        FTC_DNC_API_URL   - (optional) override the lookup endpoint
//
// Until configured, this fails OPEN: it returns { checked: false } so calls are
// never blocked before you've signed up. Once the key is set, it returns
// { checked: true, onList: boolean }. The caller treats onList as a WARNING,
// not a hard block (flip to a block later when you're ready).

const axios = require('axios');

const FTC_DNC_API_KEY = process.env.FTC_DNC_API_KEY;
const FTC_DNC_API_URL = process.env.FTC_DNC_API_URL || 'https://api.donotcall.gov/v1/lookup';

// Normalize to 10-digit US number (strip +1, spaces, dashes, parens)
function toTenDigits(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits.length === 10 ? digits : null;
}

/**
 * @param {string} phone
 * @returns {Promise<{ checked: boolean, onList?: boolean, reason?: string }>}
 */
async function isOnFederalDnc(phone) {
  // Not configured yet → fail open, never block
  if (!FTC_DNC_API_KEY) {
    return { checked: false, reason: 'FTC DNC not configured (FTC_DNC_API_KEY missing)' };
  }

  const tenDigit = toTenDigits(phone);
  if (!tenDigit) {
    return { checked: false, reason: 'Invalid phone number for DNC lookup' };
  }

  try {
    const { data } = await axios.get(FTC_DNC_API_URL, {
      params: { phone: tenDigit },
      headers: { Authorization: `Bearer ${FTC_DNC_API_KEY}` },
      timeout: 8000,
    });
    // Expected response shape: { on_registry: true|false } - adjust to your provider
    const onList = data?.on_registry === true || data?.onList === true || data?.registered === true;
    return { checked: true, onList };
  } catch (e) {
    // On lookup failure, fail open and let the call proceed (logged by caller)
    return { checked: false, reason: `FTC DNC lookup failed: ${e.message}` };
  }
}

module.exports = { isOnFederalDnc, toTenDigits };
