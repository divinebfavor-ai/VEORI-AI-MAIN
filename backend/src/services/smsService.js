/**
 * SMS Service — Telnyx
 * Sends tag-matched opening texts to leads on import.
 * Scores replies via GPT-4o and auto-escalates hot leads (60+) to Vapi voice call.
 */

const axios = require('axios');
const supabase = require('../config/supabase');

const TELNYX_KEY      = process.env.TELNYX_API_KEY;
const TELNYX_PROFILE  = process.env.TELNYX_MESSAGING_PROFILE_ID;
const SMS_FROM        = process.env.TELNYX_SMS_NUMBER || '+19197945843';

const telnyxHttp = axios.create({
  baseURL: 'https://api.telnyx.com/v2',
  headers: { Authorization: `Bearer ${TELNYX_KEY}`, 'Content-Type': 'application/json' },
  timeout: 15000,
});

// ─── Tag-matched opening messages ────────────────────────────────────────────

const OPENING_MESSAGES = {
  pre_foreclosure: (name, address) =>
    `Hi ${name}, this is Alex. I saw you may be going through a tough time with your property at ${address}. I buy homes as-is for cash and can close fast — no stress, no repairs. Would you be open to a quick conversation?`,

  tax_delinquent: (name, address) =>
    `Hey ${name}, Alex here. I noticed your property at ${address} has some tax issues and wanted to reach out. I buy homes fast for cash and can help you walk away clean. Worth a quick chat?`,

  inherited: (name, address) =>
    `Hi ${name}, my name is Alex. I understand you recently inherited a property at ${address} and wanted to see if you'd be open to a cash offer. No repairs needed, we handle everything. Just wanted to reach out respectfully.`,

  vacant: (name, address) =>
    `Hi ${name}, this is Alex, a local investor. I came across your property at ${address} and wanted to make a cash offer. Quick and easy process — no repairs, no showings. Would you be interested?`,

  absentee_owner: (name, address) =>
    `Hi ${name}, Alex here — local real estate investor. I'm interested in your property at ${address}. If you'd ever consider selling, I can make a fair cash offer and close on your timeline. Open to hearing more?`,

  default: (name, address) =>
    `Hi ${name}, this is Alex, a local real estate investor. I'm reaching out about your property at ${address}. I buy homes for cash, as-is, and can close fast. Would you be open to a quick conversation?`,
};

function getOpeningMessage(lead) {
  const tag = (lead.primary_tag || '').toLowerCase().replace(/[^a-z_]/g, '_');
  const template = OPENING_MESSAGES[tag] || OPENING_MESSAGES.default;
  const name = lead.first_name || 'there';
  const address = lead.property_address || 'your property';
  return template(name, address);
}

// ─── Send opening SMS to a lead ───────────────────────────────────────────────

async function sendOpeningSMS(lead, userId) {
  if (!TELNYX_KEY) {
    console.warn('[SMS] TELNYX_API_KEY not set — skipping');
    return null;
  }

  const phone = lead.phone;
  if (!phone) return null;

  const body = getOpeningMessage(lead);

  try {
    const { data } = await telnyxHttp.post('/messages', {
      from: SMS_FROM,
      to: phone,
      text: body,
      messaging_profile_id: TELNYX_PROFILE,
    });

    const msgId = data?.data?.id;

    // Log in DB
    await supabase.from('sms_messages').insert({
      user_id:    userId,
      lead_id:    lead.id,
      direction:  'outbound',
      from_number: SMS_FROM,
      to_number:  phone,
      body,
      telnyx_message_id: msgId,
      status:     'sent',
      sent_at:    new Date().toISOString(),
    }).catch(() => {});

    console.log(`[SMS] Opening sent to ${phone} (lead: ${lead.id})`);
    return msgId;
  } catch (err) {
    console.error('[SMS] Send failed:', err.response?.data || err.message);
    return null;
  }
}

// ─── Score an inbound SMS reply via GPT-4o ───────────────────────────────────

