// ─────────────────────────────────────────────────────────────────────────────
// emailSuppression - Feature C: per-operator email opt-out / do-not-email list.
//
// WHY: CAN-SPAM requires a working unsubscribe. Veori already SENDS email (Resend
// via emailService.js) but had no suppression. This is the single source of truth
// for "is this address opted out for this operator?" plus the writers that add to
// the list and mint one-click unsubscribe tokens.
//
// SAFETY / ZERO-REGRESSION:
//   • Pure data helpers. Reads/writes only the NEW email_suppressions /
//     email_optout_tokens tables - never touches leads, email_log, or sequences.
//   • Every function fails OPEN-SAFE: if the table is missing or Supabase errors,
//     isEmailSuppressed returns false (send proceeds) so existing email keeps
//     working even before the migration is run. Suppression only ever ADDS a gate.
// ─────────────────────────────────────────────────────────────────────────────

const crypto   = require('crypto');
const supabase = require('../config/supabase');

// Resolve the public base URL for one-click unsubscribe links. Single source of
// truth so the drip AND the buyer blast build identical links. Railway injects
// RAILWAY_PUBLIC_DOMAIN; PUBLIC_API_BASE overrides. Returns '' if neither set.
function publicApiBase() {
  return (
    process.env.PUBLIC_API_BASE ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '') ||
    ''
  );
}

// Mint a token AND return the full unsubscribe URL in one step. Returns null if
// no public base is configured OR the token couldn't be minted, so callers can
// decide whether to send. Used by every CAN-SPAM send path.
async function buildUnsubscribeUrl({ userId, email, leadId = null }) {
  const base = publicApiBase();
  if (!base) return null;
  const token = await mintOptOutToken({ userId, email, leadId });
  if (!token) return null;
  return `${base}/api/email/unsubscribe/${token}`;
}

// Is (userId, email) on the operator's do-not-email list?
// Returns false on any error so the migration being unrun never blocks sends.
async function isEmailSuppressed(userId, email) {
  if (!supabase || !userId || !email) return false;
  try {
    const { data, error } = await supabase
      .from('email_suppressions')
      .select('id')
      .eq('user_id', userId)
      .ilike('email', String(email).trim())
      .limit(1)
      .maybeSingle();
    if (error) return false;
    return !!data;
  } catch (_e) {
    return false;
  }
}

// Add an address to the operator's suppression list (idempotent via UNIQUE).
async function suppressEmail({ userId, email, leadId = null, reason = 'unsubscribe' }) {
  if (!supabase || !userId || !email) return { success: false, error: 'missing fields' };
  try {
    const { error } = await supabase
      .from('email_suppressions')
      .upsert(
        { user_id: userId, email: String(email).trim(), lead_id: leadId, reason },
        { onConflict: 'user_id,email' }
      );
    if (error) throw error;
    return { success: true };
  } catch (e) {
    console.error('[emailSuppression] suppress error:', e.message);
    return { success: false, error: e.message };
  }
}

// Mint (or reuse) a one-click unsubscribe token for an address. The token is
// embedded in the unsubscribe link inside every drip email.
async function mintOptOutToken({ userId, email, leadId = null }) {
  if (!supabase || !userId || !email) return null;
  try {
    const token = crypto.randomBytes(24).toString('hex');
    const { error } = await supabase
      .from('email_optout_tokens')
      .insert({ token, user_id: userId, email: String(email).trim(), lead_id: leadId });
    if (error) throw error;
    return token;
  } catch (e) {
    console.error('[emailSuppression] mint token error:', e.message);
    return null;
  }
}

// Resolve a token → its record (for the public unsubscribe route).
async function resolveOptOutToken(token) {
  if (!supabase || !token) return null;
  try {
    const { data, error } = await supabase
      .from('email_optout_tokens')
      .select('token, user_id, lead_id, email, used_at')
      .eq('token', token)
      .maybeSingle();
    if (error) return null;
    return data || null;
  } catch (_e) {
    return null;
  }
}

// Mark a token used (after a successful unsubscribe). Best-effort.
async function markTokenUsed(token) {
  if (!supabase || !token) return;
  try {
    await supabase
      .from('email_optout_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('token', token);
  } catch (_e) { /* best-effort */ }
}

// Auto-suppress on a deliverability event (hard bounce / spam complaint).
// Called by the Resend webhook. Mirrors suppressEmail but stamps the precise
// reason so list hygiene + complaint-rate (must stay <0.3%) are protected.
// Fail-safe: any error is swallowed; a missing migration never crashes the hook.
async function autoSuppressOnEvent({ userId, email, leadId = null, reason }) {
  if (!supabase || !userId || !email) return { success: false };
  const allowed = new Set(['bounce', 'complaint']);
  const r = allowed.has(reason) ? reason : 'bounce';
  try {
    const { error } = await supabase
      .from('email_suppressions')
      .upsert(
        { user_id: userId, email: String(email).trim(), lead_id: leadId, reason: r },
        { onConflict: 'user_id,email' }
      );
    if (error) throw error;
    return { success: true };
  } catch (e) {
    console.error('[emailSuppression] auto-suppress error:', e.message);
    return { success: false, error: e.message };
  }
}

module.exports = {
  isEmailSuppressed,
  suppressEmail,
  mintOptOutToken,
  resolveOptOutToken,
  markTokenUsed,
  autoSuppressOnEvent,
  publicApiBase,
  buildUnsubscribeUrl,
};
