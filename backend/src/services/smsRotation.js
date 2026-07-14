/**
 * SMS Number Rotation - spreads outbound blast SMS across an operator's senders
 * so high-volume outreach doesn't get carrier-filtered ("cut off") on a single
 * long-code, and so each number stays under its carrier-safe daily ceiling.
 *
 * Sender priority (mirrors smsService.sendSMS's 3-tier routing, but rotation-aware):
 *   1. operator's OWN A2P 10DLC Messaging Service (users.a2p_messaging_service_sid)
 *      - a registered service can sustain high throughput on its own, so when one
 *      exists we always use it (Twilio load-balances inside the service).
 *   2. else ROTATE across the operator's phone_numbers pool - SMS-enabled, active,
 *      not released, still under sms_daily_limit - least-recently-used first.
 *      Toll-free numbers ARE included (unlike the voice rotator).
 *
 * Returns a sender the worker passes straight to Twilio:
 *   { kind:'mgs',    value:<MGxxxx>,  numberId:null }
 *   { kind:'number', value:<E.164>,   numberId:<phone_numbers.id> }
 *   null  → no capacity right now (all numbers at their daily cap) → caller defers.
 *
 * recordSmsSent() bumps the chosen number's daily counter + LRU marker so the
 * next pick rotates onward. Daily counters are zeroed by the sms-daily-reset
 * repeatable job (queueService) - recordSmsSent also self-heals a stale counter
 * if the reset job hasn't run yet.
 *
 * Columns (see migrations/2026-06-17_sms_blast_engine.sql):
 *   phone_numbers: sms_enabled, sms_daily_limit, sms_sent_today,
 *                  sms_last_reset_date, sms_last_used_at
 *                  (+ existing: number, is_toll_free, is_active, released_at, user_id)
 */

const supabase = require('../config/supabase');

const ENV_MSG_SERVICE_SID = process.env.TWILIO_MESSAGING_SERVICE_SID || null;
const ENV_FROM            = process.env.TWILIO_PHONE_NUMBER || null;

/**
 * Pick the best eligible SMS sender for this operator.
 * @param {string} userId
 * @returns {Promise<{kind:'mgs'|'number', value:string, numberId:string|null}|null>}
 */