async function scoreReply(conversationHistory, newMessage) {
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) return 50;

  try {
    const prompt = `You are an expert real estate acquisitions analyst. Score the seller's motivation to sell their property from 0 to 100 based on this SMS conversation.

0-40 = Not interested / hostile / just looking
40-60 = Warm / curious / might be open
60-100 = Hot / motivated / wants to sell soon

Previous messages:
${conversationHistory.map(m => `${m.role}: ${m.body}`).join('\n')}

New message from seller: "${newMessage}"

Reply with ONLY a JSON object: {"score": <0-100>, "reason": "<one sentence>", "next_action": "follow_up_7_days" | "continue_sms" | "call_now"}`;

    const res = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 100,
      response_format: { type: 'json_object' },
    }, {
      headers: { Authorization: `Bearer ${OPENAI_KEY}` },
      timeout: 10000,
    });

    const result = JSON.parse(res.data.choices[0].message.content);
    return result;
  } catch (e) {
    console.error('[SMS] Score error:', e.message);
    return { score: 50, reason: 'Unable to score', next_action: 'continue_sms' };
  }
}

// ─── Continue SMS conversation (score 40-60) ─────────────────────────────────

async function continueConversation(lead, sellerMessage, conversationHistory) {
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) return null;

  try {
    const res = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are Alex, a friendly local real estate investor texting a potential seller. Keep replies SHORT (1-2 sentences max), conversational, and focused on understanding their situation. Never pressure. Ask one question at a time. Goal: understand their timeline, motivation, and asking price.`
        },
        ...conversationHistory.map(m => ({ role: m.role === 'outbound' ? 'assistant' : 'user', content: m.body })),
        { role: 'user', content: sellerMessage }
      ],
      temperature: 0.7,
      max_tokens: 100,
    }, {
      headers: { Authorization: `Bearer ${OPENAI_KEY}` },
      timeout: 10000,
    });

    return res.data.choices[0].message.content.trim();
  } catch (e) {
    console.error('[SMS] Continue conversation error:', e.message);
    return null;
  }
}

// ─── Send a reply SMS ─────────────────────────────────────────────────────────

async function sendReply(toPhone, body, userId, leadId) {
  try {
    const { data } = await telnyxHttp.post('/messages', {
      from: SMS_FROM,
      to: toPhone,
      text: body,
      messaging_profile_id: TELNYX_PROFILE,
    });

    await supabase.from('sms_messages').insert({
      user_id:    userId,
      lead_id:    leadId,
      direction:  'outbound',
      from_number: SMS_FROM,
      to_number:  toPhone,
      body,
      telnyx_message_id: data?.data?.id,
      status:     'sent',
      sent_at:    new Date().toISOString(),
    }).catch(() => {});

    return data?.data?.id;
  } catch (err) {
    console.error('[SMS] Reply failed:', err.response?.data || err.message);
    return null;
  }
}

// ─── Escalate to Vapi voice call ──────────────────────────────────────────────

async function escalateToCall(lead, userId) {
  try {
    const vapiService = require('./vapiService');

    // Get operator phone number
    const { data: phoneNumbers } = await supabase
      .from('phone_numbers')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .eq('health_status', 'healthy')
      .limit(1);

    const phoneNumber = phoneNumbers?.[0];
    if (!phoneNumber) {
      console.warn('[SMS] No active phone number for escalation');
      return;
    }

    const { data: operator } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    // Create call record
    const { data: callRec } = await supabase.from('calls').insert({
      user_id:        userId,
      lead_id:        lead.id,
      phone_number:   lead.phone,
      phone_number_id: phoneNumber.id,
      status:         'queued',
      direction:      'outbound',
      triggered_by:   'sms_escalation',
      created_at:     new Date().toISOString(),
    }).select().single();

    await vapiService.initiateCall({
      lead,
      phoneNumber,
      callId: callRec.id,
      operator: operator || {},
    });

    console.log(`[SMS] Escalated to call — lead ${lead.id} scored hot`);
  } catch (err) {
    console.error('[SMS] Escalation failed:', err.message);
  }
}

module.exports = { sendOpeningSMS, scoreReply, continueConversation, sendReply, escalateToCall };
