/**
 * Missed Call Text-Back Service
 *
 * When a Vapi call ends with no_answer / voicemail / not_home:
 *   1. Looks up operator settings (enabled, delay, custom message)
 *   2. Waits for the configured delay (default 60 seconds)
 *   3. Sends an auto-SMS to the caller via Telnyx
 *   4. Logs the event to missed_calls table
 *   5. Creates/finds the lead and links the SMS to their conversation
 */

const axios   = require('axios');
const supabase = require('../config/supabase');

const TELNYX_KEY      = process.env.TELNYX_API_KEY;
const TELNYX_PROFILE  = process.env.TELNYX_MESSAGING_PROFILE_ID;
const SMS_FROM        = process.env.TELNYX_SMS_NUMBER || '+19197945843';

const MISSED_OUTCOMES = ['no_answer', 'not_home', 'voicemail'];

/**
 * Entry point — called from vapi.js handleCallEnded
 * callRec: the calls row from the database
 * lead: the leads row (may be null for unknown callers)
 */
async function handleMissedCall(callRec, lead) {
  if (!callRec?.user_id) return;

  const outcome = callRec.outcome || '';
  if (!MISSED_OUTCOMES.includes(outcome)) return;

  const callerPhone = callRec.phone_number || lead?.phone;
  if (!callerPhone) return;

  // Load operator settings
  const { data: operator } = await supabase
    .from('users')
    .select('missed_call_textback_enabled, missed_call_message, missed_call_delay_seconds, ai_caller_name, full_name, company_name')
    .eq('id', callRec.user_id)
    .single();

  if (!operator) return;
  if (operator.missed_call_textback_enabled === false) return;

  // Check DNC before scheduling
  const { data: dncCheck } = await supabase
    .from('dnc_records')
    .select('id')
    .eq('phone', callerPhone)
    .maybeSingle();

  if (dncCheck) {
    console.log(`[MissedCall] Blocked — ${callerPhone} is on DNC`);
    return;
  }

  const delaySeconds = typeof operator.missed_call_delay_seconds === 'number'
    ? Math.max(0, Math.min(300, operator.missed_call_delay_seconds)) // clamp 0–300s
    : 60;

  const operatorName = operator.ai_caller_name || operator.full_name || 'the team';

  const rawMessage = operator.missed_call_message
    || 'Hi, I just missed your call. I am interested in your property and would love to connect. What is the best time to reach you?';

  // Replace [Operator Name] placeholder if present
  const smsBody = rawMessage.replace(/\[Operator Name\]/gi, operatorName);

  // Schedule with the configured delay
  setTimeout(async () => {
    try {
      await sendMissedCallSMS(callRec, lead, callerPhone, smsBody, operatorName);
    } catch (err) {
      console.error('[MissedCall] SMS send failed:', err.message);
    }
  }, delaySeconds * 1000);

  console.log(`[MissedCall] Scheduled auto-SMS to ${callerPhone} in ${delaySeconds}s`);
}

async function sendMissedCallSMS(callRec, lead, callerPhone, smsBody, operatorName) {
  if (!TELNYX_KEY) {
    console.warn('[MissedCall] TELNYX_API_KEY not set — cannot send SMS');
    return;
  }

  // Re-check DNC at send time (lead may have opted out since scheduling)
  const { data: dncRecheck } = await supabase
    .from('dnc_records')
    .select('id')
    .eq('phone', callerPhone)
    .maybeSingle();

  if (dncRecheck) {
    console.log(`[MissedCall] Blocked at send time — ${callerPhone} is on DNC`);
    return;
  }

  // Send via Telnyx
  let telnyxMessageId = null;
  try {
    const { data: resp } = await axios.post(
      'https://api.telnyx.com/v2/messages',
      {
        from: SMS_FROM,
        to: callerPhone,
        text: smsBody,
        messaging_profile_id: TELNYX_PROFILE,
      },
      {
        headers: { Authorization: `Bearer ${TELNYX_KEY}`, 'Content-Type': 'application/json' },
        timeout: 12000,
      }
    );
    telnyxMessageId = resp?.data?.id;
    console.log(`[MissedCall] Auto-SMS sent to ${callerPhone} — msgId: ${telnyxMessageId}`);
  } catch (err) {
    console.error('[MissedCall] Telnyx send error:', err.response?.data || err.message);
    // Log failed attempt, do not rethrow
  }

  const now = new Date().toISOString();

  // Find or create lead record for unknown callers
  let leadId = lead?.id || callRec.lead_id || null;
  if (!leadId && callerPhone) {
    const { data: existingLead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', callerPhone)
      .eq('user_id', callRec.user_id)
      .maybeSingle();

    if (existingLead) {
      leadId = existingLead.id;
    } else {
      // Create a new lead for this unknown caller
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          user_id:    callRec.user_id,
          phone:      callerPhone,
          first_name: 'Unknown',
          last_name:  'Caller',
          status:     'new',
          source:     'inbound_missed_call',
          created_at: now,
        })
        .select('id')
        .single();

      if (newLead) leadId = newLead.id;
    }
  }

  // Log outbound SMS to sms_messages (links to inbox conversation)
  if (leadId) {
    await supabase.from('sms_messages').insert({
      user_id:           callRec.user_id,
      lead_id:           leadId,
      direction:         'outbound',
      from_number:       SMS_FROM,
      to_number:         callerPhone,
      body:              smsBody,
      telnyx_message_id: telnyxMessageId,
      status:            telnyxMessageId ? 'sent' : 'failed',
      sent_at:           now,
    }).catch(() => {});
  }

  // Log to missed_calls table
  await supabase.from('missed_calls').insert({
    operator_id:  callRec.user_id,
    lead_id:      leadId,
    caller_phone: callerPhone,
    called_at:    callRec.started_at || now,
    direction:    callRec.direction || 'outbound',
    outcome:      callRec.outcome,
    sms_sent:     !!telnyxMessageId,
    sms_sent_at:  telnyxMessageId ? now : null,
    sms_message:  smsBody,
    created_at:   now,
  }).catch(() => {});
}

module.exports = { handleMissedCall };
