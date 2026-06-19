/**
 * SMS Blast Processor — the SMS_BLAST queue worker's per-job unit of work.
 *
 * One job == one outbound outreach SMS to one lead. The producer
 * (queueService.enqueueSMS, fed by smsFirstWorkflow.sendSMSBatch) has already
 * built the body; this processor owns the SEND-TIME guards and the send itself,
 * in this order:
 *
 *   1. DNC gate    — dnc_records lookup by phone (mirrors smsService.sendReply).
 *                    A DNC hit is a HARD STOP, not an error: we log to tcpa_log
 *                    and resolve cleanly (no retry, no dead-letter).
 *   2. Credit gate — outreachCredits.reserve(userId, 1). If the operator is out of
 *                    credits we THROW so BullMQ retries later (credits may refill
 *                    at cycle reset / top-up) rather than silently dropping the lead.
 *   3. Rotation    — smsRotation.selectSmsNumber(userId) picks a sender under its
 *                    carrier-safe daily cap (LRU). null == no capacity right now →
 *                    THROW to retry on a later attempt (defer, don't drop).
 *   4. Send        — smsService.sendSMSDirect({ senderOverride }) does the raw
 *                    Twilio send + logs to sms_messages. A null return (Twilio not
 *                    configured / empty args) THROWS so the job retries.
 *   5. Book-keep   — smsRotation.recordSmsSent(numberId) bumps the number's daily
 *                    counter + LRU marker, and the sms_first_leads row flips
 *                    queued → sms_sent so monitorReplies picks it up unchanged.
 *
 * Any thrown error bubbles to BullMQ → retries (3×, exp backoff) → on final
 * failure the queue's `failed` handler writes sms_dead_letter for manual replay.
 * DNC/credit/no-capacity are handled explicitly above so they never masquerade as
 * send failures in the dead-letter forensics.
 */

const supabase        = require('../config/supabase');
const smsRotation     = require('./smsRotation');
const outreachCredits = require('./outreachCredits');
const { sendSMSDirect } = require('./smsService');
const { isWithinTcpaWindow, msUntilNextWindow } = require('./tcpaWindow');

/**
 * @param {object} data            job payload from enqueueSMS
 * @param {string} data.leadId
 * @param {string} [data.campaignId]
 * @param {string} data.userId
 * @param {string} data.to         E.164 destination
 * @param {string} data.body       message body
 * @param {string} [data.smsFirstLeadId]  sms_first_leads.id to flip to sms_sent
 */
