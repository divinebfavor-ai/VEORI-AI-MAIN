// ─── Record a do-not-contact request ─────────────────────────────────────────
// One writer for opt-outs that arrive outside the SMS STOP keyword - today, a
// seller saying "stop calling me" / "take me off your list" on a live AI call.
// A verbal request is a revocation of consent under the TCPA, so it has to land
// in the same place every outbound gate reads: dnc_records (checked by
// complianceGate, smsBlastProcessor, sendOpeningSMS) and leads.is_on_dnc.
//
// Mirrors routes/sms.js handleOptOut: an explicit existence check (dnc_records
// has no unique constraint on phone), errors inspected rather than swallowed,
// and a tcpa_log entry for the audit trail. Never throws - a failed write is
// logged loudly as a compliance event but must not break the call teardown.

const supabase = require('../config/supabase');
const { logTcpa } = require('./tcpaLog');

/**
 * @param {object} p
 * @param {string} p.phone     number exactly as outbound gates compare it (lead.phone)
 * @param {string} [p.userId]  operator who owns the lead
 * @param {object} [p.lead]    lead row (id, phone, property_state)
 * @param {string} [p.callId]  calls.id when the request came on a call
 * @param {string} p.reason    human-readable reason stored on dnc_records
 * @param {string} p.source    short machine source, e.g. 'voice_request'
 * @returns {Promise<{ recorded: boolean, alreadyListed?: boolean, error?: string }>}
 */
async function recordDncRequest({ phone, userId = null, lead = null, callId = null, reason, source }) {
  if (!supabase || !phone) return { recorded: false, error: 'missing phone or database' };

  let result = { recorded: false };
  try {
    let q = supabase.from('dnc_records').select('id').eq('phone', phone).limit(1);
    q = userId ? q.eq('user_id', userId) : q.is('user_id', null);
    const { data: existing, error: readErr } = await q;
    if (readErr) throw new Error(readErr.message);

    if (existing && existing.length) {
      result = { recorded: true, alreadyListed: true };
    } else {
      const { error: insErr } = await supabase.from('dnc_records').insert({
        phone, user_id: userId || null, reason, source,
      });
      if (insErr) throw new Error(insErr.message);
      result = { recorded: true, alreadyListed: false };
    }
  } catch (e) {
    console.error(`[DNC][COMPLIANCE] FAILED to record ${source} opt-out for lead ${lead?.id || 'unknown'}:`, e.message);
    result = { recorded: false, error: e.message };
  }

  if (lead?.id) {
    await require('./sequenceEngine').stopSequencesForLead(lead.id, `do-not-contact request (${source})`);
    const { error: leadErr } = await supabase.from('leads')
      .update({ is_on_dnc: true, status: 'dnc', updated_at: new Date().toISOString() })
      .eq('id', lead.id);
    if (leadErr) console.error(`[DNC][COMPLIANCE] FAILED to flag lead ${lead.id} as DNC:`, leadErr.message);
  }

  await logTcpa({
    userId, lead: lead || { phone }, callId, withinHours: true, dncResult: 'blocked',
    consent: 'revoked', action: `${source}_opt_out`, note: reason,
  });

  return result;
}

module.exports = { recordDncRequest };
