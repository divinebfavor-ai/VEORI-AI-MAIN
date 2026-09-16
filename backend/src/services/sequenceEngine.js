const supabase = require('../config/supabase');
const emailService = require('./emailService');
const { sendSMSDirect, escalateToCall } = require('./smsService');
const { isWithinTcpaWindow, msUntilNextWindow } = require('./tcpaWindow');
const { mintOptOutToken } = require('./emailSuppression');
const { dropVoicemail } = require('./voicemailService');
const { spin } = require('./emailSpintax');           // Tier 2a - per-recipient variation
const { chooseSubject } = require('./emailSubjectAB'); // Tier 2b - A/B subject rotation

// Public API base for one-click unsubscribe links (Railway injects this in prod).
const PUBLIC_API_BASE =
  process.env.PUBLIC_API_BASE ||
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '') ||
  '';

const SEQUENCE_DEFINITIONS = {
  not_interested: [
    { day: 1,   action: 'email',  template: 'noAnswerFollowUp' },
    { day: 7,   action: 'sms',    message: 'Hi {firstName}, this is {aiName} from {company}. Just checking in about your property at {address}. Have things changed at all? Happy to chat whenever works for you.' },
    { day: 30,  action: 'call' },
    { day: 60,  action: 'email',  template: 'marketUpdate' },
    { day: 90,  action: 'call' },
    { day: 180, action: 'call' },
  ],
  callback_requested: [
    { day: 0,   action: 'call',   note: 'scheduled callback' },
    { day: 0,   action: 'sms',    message: 'Hi {firstName}, this is {aiName}. Just a reminder about our call today regarding {address}. Looking forward to speaking with you!' },
    { day: 1,   action: 'email',  template: 'callbackConfirmation' },
  ],
  offer_considering: [
    { day: 2,   action: 'call' },
    { day: 4,   action: 'email',  template: 'offerFollowUp' },
    { day: 7,   action: 'call' },
    { day: 14,  action: 'email',  template: 'offerExpired' },
  ],
  contract_sent: [
    { day: 1,   action: 'sms',    message: 'Hi {firstName}, just wanted to make sure you received the purchase agreement for {address}. Please let me know if you have any questions!' },
    { day: 3,   action: 'call' },
    { day: 7,   action: 'email',  template: 'contractSentReminder' },
  ],
  closed: [
    { day: 7,   action: 'email',  template: 'thankYou' },
    { day: 30,  action: 'sms',    message: 'Hi {firstName}, hope the move went smoothly! If you or anyone you know ever needs a quick cash offer, please think of us.' },
    { day: 90,  action: 'email',  template: 'marketUpdate' },
    { day: 180, action: 'sms',    message: 'Hi {firstName}, this is {aiName}. Hope all is well! We are always buying in your area - if you know anyone looking for a quick cash sale, we would love the referral.' },
  ],
  // Feature C - pure-email cold drip (3 touches). optOut:true → each send carries
  // a one-click unsubscribe link + CAN-SPAM footer. Email-only; no SMS/call steps.
  email_drip: [
    { day: 0,  action: 'email', template: 'coldDrip1', optOut: true },
    { day: 4,  action: 'email', template: 'coldDrip2', optOut: true },
    { day: 9,  action: 'email', template: 'coldDrip3', optOut: true },
  ],
  // Feature B - ringless voicemail nurture (3 touches). Each step delegates to
  // voicemailService.dropVoicemail (federal + internal DNC + phone-rotation gated)
  // and the rvm dispatch defers off-hours to stay inside the TCPA window.
  voicemail_touch: [
    { day: 0,  action: 'rvm', template: 'first_contact' },
    { day: 5,  action: 'rvm', template: 'follow_up' },
    { day: 12, action: 'rvm', template: 'last_attempt' },
  ],
  // Adaptive nurture - touches on day 3, 7, 14, 30, 60 and 90. A 'touch' step
  // picks its channel for THIS lead when it runs, in the listed order: a text only
  // with written consent on record, an email only with an address (with a one-click
  // unsubscribe), a call only when a phone exists. Any reply stops the sequence.
  nurture: [
    { day: 3,  action: 'touch', channels: ['sms', 'email', 'call'], template: 'coldDrip1', optOut: true,
      message: 'Hi {firstName}, this is {aiName} with {company}. Still open to an offer on {address}? No pressure either way.' },
    { day: 7,  action: 'touch', channels: ['call', 'sms', 'email'], template: 'noAnswerFollowUp', optOut: true,
      message: 'Hi {firstName}, {aiName} here. I tried to reach you about {address}. Is there a good time to talk?' },
    { day: 14, action: 'touch', channels: ['email', 'sms', 'call'], template: 'coldDrip2', optOut: true,
      message: 'Hi {firstName}, {aiName} with {company}. Checking in on {address} - has anything changed with your plans?' },
    { day: 30, action: 'touch', channels: ['sms', 'email', 'call'], template: 'marketUpdate', optOut: true,
      message: 'Hi {firstName}, {aiName} here. Prices around {address} have moved - happy to give you an updated cash number if useful.' },
    { day: 60, action: 'touch', channels: ['call', 'email', 'sms'], template: 'coldDrip3', optOut: true,
      message: 'Hi {firstName}, {aiName} with {company}. Still thinking about {address}? My offer stands whenever you are ready.' },
    { day: 90, action: 'touch', channels: ['email', 'sms', 'call'], template: 'marketUpdate', optOut: true,
      message: 'Hi {firstName}, {aiName} here - one last check-in about {address}. If the timing is ever right, just reply.' },
  ],
};
// Lead Engine enrolls auto-sourced leads under this name; it follows the nurture cadence.
SEQUENCE_DEFINITIONS.auto_sourced = SEQUENCE_DEFINITIONS.nurture;