async function processBlastSMS(data) {
  const { leadId, campaignId, userId, to, body, smsFirstLeadId } = data || {};
  if (!to || !body) {
    // Malformed job — nothing to send. Resolve cleanly (a retry won't fix it).
    console.warn('[SMSBlast] skipping job with missing to/body', { leadId, campaignId });
    return { skipped: 'missing_to_or_body' };
  }

  // 1. DNC gate — hard stop, not an error (no retry, no dead-letter).
  if (supabase) {
    const { data: dncHit } = await supabase
      .from('dnc_records')
      .select('id')
      .eq('phone', to)
      .maybeSingle();
    if (dncHit) {
      await supabase.from('tcpa_log').insert({
        user_id:    userId || null,
        lead_id:    leadId || null,
        phone:      to,
        action:     'sms_blocked_dnc',
        notes:      'Blast SMS blocked — phone is on DNC list',
        created_at: new Date().toISOString(),
      }).catch(() => {});
      await markSmsFirstLead(smsFirstLeadId, { status: 'dnc_blocked' });
      console.warn(`[SMSBlast] ${to} on DNC — blocked`);
      return { skipped: 'dnc' };
    }
  }

  // 1.5 TCPA quiet-hours gate — federal 8 AM–9 PM rule in the LEAD's local time.
  // Off-hours messages are NOT dropped and NOT credit-charged: we re-enqueue the
  // same job with a BullMQ delay so it fires at the next 8 AM in the lead's state.
  // The lead's state drives the timezone; unknown state → Eastern (most
  // conservative). We look it up here because the job payload doesn't carry it.
  if (supabase && leadId) {
    let leadState = null;
    try {
      const { data: leadRow } = await supabase
        .from('leads')
        .select('property_state')
        .eq('id', leadId)
        .maybeSingle();
      leadState = leadRow?.property_state || null;
    } catch (e) {
      // State lookup failed — fall through to the Eastern default (still gated,
      // never fails OPEN: a null state is treated as Eastern by tcpaWindow).
      console.warn(`[SMSBlast] state lookup failed for lead ${leadId}:`, e.message);
    }

    if (!isWithinTcpaWindow(leadState)) {
      const delay = msUntilNextWindow(leadState);
      try {
        // Lazy-require to avoid a circular dependency (queueService → this file).
        const { enqueueSMS } = require('./queueService');
        // Unique jobId suffix per target send-day so the deferred re-enqueue isn't a
        // BullMQ no-op against this still-active job (same jobId == dedup == lost msg).
        const sendDay = new Date(Date.now() + delay).toISOString().slice(0, 10);
        await enqueueSMS({ leadId, campaignId, userId, to, body, smsFirstLeadId, delay, jobIdSuffix: `-qh-${sendDay}` });
        await supabase.from('tcpa_log').insert({
          user_id:    userId || null,
          lead_id:    leadId || null,
          phone:      to,
          action:     'sms_deferred_quiet_hours',
          notes:      `Outside 8 AM–9 PM local (${leadState || 'default/Eastern'}) — deferred ${(delay / 3600000).toFixed(2)}h to next window`,
          created_at: new Date().toISOString(),
        }).catch(() => {});
        await markSmsFirstLead(smsFirstLeadId, { status: 'deferred_quiet_hours' });
        console.log(`[SMSBlast] ${to} outside TCPA hours (${leadState || 'Eastern'}) — deferred ${(delay / 3600000).toFixed(2)}h`);
        return { skipped: 'quiet_hours', deferredMs: delay };
      } catch (e) {
        // If re-enqueue fails (Redis down), DON'T send off-hours — throw so BullMQ
        // retries this same job later (fail-safe: never send outside the window).
        console.warn(`[SMSBlast] quiet-hours re-enqueue failed for ${to}:`, e.message);
        const err = new Error('quiet-hours defer failed (re-enqueue)');
        err.deferred = true;
        throw err;
      }
    }
  }

  // 2. Credit gate — defer (throw → retry) if exhausted; never silent-drop.
  const reservation = await outreachCredits.reserve(userId, 1);
  if (!reservation.allowed) {
    // Mark the row so the UI can show "waiting on credits", then throw to retry.
    await markSmsFirstLead(smsFirstLeadId, { status: 'deferred_no_credits' });
    const err = new Error(`outreach credits ${reservation.reason || 'exhausted'}`);
    err.deferred = true;
    throw err;
  }

  // 3. Rotation — pick a sender under its daily cap; null == defer.
  const sender = await smsRotation.selectSmsNumber(userId);
  if (!sender) {
    const err = new Error('no SMS sender capacity (all numbers capped)');
    err.deferred = true;
    throw err;
  }

  // 4. Send — raw Twilio + sms_messages log. null return == send failed → retry.
  const msgId = await sendSMSDirect({
    to,
    body,
    userId: userId || null,
    leadId: leadId || null,
    senderOverride: { kind: sender.kind, value: sender.value },
  });
  if (!msgId) throw new Error('sendSMSDirect returned null (Twilio send failed)');

  // 5. Book-keeping — bump the chosen number's daily counter + LRU, flip the row.
  await smsRotation.recordSmsSent(sender.numberId);
  await markSmsFirstLead(smsFirstLeadId, {
    status:      'sms_sent',
    sms_sent_at: new Date().toISOString(),
  });

  return { sent: true, msgId, sender: sender.kind };
}

/**
 * Best-effort update of the sms_first_leads row tied to this job. No-op when the
 * producer didn't create one (e.g. an ad-hoc enqueue). Never throws.
 */
async function markSmsFirstLead(id, patch) {
  if (!id || !supabase) return;
  try {
    await supabase.from('sms_first_leads').update(patch).eq('id', id);
  } catch (e) {
    console.warn(`[SMSBlast] sms_first_leads update failed for ${id}:`, e.message);
  }
}

module.exports = { processBlastSMS };
