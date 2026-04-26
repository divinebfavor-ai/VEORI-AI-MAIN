const supabase = require('../config/supabase');
const emailService = require('./emailService');
const { SEQUENCE_DEFINITIONS } = require('./sequenceEngine');
const { scheduleSequenceStep } = require('./queueService');

// ─── Process a follow-up job ──────────────────────────────────────────────────
async function processFollowUp({ followUpId, dealId, contactId, contactType, type, template }) {
  try {
    // Mark as in-progress
    await supabase.from('follow_ups').update({ status: 'sent' }).eq('followup_id', followUpId);

    if (type === 'sms') {
      await sendFollowUpSms({ followUpId, contactId, contactType, template });
    } else if (type === 'email') {
      await sendFollowUpEmail({ followUpId, contactId, contactType, template });
    }

    await supabase.from('follow_ups').update({ status: 'completed' }).eq('followup_id', followUpId);

    await logAiAction({
      dealId,
      contactId,
      actionType: `follow_up_${type}_sent`,
      messageSent: `Follow-up ${type} sent via scheduled job`,
      outcome: 'sent',
    });
  } catch (err) {
    console.error('[FollowUpProcessor] Error:', err.message);
    await supabase.from('follow_ups').update({ status: 'failed' }).eq('followup_id', followUpId);
  }
}

// ─── Process a scheduled Vapi call ───────────────────────────────────────────
async function processScheduledCall({ followUpId, dealId, leadId, script }) {
  try {
    const vapiService = require('./vapiService');
    const { data: lead } = await supabase.from('leads').select('*').eq('id', leadId).single();
    if (!lead) throw new Error('Lead not found');

    const callResult = await vapiService.initiateCall({
      leadId,
      phone: lead.phone,
      systemPromptOverride: script,
      metadata: { dealId, followUpId, type: 'scheduled_follow_up' },
    });

    await supabase.from('follow_ups').update({
      status: 'completed',
      bullmq_job_id: null,
    }).eq('followup_id', followUpId);

    await logAiAction({
      dealId,
      contactId: leadId,
      actionType: 'scheduled_call_initiated',
      messageSent: script?.substring(0, 200),
      outcome: callResult?.id ? 'call_started' : 'failed',
    });
  } catch (err) {
    console.error('[FollowUpProcessor] Scheduled call error:', err.message);
    await supabase.from('follow_ups').update({ status: 'failed' }).eq('followup_id', followUpId);

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
  }).catch(() => {});
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

module.exports = { processFollowUp, processScheduledCall, processSequenceStep };
