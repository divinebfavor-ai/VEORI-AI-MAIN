// ─── TCPA audit trail ─────────────────────────────────────────────────────────
// One writer for the tcpa_log table. This is the record you produce if a
// consumer complains or sues: it shows, per contact attempt, what the local time
// was, whether it fell inside the lawful window, and what the suppression check
// returned.
//
// WHY THIS EXISTS: the table has TWO generations of columns. The original
// (phone_number, called_at_utc, local_time, timezone, within_calling_hours,
// dnc_checked_at, dnc_result, attempt_number, consent_status) and a later,
// looser trio (phone, action, notes) added directly to the database.
//
// `phone_number` and `called_at_utc` are NOT NULL. Every SMS-path insert supplied
// only {phone, action, notes, created_at}, so each one violated the not-null
// constraint and failed - and each was wrapped in `.then(null, () => {})`, so the
// failure was swallowed. Result: an empty audit trail with no error anywhere.
//
// This writer always fills the required columns, mirrors the human-readable
// fields into the newer trio so both shapes stay populated, and logs (rather than
// silently discards) a write failure - a missing audit trail is worth knowing
// about, even though it must never break the send itself.

const supabase = require('../config/supabase');
const { tcpaLocalHour, tzForState } = require('./tcpaWindow');

/**
 * Record one contact attempt.
 *
 * @param {object}  p
 * @param {string}  p.userId       operator placing the contact
 * @param {object}  p.lead         lead row (needs phone, id, property_state)
 * @param {string} [p.callId]      calls.id when this was a voice attempt
 * @param {boolean} p.withinHours  did this land inside the lawful local window
 * @param {string} [p.dncResult]   'pass' | 'blocked' | 'unknown'
 * @param {string} [p.consent]     consent status recorded at attempt time
 * @param {string} [p.note]        human-readable reason/outcome
 * @param {string} [p.action]      short verb, e.g. 'sms_out' | 'call_out'
 */
async function logTcpa({
  userId, lead = {}, callId = null, withinHours, dncResult = 'unknown',
  consent = null, note = '', action = null,
}) {
  const nowIso = new Date().toISOString();
  const state  = lead.property_state || null;

  let localTime = null, tz = null;
  try {
    tz = tzForState(state);
    const hour = tcpaLocalHour(state);
    localTime = hour != null ? `${String(hour).padStart(2, '0')}:00 ${tz}` : null;
  } catch { /* never block a send because the timezone lookup threw */ }

  const row = {
    user_id: userId || null,
    lead_id: lead.id || null,
    call_id: callId,
    // Required (NOT NULL) - the two fields whose absence silently killed every
    // previous SMS-path write.
    phone_number: lead.phone || 'unknown',
    called_at_utc: nowIso,
    local_time: localTime,
    timezone: tz,
    within_calling_hours: withinHours === true,
    dnc_checked_at: nowIso,
    dnc_result: dncResult,
    consent_status: consent,
    created_at: nowIso,
    // Newer trio - kept in sync so either shape can be queried.
    phone: lead.phone || null,
    action: action,
    notes: note || null,
  };

  const { error } = await supabase.from('tcpa_log').insert(row);
  if (error) {
    // Loud, but non-fatal: compliance logging must never break delivery.
    console.error('[TCPA] audit write FAILED -', error.message, '| phone:', row.phone_number);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

module.exports = { logTcpa };
