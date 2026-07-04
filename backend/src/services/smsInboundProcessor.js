/**
 * SMS Inbound Processor - the SMS_INBOUND queue worker's per-job unit of work.
 *
 * At blast scale a 1M-message campaign can generate a flood of replies all landing
 * on POST /api/sms/webhook at once. Each reply needs a GPT-4o-mini scoreReply
 * (~seconds) and possibly a Vapi escalation - doing that synchronously in the
 * webhook request melts the event loop and risks Twilio webhook timeouts.
 *
 * So the webhook keeps the fast, compliance-critical work INLINE (signature check,
 * STOP/START opt-out, inbound message logging) and hands the slow AI work to this
 * processor via SMS_INBOUND. This is a faithful lift of the scoring/branching block
 * that used to live in sms.js (scoreReply → call_now | continue_sms | follow_up),
 * unchanged in behavior - just moved off the request path.
 *
 * Idempotency: the webhook has already logged the inbound row. Before doing any
 * scoring/acting this processor ATOMICALLY claims that row - flipping its status
 * 'received' → 'scored' keyed on the provider message id. If the claim updates 0
 * rows the work was already done (a BullMQ retry after a Vapi/SMS blip, or a
 * webhook re-delivery that slipped the jobId dedup) and we skip - so a single
 * reply never escalates to two calls or two "let me call you" texts.
 */

const supabase = require('../config/supabase');
const {
  scoreReply, continueConversation, sendReply, escalateToCall,
} = require('./smsService');
const { getSellerContextForSMS, getDealContext, buildDealContextBlock } = require('./dataMotService');

/**
 * Run reply scoring + the resulting action for one inbound SMS.
 * @param {object} data
 * @param {string} data.leadId
 * @param {string} data.userId
 * @param {string} data.from   sender E.164 (the lead's number)
 * @param {string} data.body   inbound message text
 */
async function processInboundSMS(data) {
  const { leadId, userId, from, body, inboundMsgId } = data || {};
  if (!leadId || !from || !body || !supabase) return { skipped: true };

  // ── Idempotency claim ──────────────────────────────────────────────────────
  // Atomically move THIS inbound row from 'received' → 'scored'. Only the first
  // run wins the row; a retry / re-delivery updates 0 rows and bails before it
  // can score + escalate a second time. Keyed on the provider message id when we
  // have one; we never act twice on the same physical inbound message.
  if (inboundMsgId) {
    const { data: claimed } = await supabase
      .from('sms_messages')
      .update({ status: 'scored' })
      .eq('telnyx_message_id', inboundMsgId)
      .eq('direction', 'inbound')
      .eq('status', 'received')
      .select('id');
    if (!claimed || claimed.length === 0) {
      console.log(`[SMSInbound] ${inboundMsgId} already scored - skipping (retry/redelivery)`);
      return { skipped: 'already_scored' };
    }
  }

  // Re-load the lead (it may have changed since the webhook fired).
  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single();
  if (!lead) {
    console.log(`[SMSInbound] lead ${leadId} gone - skipping scoring`);
    return { skipped: 'no_lead' };
  }

  // ── Reply auto-stop ────────────────────────────────────────────────────────
  // The lead just replied, so the "no reply" assumption behind any already-queued
  // SMS follow-up is now false. Cancel still-pending SMS follow-ups for this lead
  // (the auto 48h/7-day rows from smsFirstWorkflow + the cold-lead row below) so a
  // lead who engaged is never re-touched as a non-responder. Idempotent: a no-op
  // once nothing is pending; never cancels a follow-up the operator already sent.
  await supabase
    .from('follow_ups')
    .update({ status: 'cancelled', notes: 'Auto-cancelled - lead replied via SMS.' })
    .eq('lead_id', leadId)
    .eq('type', 'sms')
    .eq('status', 'pending')
    .catch(() => {});

  // Conversation history (same shape the webhook built).
  const { data: history } = await supabase
    .from('sms_messages')
    .select('direction, body, sent_at')
    .eq('lead_id', leadId)
    .order('sent_at', { ascending: true })
    .limit(20);

  const formattedHistory = (history || []).map(m => ({ role: m.direction, body: m.body }));

  // A - unified memory: pull the SAME seller profile the voice brain builds so
  // the text reply is scored WITH the call history behind it. Non-blocking -
  // null (first touch / read fail) leaves scoring exactly as it was before.
  const sellerContext = await getSellerContextForSMS(leadId);

  // Deal-state awareness (same source the voice brain reads): if a deal is
  // already in flight, score/continue knowing it - don't treat an agreed seller
  // like a cold reply. Non-blocking - null / no deal → '' → behavior unchanged.
  let dealBlock = '';
  try {
    dealBlock = buildDealContextBlock(await getDealContext(leadId));
  } catch (_) { dealBlock = ''; }

  // Score the reply (the slow part we moved off the webhook).
  const scoring = await scoreReply(formattedHistory, body, sellerContext, dealBlock);
  const score = typeof scoring === 'number' ? scoring : scoring.score;
  const nextAction = scoring.next_action ||
    (score >= 60 ? 'call_now' : score >= 40 ? 'continue_sms' : 'follow_up_7_days');

  console.log(`[SMSInbound] Score: ${score} - action: ${nextAction}`);

  await supabase.from('leads').update({ motivation_score: score }).eq('id', leadId).then(null, () => {});

  if (nextAction === 'call_now' || score >= 60) {
    // Hot lead - heads-up text then escalate to a Vapi call.
    await sendReply(from, `Thanks for getting back to me! Let me give you a quick call right now to discuss further.`, userId, leadId);
    await escalateToCall(lead, userId);

  } else if (nextAction === 'continue_sms' || (score >= 40 && score < 60)) {
    // Warm lead - continue the SMS conversation (with seller memory in context).
    const reply = await continueConversation(lead, body, formattedHistory, sellerContext, dealBlock);
    if (reply) await sendReply(from, reply, userId, leadId);

  } else {
    // Cold lead - schedule a 7-day follow-up.
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
    }).then(null, () => {});
    console.log(`[SMSInbound] Cold lead - follow-up scheduled for ${followUpDate.toDateString()}`);
  }

  return { scored: score, action: nextAction };
}

module.exports = { processInboundSMS };