/**
 * Pick the channel a step will actually use for this lead. Returns null when no
 * channel is allowed (the step is skipped and the sequence moves on).
 *   sms   - needs a phone AND written consent (automated marketing text, TCPA)
 *   email - needs an email address AND a template
 *   call  - needs a phone
 *   rvm   - needs a phone (voicemailService applies its own DNC gates)
 */
function resolveStepAction(step, lead) {
  if (!step || !lead) return null;
  const can = {
    sms:   !!lead.phone && lead.consent === true && !!step.message,
    email: !!lead.email && !!step.template,
    call:  !!lead.phone,
    rvm:   !!lead.phone,
  };
  if (step.action === 'touch') return (step.channels || []).find(ch => can[ch]) || null;
  if (step.action === 'sms') return can.sms ? 'sms' : (can.email ? 'email' : null);
  return can[step.action] ? step.action : null;
}

/** Stop every active sequence for a lead (reply received, opt-out, deal started). */
async function stopSequencesForLead(leadId, reason) {
  if (!supabase || !leadId) return 0;
  const { data, error } = await supabase.from('sequences')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('lead_id', leadId).eq('status', 'active')
    .select('id, user_id, sequence_type');
  if (error) {
    console.error(`[SEQUENCE] stop failed for lead ${leadId}:`, error.message);
    return 0;
  }
  if (data && data.length) {
    await require('./aiCommandLog').logAiCommand({
      userId: data[0].user_id, leadId, actionType: 'sequence_stopped', status: 'cancelled',
      summary: `Stopped ${data.map(d => d.sequence_type).join(', ')} - ${reason}`,
    });
  }
  return (data || []).length;
}

async function enrollLeadInSequence(userId, leadId, sequenceType) {
  const definition = SEQUENCE_DEFINITIONS[sequenceType];
  if (!definition || definition.length === 0) return null;

  // Cancel any existing active sequences for this lead+type
  await supabase.from('sequences')
    .update({ status: 'cancelled' })
    .eq('lead_id', leadId)
    .eq('sequence_type', sequenceType)
    .eq('status', 'active');

  const firstStep = definition[0];
  const nextActionAt = new Date();
  nextActionAt.setDate(nextActionAt.getDate() + (firstStep.day || 0));

  const { data, error } = await supabase.from('sequences').insert({
    user_id: userId,
    lead_id: leadId,
    sequence_type: sequenceType,
    current_step: 0,
    next_action_at: nextActionAt.toISOString(),
    status: 'active',
    metadata: { definition: sequenceType },
  }).select().single();

  if (error) console.error('Sequence enroll error:', error);
  return data;
}

async function processReadySequences() {
  const { data: sequences, error } = await supabase
    .from('sequences')
    .select('*, leads(*), users(*)')
    .eq('status', 'active')
    .lte('next_action_at', new Date().toISOString())
    .limit(50);

  if (error || !sequences?.length) return;

  for (const seq of sequences) {
    try {
      await executeSequenceStep(seq);
    } catch (err) {
      console.error(`Sequence ${seq.id} step error:`, err.message);
    }
  }
}

