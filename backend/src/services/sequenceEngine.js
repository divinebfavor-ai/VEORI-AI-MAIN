const supabase = require('../config/supabase');
const emailService = require('./emailService');

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
    { day: 180, action: 'sms',    message: 'Hi {firstName}, this is {aiName}. Hope all is well! We are always buying in your area — if you know anyone looking for a quick cash sale, we would love the referral.' },
  ],
};

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
  } else if (step.action === 'sms') {
    // SMS sending - would use Vapi SMS API
    const message = step.message
      ? step.message.replace(/{(\w+)}/g, (_, k) => vars[k] || k)
      : '';
    console.log(`[SMS] To ${lead?.phone}: ${message}`);
    // TODO: integrate with Vapi SMS API
  } else if (step.action === 'call') {
    console.log(`[SEQUENCE CALL] Lead ${seq.lead_id} - step ${seq.current_step}`);
    // TODO: trigger automated call via campaign manager
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

module.exports = { enrollLeadInSequence, processReadySequences, SEQUENCE_DEFINITIONS };