async function selectSmsNumber(userId) {
  // No operator context (system-level send) → fall back to env sender, unmetered.
  if (!userId || !supabase) {
    if (ENV_MSG_SERVICE_SID) return { kind: 'mgs', value: ENV_MSG_SERVICE_SID, numberId: null };
    if (ENV_FROM)            return { kind: 'number', value: ENV_FROM, numberId: null };
    return null;
  }

  // 1. Operator's own A2P Messaging Service - best, no rotation needed.
  try {
    const { data: op } = await supabase
      .from('users')
      .select('a2p_messaging_service_sid, a2p_registration_step')
      .eq('id', userId)
      .single();
    // Use the operator's OWN registered A2P service only once registration is APPROVED
    // (active). While A2P is pending/rejected we intentionally do NOT switch them onto
    // their own (billed) service - they stay on Veori's shared bundled sender below, and
    // Veori absorbs the Twilio cost until their brand is approved.
    if (op?.a2p_registration_step === 'active' && op?.a2p_messaging_service_sid) {
      return { kind: 'mgs', value: op.a2p_messaging_service_sid, numberId: null };
    }
  } catch (e) {
    console.warn(`[SMSRotation] operator lookup failed for ${userId}:`, e.message);
  }

  // 2. Rotate across the operator's number pool (LRU, under daily cap).
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  let candidates = [];
  try {
    const { data, error } = await supabase
      .from('phone_numbers')
      .select('id, number, is_toll_free, sms_verification_status, sms_daily_limit, sms_sent_today, sms_last_reset_date, sms_last_used_at')
      .eq('user_id', userId)
      .eq('sms_enabled', true)
      .eq('is_active', true)
      .is('released_at', null)
      .order('sms_last_used_at', { ascending: true, nullsFirst: true })
      .limit(50);
    if (error) throw error;
    candidates = data || [];
  } catch (e) {
    console.warn(`[SMSRotation] pool lookup failed for ${userId}:`, e.message);
    candidates = [];
  }

  // Pick the first candidate that still has daily headroom. A number whose
  // reset date is stale (before today) is treated as freshly reset → full cap.
  //
  // STAGE POLICY (pre-A2P): SMS only ever sends from a carrier-VERIFIED TOLL-FREE
  // number. Local numbers are CALLS-ONLY (bought on Twilio, imported into Vapi for
  // the voice dialer) and must NEVER be chosen as an SMS sender - carriers also
  // silently filter SMS from un-verified toll-free numbers. So the deliverable
  // SMS pool is strictly: is_toll_free === true AND sms_verification_status ===
  // 'verified'. (When A2P 10DLC is funded later, local SMS routes via the
  // operator's Messaging Service in smsService - tier 1 - not through this pool.)
  const deliverable = candidates.filter(c =>
    c.is_toll_free && c.sms_verification_status === 'verified');

  for (const c of deliverable) {
    const stale = !c.sms_last_reset_date || c.sms_last_reset_date < today;
    const usedToday = stale ? 0 : (c.sms_sent_today || 0);
    const limit = c.sms_daily_limit == null ? 1000 : c.sms_daily_limit;
    if (usedToday < limit && c.number) {
      return { kind: 'number', value: c.number, numberId: c.id };
    }
  }

  // Operator HAS deliverable numbers but they're all capped for today → defer.
  if (deliverable.length > 0) return null;

  // Operator has no provisioned numbers at all → fall back to env sender so the
  // un-provisioned account can still send (matches smsService's fallback chain).
  if (ENV_MSG_SERVICE_SID) return { kind: 'mgs', value: ENV_MSG_SERVICE_SID, numberId: null };
  if (ENV_FROM)            return { kind: 'number', value: ENV_FROM, numberId: null };
  return null;
}

/**
 * Record a successful send against a rotation number: bump its daily counter and
 * stamp the LRU marker. Self-heals a stale daily counter (resets to 1 if the
 * stored reset date is before today). Best-effort - never throws.
 * @param {string|null} numberId  phone_numbers.id (null for MGS / env senders)
 */
async function recordSmsSent(numberId) {
  if (!numberId || !supabase) return;
  const today = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();
  try {
    const { data: row } = await supabase
      .from('phone_numbers')
      .select('sms_sent_today, sms_last_reset_date')
      .eq('id', numberId)
      .single();
    if (!row) return;
    const stale = !row.sms_last_reset_date || row.sms_last_reset_date < today;
    const next = stale ? 1 : (row.sms_sent_today || 0) + 1;
    await supabase
      .from('phone_numbers')
      .update({
        sms_sent_today:      next,
        sms_last_reset_date: today,
        sms_last_used_at:    nowIso,
      })
      .eq('id', numberId);
  } catch (e) {
    console.warn(`[SMSRotation] recordSmsSent failed for ${numberId}:`, e.message);
  }
}

/**
 * Zero the daily SMS counters for any number whose reset date is before today.
 * Called by the sms-daily-reset repeatable job. Returns count touched.
 */
async function resetDailyCounters() {
  if (!supabase) return 0;
  const today = new Date().toISOString().slice(0, 10);
  try {
    const { data, error } = await supabase
      .from('phone_numbers')
      .update({ sms_sent_today: 0, sms_last_reset_date: today })
      .or(`sms_last_reset_date.is.null,sms_last_reset_date.lt.${today}`)
      .select('id');
    if (error) throw error;
    return (data || []).length;
  } catch (e) {
    console.warn('[SMSRotation] daily reset failed:', e.message);
    return 0;
  }
}

module.exports = { selectSmsNumber, recordSmsSent, resetDailyCounters };
