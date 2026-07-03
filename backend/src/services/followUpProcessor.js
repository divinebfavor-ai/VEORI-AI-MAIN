const supabase = require('../config/supabase');
const emailService = require('./emailService');
const { SEQUENCE_DEFINITIONS } = require('./sequenceEngine');
const { scheduleSequenceStep } = require('./queueService');

// ─── Process a follow-up job ──────────────────────────────────────────────────
async function processFollowUp({ followUpId, dealId, contactId, contactType, type, template }) {
  try {
    // Mark as in-progress
    await supabase.from('follow_ups').update({ status: 'sent' }).eq('id', followUpId);

    if (type === 'sms') {
      await sendFollowUpSms({ followUpId, contactId, contactType, template });
    } else if (type === 'email') {
      await sendFollowUpEmail({ followUpId, contactId, contactType, template });
    }

    await supabase.from('follow_ups').update({ status: 'completed' }).eq('id', followUpId);

    await logAiAction({
      dealId,
      contactId,
      actionType: `follow_up_${type}_sent`,
      messageSent: `Follow-up ${type} sent via scheduled job`,
      outcome: 'sent',
    });
  } catch (err) {
    console.error('[FollowUpProcessor] Error:', err.message);
    await supabase.from('follow_ups').update({ status: 'failed' }).eq('id', followUpId);
  }
}

// ─── Process a scheduled Vapi call ───────────────────────────────────────────
// Fires a real outbound AI call at the scheduled time (e.g. the "call me at 5"
// callback booked by routes/vapi.js). Mirrors the live dialer (routes/calls.js /
// campaignManager.js) EXACTLY: resolve operator → select a healthy local number →
// insert a calls row → initiateCall({ lead, phoneNumber, callId, operator }).
async function processScheduledCall({ followUpId, dealId, leadId, script }) {
  try {
    const vapiService   = require('./vapiService');
    const phoneRotation = require('./phoneRotation');
    const { v4: uuidv4 } = require('uuid');

    const { data: lead } = await supabase.from('leads').select('*').eq('id', leadId).single();
    if (!lead) throw new Error('Lead not found');

    // Who owns this callback? Prefer the follow_up's user_id, fall back to the lead's.
    const { data: fu } = await supabase.from('follow_ups').select('user_id').eq('id', followUpId).single();
    const userId = fu?.user_id || lead.user_id;
    if (!userId) throw new Error('No operator (user_id) for scheduled call');

    // Full operator row — carries AI persona (voice, tone, scripts, use case).
    const { data: operator } = await supabase.from('users').select('*').eq('id', userId).single();

    // Healthy local number, area-code matched to the lead where possible.
    const leadDigits   = String(lead.phone || '').replace(/\D/g, '');
    const leadAreaCode = leadDigits.length === 11 && leadDigits.startsWith('1')
      ? leadDigits.slice(1, 4)
      : (leadDigits.length === 10 ? leadDigits.slice(0, 3) : null);
    const phoneNum = await phoneRotation.selectBestNumber(userId, lead.property_state, [], leadAreaCode);
    if (!phoneNum) throw new Error('No healthy phone numbers available');

    // Call record — links the call to the CRM (webhook updates it on end).
    const callId = uuidv4();
    await supabase.from('calls').insert([{
      id: callId,
      user_id: userId,
      lead_id: lead.id,
      phone_number_id: phoneNum.id,
      status: 'initiated',
      started_at: new Date().toISOString(),
    }]);

    const callResult = await vapiService.initiateCall({
      lead,
      phoneNumber: phoneNum,
      callId,
      operator: operator || {},
      useCaseOverride: operator?.ai_use_case || null,
    });

    await supabase.from('follow_ups').update({
      status: 'completed',
      bullmq_job_id: null,
    }).eq('id', followUpId);

    await logAiAction({
      dealId,
      contactId: leadId,
      actionType: 'scheduled_call_initiated',
      messageSent: script?.substring(0, 200) || `Scheduled AI callback to ${lead.phone}`,
      outcome: callResult?.id ? 'call_started' : 'failed',
    });
  } catch (err) {
    console.error('[FollowUpProcessor] Scheduled call error:', err.message);
    await supabase.from('follow_ups').update({ status: 'failed' }).eq('id', followUpId);

    // SMS fallback 30 minutes later
    const { scheduleFollowUp } = require('./queueService');
    const runAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    await scheduleFollowUp({
      followUpId: `${followUpId}-sms-fallback`,
      dealId,
      contactId: leadId,
      contactType: 'seller',
      runAt,
      type: 'sms',
      template: 'missed_call_followup',
    });
  }
}

