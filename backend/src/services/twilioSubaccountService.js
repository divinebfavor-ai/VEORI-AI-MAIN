/**
 * Twilio subaccount provisioning
 *
 * On Solo-tier signup (and above) each customer gets their OWN Twilio subaccount via
 * the Subaccounts API. A subaccount is a fully isolated Twilio account (its own SID,
 * auth token, phone numbers, messaging, A2P registration and billing) nested under the
 * Veori master account - so one customer's numbers/usage can never touch another's.
 *
 * We create the subaccount, confirm Twilio returned a valid active SID, then store that
 * SID against the customer's user record. Starter accounts do NOT get a subaccount.
 *
 * This module stops at subaccount creation. A2P registration is a SEPARATE later step
 * and is intentionally not started here.
 */

const supabase = require('../config/supabase');

// Solo and above. Starter (and any trial/null plan) is intentionally excluded.
const SUBACCOUNT_TIERS = new Set(['solo', 'operator', 'scale', 'enterprise', 'custom']);

function isSubaccountTier(plan) {
  return SUBACCOUNT_TIERS.has(String(plan || '').toLowerCase());
}

// A Twilio account SID is "AC" + 32 hex chars. We validate the returned SID so we only
// ever store a real, well-formed subaccount id.
const SUBACCOUNT_SID_RE = /^AC[0-9a-fA-F]{32}$/;

// Build a Twilio client from the MASTER credentials. The master account is what creates
// and owns subaccounts.
function masterClient() {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error('Twilio master credentials not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)');
  return require('twilio')(sid, token);
}

/**
 * Ensure an isolated Twilio subaccount exists for this user, creating one if the plan
 * qualifies and none is stored yet. Idempotent: if a SID is already on the record it is
 * returned without creating a second subaccount.
 *
 * `clientFactory` is injectable purely so the Twilio API can be stubbed in tests.
 *
 * @returns {Promise<{created:boolean, sid?:string, status?:string, friendlyName?:string,
 *                     skipped?:boolean, reason?:string}>}
 */
async function ensureSubaccountForUser(userId, plan, { clientFactory = masterClient } = {}) {
  if (!userId) return { created: false, skipped: true, reason: 'no userId' };
  if (!isSubaccountTier(plan)) {
    return { created: false, skipped: true, reason: `plan '${plan}' is below Solo - no subaccount` };
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('id, email, twilio_subaccount_sid')
    .eq('id', userId)
    .single();
  if (error) throw error;
  if (!user) return { created: false, skipped: true, reason: 'user not found' };
  if (user.twilio_subaccount_sid) {
    return { created: false, skipped: true, reason: 'subaccount already exists', sid: user.twilio_subaccount_sid };
  }

  // One subaccount per customer. The friendly name embeds the user id so the subaccount
  // is traceable back to exactly one customer in the Twilio console.
  const friendlyName = `veori:${userId}`;
  const client = clientFactory();
  const sub = await client.api.v2010.accounts.create({ friendlyName });

  // Confirm creation succeeded: a real, well-formed SID that is active.
  if (!sub || !SUBACCOUNT_SID_RE.test(sub.sid || '')) {
    throw new Error(`Twilio did not return a valid subaccount SID (got: ${sub && sub.sid})`);
  }
  if (sub.status && sub.status !== 'active') {
    throw new Error(`Twilio subaccount created but status is '${sub.status}', expected 'active'`);
  }

  const { error: upErr } = await supabase
    .from('users')
    .update({
      twilio_subaccount_sid:           sub.sid,
      twilio_subaccount_status:        sub.status || 'active',
      twilio_subaccount_friendly_name: sub.friendlyName || friendlyName,
      twilio_subaccount_created_at:    new Date().toISOString(),
    })
    .eq('id', userId);
  if (upErr) throw upErr;

  return { created: true, sid: sub.sid, status: sub.status || 'active', friendlyName: sub.friendlyName || friendlyName };
}

module.exports = {
  SUBACCOUNT_TIERS,
  isSubaccountTier,
  masterClient,
  ensureSubaccountForUser,
};