async function executeSequenceStep(seq) {
  const definition = SEQUENCE_DEFINITIONS[seq.sequence_type];
  if (!definition) return;

  const step = definition[seq.current_step];
  if (!step) {
    await supabase.from('sequences').update({ status: 'completed' }).eq('id', seq.id);
    return;
  }

  const lead = seq.leads;
  const user = seq.users;

  // Claim this step: move next_action_at forward only if nobody else has. Two
  // overlapping scans (or a slow one) can't send the same step twice. Deferrals
  // below overwrite this lease with the real next time.
  const lease = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const { data: claimed, error: claimErr } = await supabase.from('sequences')
    .update({ next_action_at: lease, updated_at: new Date().toISOString() })
    .eq('id', seq.id).eq('status', 'active').eq('current_step', seq.current_step)
    .eq('next_action_at', seq.next_action_at)
    .select('id');
  if (claimErr || !claimed || claimed.length === 0) return;

  if (!lead || lead.is_on_dnc) {
    await supabase.from('sequences').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', seq.id);
    await require('./aiCommandLog').logAiCommand({
      userId: seq.user_id, leadId: seq.lead_id, actionType: 'sequence_stopped', status: 'cancelled',
      summary: `Stopped ${seq.sequence_type} - ${lead ? 'lead is on the do-not-contact list' : 'lead no longer exists'}`,
    });
    return;
  }

  const action = resolveStepAction(step, lead);
  const vars = {
    firstName: lead?.first_name || 'there',
    address: lead?.property_address || 'your property',
    aiName: user?.ai_caller_name || 'Alex',
    company: user?.company_name || 'Veori AI',
  };

  if (!action) {
    await require('./aiCommandLog').logAiCommand({
      userId: seq.user_id, leadId: seq.lead_id, actionType: 'sequence_step', status: 'skipped',
      summary: `${seq.sequence_type} step ${seq.current_step + 1}: no allowed channel (text needs consent, email needs an address)`,
    });
  } else if (action === 'email' && lead?.email && step.template) {
    const templateFn = emailService.templates[step.template];
    if (templateFn) {
      const rendered = templateFn({
        firstName: vars.firstName,
        address: vars.address,
        operatorName: vars.aiName,
        companyName: vars.company,
        callbackNumber: user?.phone || user?.callback_number || '',
        offerAmount: lead?.offer_price,
        expiryDate: new Date(Date.now() + 14 * 86400000).toLocaleDateString(),
      });

      // Tier 2a/2b - stable per-recipient seed so a lead's subject + body copy is
      // identical across retries/re-logs (no wording drift) yet differs lead-to-
      // lead (anti-fingerprinting). lead id preferred; email is the fallback.
      const seed = lead?.id || lead?.email || seq.lead_id || '';

      // 2b: pick an A/B subject variant. Falls back to the template's own subject
      // (variant 'A') for any template without a registered bank - zero change.
      const { subject: abSubject, variant } = chooseSubject(
        step.template, vars, seed, rendered.subject
      );

      // 2a: spin {a|b|c} groups in BOTH subject and body with that seed. Strings
      // without spintax groups pass through byte-for-byte unchanged.
      const subject = spin(abSubject, seed);
      const body = spin(rendered.body, seed);

      // Record which subject variant was used by suffixing emailType, so the
      // Tier 1 engagement columns (opened_at/open_count) already attribute opens
      // per variant in email_log - no extra column required.
      const emailType = variant && variant !== 'A'
        ? `${step.template}:${variant}`
        : step.template;

      // Feature C - for opt-out drips, mint a one-click unsubscribe link.
      let unsubscribeUrl;
      if (step.optOut && PUBLIC_API_BASE) {
        const token = await mintOptOutToken({
          userId: seq.user_id,
          email: lead.email,
          leadId: seq.lead_id,
        });
        if (token) unsubscribeUrl = `${PUBLIC_API_BASE}/api/email/unsubscribe/${token}`;
      }

      await emailService.sendEmail({
        userId: seq.user_id,
        leadId: seq.lead_id,
        to: lead.email,
        subject,
        body,
        emailType,
        unsubscribeUrl,
      });
    }
  } else if (action === 'sms') {
    const message = step.message
      ? step.message.replace(/{(\w+)}/g, (_, k) => vars[k] || k)
      : '';
    if (message && lead?.phone) {
      // DNC gate - hard stop. If the lead is on DNC, skip the SMS step entirely
      // (advance the sequence; do not retry). Mirrors smsBlastProcessor/sendReply.
      const { data: dncHit } = await supabase
        .from('dnc_records').select('id').eq('phone', lead.phone).maybeSingle();
      if (dncHit) {
        console.warn(`[SEQUENCE SMS] ${lead.phone} on DNC - skipping step`);
      } else if (!isWithinTcpaWindow(lead.property_state)) {
        // TCPA quiet-hours: NEVER send off-hours. Defer this step to the next 8 AM
        // local and return WITHOUT advancing, so it retries cleanly. Fail-safe.
        const delay = msUntilNextWindow(lead.property_state);
        const deferUntil = new Date(Date.now() + delay).toISOString();
        await supabase.from('sequences').update({
          next_action_at: deferUntil,
          updated_at: new Date().toISOString(),
        }).eq('id', seq.id);
        console.log(`[SEQUENCE SMS] deferred lead ${seq.lead_id} to ${deferUntil} (TCPA)`);
        return;
      } else {
        await sendSMSDirect({
          to: lead.phone, body: message, userId: seq.user_id, leadId: seq.lead_id,
        });
        console.log(`[SEQUENCE SMS] sent to lead ${seq.lead_id} (step ${seq.current_step})`);
      }
    }
  } else if (action === 'call') {
    // Calls follow the same local 8 AM-9 PM window as texts: defer, don't skip.
    if (!isWithinTcpaWindow(lead.property_state)) {
      const deferUntil = new Date(Date.now() + msUntilNextWindow(lead.property_state)).toISOString();
      await supabase.from('sequences').update({ next_action_at: deferUntil, updated_at: new Date().toISOString() }).eq('id', seq.id);
      console.log(`[SEQUENCE CALL] deferred lead ${seq.lead_id} to ${deferUntil} (TCPA)`);
      return;
    }
    // escalateToCall applies DNC gates, picks a healthy number and places the call.
    await escalateToCall(lead, seq.user_id);
  } else if (action === 'rvm') {
    // Ringless voicemail drop (Feature B). Delegates to voicemailService.dropVoicemail,
    // which owns the federal-DNC + internal-DNC + phone-rotation gates. Here we add the
    // SAME TCPA defer behavior the SMS branch uses, so an automated drip touch lands
    // in-window (8 AM–9 PM local) rather than being skipped. Fail-safe: never sends off-hours.
    if (lead?.phone) {
      if (!isWithinTcpaWindow(lead.property_state)) {
        const delay = msUntilNextWindow(lead.property_state);
        const deferUntil = new Date(Date.now() + delay).toISOString();
        await supabase.from('sequences').update({
          next_action_at: deferUntil,
          updated_at: new Date().toISOString(),
        }).eq('id', seq.id);
        console.log(`[SEQUENCE RVM] deferred lead ${seq.lead_id} to ${deferUntil} (TCPA)`);
        return; // do NOT advance - retry cleanly in-window
      }
      const templateKey = step.template || 'first_contact';
      await dropVoicemail({ lead, operator: user || {}, templateKey })
        .catch((e) => console.error(`[SEQUENCE RVM] drop failed for lead ${seq.lead_id}:`, e.message));
      console.log(`[SEQUENCE RVM] dropped to lead ${seq.lead_id} (step ${seq.current_step})`);
    }
  }

  if (action) {
    await require('./aiCommandLog').logAiCommand({
      userId: seq.user_id, leadId: seq.lead_id, actionType: 'sequence_step', status: 'done',
      summary: `${seq.sequence_type} step ${seq.current_step + 1} of ${definition.length}: ${action}`,
    });
  }

  // Advance to next step
  const nextStepIdx = seq.current_step + 1;
  if (nextStepIdx >= definition.length) {
    await supabase.from('sequences').update({ status: 'completed' }).eq('id', seq.id);
  } else {
    const nextStep = definition[nextStepIdx];
    const nextAt = new Date();
    nextAt.setDate(nextAt.getDate() + (nextStep.day - (step.day || 0)));
    await supabase.from('sequences').update({
      current_step: nextStepIdx,
      next_action_at: nextAt.toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', seq.id);
  }
}

module.exports = { enrollLeadInSequence, processReadySequences, executeSequenceStep, stopSequencesForLead, resolveStepAction, SEQUENCE_DEFINITIONS };