// ─── Safety-net sweep for due callbacks ───────────────────────────────────────
// The primary path for a "call me at 5" callback is a BullMQ delayed job. If
// REDIS_URL is missing / Redis is down / the box that enqueued restarts, that job
// never fires and the follow_ups row sits status='scheduled' forever. This sweep
// is the Redis-INDEPENDENT backstop: it runs on a plain setInterval from index.js
// and picks up ANY due voice callback within its interval, so the "call them back
// on time, no matter what" guarantee holds even with the queue fully offline.
//
// Double-dial safety: each due row is ATOMICALLY claimed (scheduled → processing,
// guarded by .eq('status','scheduled')) before dispatch. If BullMQ's worker and
// this sweep race for the same row, only one wins the claim; the loser's update
// affects 0 rows and it skips. processScheduledCall flips it to completed/failed.
async function pollDueCallbacks() {
  try {
    const nowIso = new Date().toISOString();

    // Only voice callbacks that are actually due. Small batch per tick keeps a
    // backlog from stampeding the dialer; the next tick drains the rest.
    const { data: due, error } = await supabase
      .from('follow_ups')
      .select('id, user_id, contact_id, next_follow_up_at')
      .eq('follow_up_type', 'call')
      .eq('status', 'scheduled')
      .lte('next_follow_up_at', nowIso)
      .order('next_follow_up_at', { ascending: true })
      .limit(25);

    if (error) { console.error('[CallbackSweep] query error:', error.message); return 0; }
    if (!due || due.length === 0) return 0;

    let fired = 0;
    for (const row of due) {
      // Atomic claim — only the caller that flips scheduled→processing proceeds.
      const { data: claimed, error: claimErr } = await supabase
        .from('follow_ups')
        .update({ status: 'processing' })
        .eq('id', row.id)
        .eq('status', 'scheduled')
        .select('id');

      if (claimErr) { console.error('[CallbackSweep] claim error:', claimErr.message); continue; }
      if (!claimed || claimed.length === 0) continue; // lost the race — someone else has it

      console.log(`[CallbackSweep] Firing overdue callback ${row.id} for lead ${row.contact_id} (due ${row.next_follow_up_at})`);
      // processScheduledCall re-reads the row + owns the completed/failed transition.
      await processScheduledCall({ followUpId: row.id, dealId: null, leadId: row.contact_id, script: null });
      fired++;
    }

    if (fired) console.log(`[CallbackSweep] Dispatched ${fired} overdue callback(s)`);
    return fired;
  } catch (err) {
    console.error('[CallbackSweep] Sweep error:', err.message);
    return 0;
  }
}

// ─── Process a sequence step ──────────────────────────────────────────────────
async function processSequenceStep({ sequenceId, stepIndex }) {
  const { data: seq } = await supabase
    .from('sequences')
    .select('*, leads(*), users(*)')
    .eq('id', sequenceId)
    .single();

  if (!seq || seq.status !== 'active') return;

  const definition = SEQUENCE_DEFINITIONS[seq.sequence_type];
  if (!definition) return;

  const step = definition[stepIndex];
  if (!step) {
    await supabase.from('sequences').update({ status: 'completed' }).eq('id', sequenceId);
    return;
  }

  const lead = seq.leads;
  const user = seq.users;
  const vars = {
    firstName: lead?.first_name || 'there',
    address: lead?.property_address || 'your property',
    aiName: user?.ai_caller_name || 'Alex',
    company: user?.company_name || 'Veori AI',
  };

  if (step.action === 'email' && lead?.email && step.template) {
    const templateFn = emailService.templates[step.template];
    if (templateFn) {
      const { subject, body } = templateFn({
        firstName: vars.firstName,
        address: vars.address,
        operatorName: vars.aiName,
        companyName: vars.company,
        offerAmount: lead?.offer_price,
        expiryDate: new Date(Date.now() + 14 * 86400000).toLocaleDateString(),
      });
      await emailService.sendEmail({
        userId: seq.user_id,
        leadId: seq.lead_id,
        to: lead.email,
        subject,
        body,
        emailType: step.template,
      });
    }
  } else if (step.action === 'sms' && lead?.phone) {
    const message = (step.message || '').replace(/{(\w+)}/g, (_, k) => vars[k] || k);
    await sendVapiSms(lead.phone, message);
    await logAiAction({
      contactId: lead.id,
      actionType: 'sms_sent',
      messageSent: message,
      outcome: 'sent',
    });
  } else if (step.action === 'call' && lead?.phone) {
    const vapiService = require('./vapiService');
    await vapiService.initiateCall({
      leadId: lead.id,
      phone: lead.phone,
      metadata: { sequenceId, stepIndex, type: 'sequence_call' },
    }).catch(err => console.error('[Sequence call error]', err.message));
  }

  // Advance to next step
  const nextIdx = stepIndex + 1;
  if (nextIdx >= definition.length) {
    await supabase.from('sequences').update({ status: 'completed', current_step: nextIdx }).eq('id', sequenceId);
  } else {
    const nextStep = definition[nextIdx];
    const nextAt = new Date();
    nextAt.setDate(nextAt.getDate() + ((nextStep.day || 0) - (step.day || 0)));
    await supabase.from('sequences').update({ current_step: nextIdx, next_action_at: nextAt.toISOString() }).eq('id', sequenceId);
    await scheduleSequenceStep({ sequenceId, stepIndex: nextIdx, runAt: nextAt.toISOString() });
  }
}

