/**
 * Ringless Voicemail Drop Service
 *
 * Uses Vapi to send a pre-recorded voicemail without ringing the phone.
 * In production this integrates with:
 * - Slybroadcast (slybroadcast.com) — dedicated RVM service
 * - DropCowboy (dropcowboy.com)
 * - Straight To Voicemail via Vapi
 *
 * For now: creates a Vapi outbound call with max 1 retry,
 * voicemail detection enabled, and a pre-scripted message.
 */
const axios = require('axios');
const supabase = require('../config/supabase');

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_BASE    = process.env.VAPI_BASE_URL || 'https://api.vapi.ai';
const WEBHOOK_URL  = process.env.VAPI_WEBHOOK_URL
  || (process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/vapi/webhook`
    : 'https://your-backend.railway.app/api/vapi/webhook');

const vapiHttp = axios.create({
  baseURL: VAPI_BASE,
  headers: { Authorization: `Bearer ${VAPI_API_KEY}`, 'Content-Type': 'application/json' },
  timeout: 20000,
});

const VOICEMAIL_TEMPLATES = {
  first_contact: (aiName, firstName, companyName) =>
    `Hi ${firstName || 'there'}, this is ${aiName} calling from ${companyName}. I'm a local real estate investor and I was reaching out about your property. I'd love to make you a fair all-cash offer — no repairs needed, no agent fees. Give me a call back at your convenience. Looking forward to speaking with you. Have a great day.`,

  follow_up: (aiName, firstName, companyName) =>
    `Hi ${firstName || 'there'}, this is ${aiName} from ${companyName} again. I left a message recently about your property — I still have a strong cash offer ready and can close quickly on your timeline. No pressure at all, just wanted to follow up. Feel free to call me back when it's convenient.`,

  last_attempt: (aiName, firstName) =>
    `Hi ${firstName || 'there'}, this is ${aiName}. This will be my last message — I have a cash offer ready for your property and can close in as little as two weeks. If you're ever interested in a no-hassle, as-is cash sale, please do reach out. I wish you all the best.`,
};

/**
 * Drop a ringless voicemail to a lead
 * @param {object} lead — lead record from DB
 * @param {object} operator — user/operator profile
 * @param {string} templateKey — 'first_contact' | 'follow_up' | 'last_attempt'
 */
async function dropVoicemail({ lead, operator = {}, templateKey = 'first_contact', callId = null }) {
  if (!VAPI_API_KEY) {
    console.log(`[RVM] VAPI_API_KEY not set — simulating voicemail drop to ${lead.phone}`);
    return { simulated: true };
  }

  const aiName     = operator.ai_caller_name || 'Alex';
  const companyName= operator.company_name   || 'our real estate investment group';
  const voiceId    = operator.ai_voice_id    || process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB';

  const templateFn = VOICEMAIL_TEMPLATES[templateKey] || VOICEMAIL_TEMPLATES.first_contact;
  const vmMessage  = templateFn(aiName, lead.first_name, companyName);

  const payload = {
    type: 'outboundPhoneCall',
    customer: {
      number: lead.phone,
      name: `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Seller',
    },
    assistant: {
      name: aiName,
      transcriber: { provider: 'deepgram', model: 'nova-2' },
      model: {
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        systemPrompt: `You are leaving a voicemail. Read ONLY the voicemail script below exactly once, then end the call. Do not deviate from the script.

VOICEMAIL SCRIPT:
${vmMessage}`,
        maxTokens: 200,
        temperature: 0.1,
      },
      voice: { provider: 'elevenlabs', voiceId },
      firstMessage: vmMessage,
      firstMessageMode: 'assistant-speaks-first',
      recordingEnabled: true,
      // Voicemail detection: speak message, then hang up immediately after greeting
      voicemailDetection: {
        provider: 'twilio',
        voicemailDetectionTypes: ['machine_end_beep', 'machine_end_silence'],
        enabled: true,
        machineDetectionTimeout: 30,
      },
      silenceTimeoutSeconds: 5,
      maxDurationSeconds: 60, // Short — voicemail only
      metadata: { callId, leadId: lead.id, type: 'voicemail_drop', template: templateKey },
    },
    serverUrl: WEBHOOK_URL,
  };

  if (process.env.VAPI_PHONE_NUMBER_ID) {
    payload.phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
  }

  try {
    const { data } = await vapiHttp.post('/call/phone', payload);

    // Log the voicemail drop
    await supabase.from('calls').insert({
      user_id: operator.id,
      lead_id: lead.id,
      vapi_call_id: data.id,
      status: 'initiated',
      call_type: 'voicemail',
      started_at: new Date().toISOString(),
    }).catch(() => {});

    console.log(`[RVM] Voicemail drop initiated for ${lead.phone} — Vapi ID: ${data.id}`);
    return { success: true, vapi_call_id: data.id };
  } catch (err) {
    console.error('[RVM] Voicemail drop failed:', err.response?.data || err.message);
    throw err;
  }
}

/**
 * Bulk voicemail drop for a list of leads
 * Rate-limited: 1 per second to avoid Vapi rate limits
 */
async function bulkDrop({ leads, operator, templateKey = 'first_contact' }) {
  const results = [];
  for (const lead of leads) {
    if (!lead.phone || lead.is_on_dnc) {
      results.push({ lead_id: lead.id, skipped: true, reason: lead.is_on_dnc ? 'dnc' : 'no_phone' });
      continue;
    }
    try {
      const res = await dropVoicemail({ lead, operator, templateKey });
      results.push({ lead_id: lead.id, success: true, ...res });
    } catch (err) {
      results.push({ lead_id: lead.id, success: false, error: err.message });
    }
    // Rate limit: 1/second
    await new Promise(r => setTimeout(r, 1000));
  }
  return results;
}

module.exports = { dropVoicemail, bulkDrop, VOICEMAIL_TEMPLATES };
