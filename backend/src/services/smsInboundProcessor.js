/**
 * SMS Inbound Processor — the SMS_INBOUND queue worker's per-job unit of work.
 *
 * At blast scale a 1M-message campaign can generate a flood of replies all landing
 * on POST /api/sms/webhook at once. Each reply needs a GPT-4o-mini scoreReply
 * (~seconds) and possibly a Vapi escalation — doing that synchronously in the
 * webhook request melts the event loop and risks Twilio webhook timeouts.
 *
 * So the webhook keeps the fast, compliance-critical work INLINE (signature check,
 * STOP/START opt-out, inbound message logging) and hands the slow AI work to this
 * processor via SMS_INBOUND. This is a faithful lift of the scoring/branching block
 * that used to live in sms.js (scoreReply → call_now | continue_sms | follow_up),
 * unchanged in behavior — just moved off the request path.
 *
 * Idempotency: the webhook has already logged the inbound row, so this processor
 * only reads history + scores + acts. Re-running a job (BullMQ retry) re-scores and
 * re-acts; escalateToCall / sendReply are the same calls the webhook made before.
 */

const supabase = require('../config/supabase');
const {
  scoreReply, continueConversation, sendReply, escalateToCall,
} = require('./smsService');

/**
 * Run reply scoring + the resulting action for one inbound SMS.
 * @param {object} data
 * @param {string} data.leadId
 * @param {string} data.userId
 * @param {string} data.from   sender E.164 (the lead's number)
 * @param {string} data.body   inbound message text
 */
async function processInboundSMS(data) {
  const { leadId, userId, from, body } = data || {};
  if (!leadId || !from || !body || !supabase) return { skipped: true };

  // Re-load the lead (it may have changed since the webhook fired).
  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single();
  if (!lead) {
    console.log(`[SMSInbound] lead ${leadId} gone — skipping scoring`);
    return { skipped: 'no_lead' };
  }

  // Conversation history (same shape the webhook built).
  const { data: history } = await supabase
    .from('sms_messages')
    .select('direction, body, sent_at')
    .eq('lead_id', leadId)
    .order('sent_at', { ascending: true })
    .limit(20);

  const formattedHistory = (history || []).map(m => ({ role: m.direction, body: m.body }));

  // Score the reply (the slow part we moved off the webhook).
  const scoring = await scoreReply(formattedHistory, body);
  const score = typeof scoring === 'number' ? scoring : scoring.score;
  const nextAction = scoring.next_action ||
    (score >= 60 ? 'call_now' : score >= 40 ? 'continue_sms' : 'follow_up_7_days');

  console.log(`[SMSInbound] Score: ${score} — action: ${nextAction}`);

  await supabase.from('leads').update({ motivation_score: score }).eq('id', leadId).catch(() => {});

  if (nextAction === 'call_now' || score >= 60) {
    // Hot lead — heads-up text then escalate to a Vapi call.
    await sendReply(from, `Thanks for getting back to me! Let me give you a quick call right now to discuss further.`, userId, leadId);
    await escalateToCall(lead, userId);

  } else if (nextAction === 'continue_sms' || (score >= 40 && score < 60)) {
    // Warm lead — continue the SMS conversation.
    const reply = await continueConversation(lead, body, formattedHistory);
    if (reply) await sendReply(from, reply, userId, leadId);

  } else {
    // Cold lead — schedule a 7-day follow-up.
    const followUpDate = new Date();
    followUpDate.setDate(followUpDate.getDate() + 7);
    await supabase.from('follow_ups').insert({
      user_id:      userId,
      lead_id:      leadId,
      type:         'sms',
      scheduled_at: followUpDate.toISOString(),
      notes:        `Lead replied via SMS but scored low (${score}). Auto-scheduled 7-day follow-up.`,
      status:       'pending',
      created_at:   new Date().toISOString(),
    }).catch(() => {});
    console.log(`[SMSInbound] Cold lead — follow-up scheduled for ${followUpDate.toDateString()}`);
  }

  return { scored: score, action: nextAction };
}

module.exports = { processInboundSMS };