// ─── Send SMS via Vapi ────────────────────────────────────────────────────────
async function sendVapiSms(phone, message) {
  // Vapi is decommissioned — SMS now belongs to Twilio only. This legacy Vapi
  // sender stays inert unless VAPI_ENABLED=true is deliberately set, so a stale
  // VAPI_API_KEY on Railway can never spend the wallet on a sequence-step text.
  if (String(process.env.VAPI_ENABLED || '').toLowerCase() !== 'true') {
    console.warn('[SMS] Vapi decommissioned (VAPI_ENABLED!=true) — skipping legacy Vapi SMS; route sequence SMS through Twilio.');
    return;
  }
  try {
    const axios = require('axios');
    await axios.post('https://api.vapi.ai/message', {
      to: phone,
      message,
    }, {
      headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` },
    });
  } catch (err) {
    console.error('[SMS] Vapi SMS error:', err.response?.data || err.message);
  }
}

// ─── Log AI action ────────────────────────────────────────────────────────────
async function logAiAction({ dealId, contactId, actionType, messageSent, outcome }) {
  await supabase.from('ai_command_log').insert({
    deal_id: dealId || null,
    contact_id: contactId || null,
    action_type: actionType,
    message_sent: messageSent,
    outcome,
    created_at: new Date().toISOString(),
  }).then(null, () => {});
}

// ─── Send follow-up email ─────────────────────────────────────────────────────
async function sendFollowUpEmail({ contactId, contactType, template }) {
  const table = contactType === 'seller' ? 'sellers' : contactType === 'buyer' ? 'buyers' : 'leads';
  const { data: contact } = await supabase.from(table).select('*').eq(
    contactType === 'seller' ? 'seller_id' : contactType === 'buyer' ? 'buyer_id' : 'id',
    contactId
  ).single();
  if (!contact?.email) return;

  const templateFn = emailService.templates[template] || emailService.templates.noAnswerFollowUp;
  const { subject, body } = templateFn({
    firstName: contact.first_name || contact.name || 'there',
    address: contact.property_address || '',
    operatorName: 'Alex',
    companyName: 'Veori AI',
  });

  await emailService.sendEmail({ to: contact.email, subject, body, emailType: template });
}

// ─── Send follow-up SMS ───────────────────────────────────────────────────────
async function sendFollowUpSms({ contactId, contactType, template }) {
  const table = contactType === 'seller' ? 'sellers' : contactType === 'buyer' ? 'buyers' : 'leads';
  const { data: contact } = await supabase.from(table).select('*').eq(
    contactType === 'seller' ? 'seller_id' : contactType === 'buyer' ? 'buyer_id' : 'id',
    contactId
  ).single();
  if (!contact?.phone) return;

  const messages = {
    contract_unsigned: `Hi ${contact.first_name || 'there'}, your contract is ready. Please sign when you get a chance. Reply STOP to opt out.`,
    closing_reminder: `Closing is in 24 hours. Do you have any last-minute questions? This is an automated message from Veori AI.`,
    missed_call_followup: `Hi ${contact.first_name || 'there'}, we tried to reach you but missed you. We'll try again soon. This is an automated message from Veori AI.`,
    offer_followup: `Hi ${contact.first_name || 'there'}, just following up on the offer for your property. Any questions? This is Veori AI.`,
    default: `Hi ${contact.first_name || 'there'}, this is an automated message from Veori AI. Please reply if you have any questions.`,
  };

  const message = messages[template] || messages.default;
  await sendVapiSms(contact.phone, message);
}

module.exports = { processFollowUp, processScheduledCall, processSequenceStep, pollDueCallbacks };
