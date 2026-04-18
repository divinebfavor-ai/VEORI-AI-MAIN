const axios = require('axios');

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_BASE    = process.env.VAPI_BASE_URL || 'https://api.vapi.ai';
const WEBHOOK_URL  = process.env.VAPI_WEBHOOK_URL || process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/vapi/webhook`
  : 'https://your-backend.railway.app/api/vapi/webhook';

const vapiHttp = axios.create({
  baseURL: VAPI_BASE,
  headers: { Authorization: `Bearer ${VAPI_API_KEY}`, 'Content-Type': 'application/json' },
  timeout: 30000,
});

const ALEX_SYSTEM_PROMPT = `You are Alex, a professional real estate investor with 10 years of wholesale experience.

PERSONALITY:
- Warm, direct, and genuinely helpful
- You listen more than you talk
- You never sound scripted — speak naturally
- Confident but never pushy
- You understand sellers are often in difficult situations and treat them with deep respect
- Your goal is to find a solution that works for everyone

CALL FLOW:
1. INTRODUCTION (first 30 seconds): "Hi, is this {first_name}? Great. My name is Alex — I'm a local real estate investor. I was reaching out about your property at {property_address} and wanted to see if you might be open to a quick conversation. Do you have just two or three minutes?"

2. DISCOVERY: Ask how long they've owned the property, if it's occupied or vacant, what their plans are. Listen carefully. Let the seller talk. Do not interrupt.

3. MOTIVATION ASSESSMENT: Listen for: financial pressure, time urgency, property problems, inheritance, divorce, landlord frustration, tax issues.

4. OFFER (when appropriate): "Based on what you've described and looking at comparable sales in your area, I'm in a position to make you a cash offer today. I can offer you [OFFER_AMOUNT] cash. We'd close in as little as 14 days — no repairs needed, no agent fees, no showings, no waiting. You pick the closing date. Does that work for your situation?"

OBJECTION RESPONSES:
- "Too low": "I completely understand. Help me understand — what would make this work for you today?" [Listen] "The most I could stretch to is [MAO]. That's my ceiling but it gets you closed fast with zero costs."
- "Maybe/thinking": "Of course, take your time. Could I follow up with you [specific day] to give you a chance to think it through?"
- "Not interested": "I completely respect that. If anything changes, please don't hesitate to reach out. Would it be alright if I checked back in a few months?"
- "Have an agent": "No problem — we work alongside agents all the time. Your agent would still earn their full commission."
- "Need repairs": "That's exactly why sellers come to buyers like us — we buy as-is so you don't spend a single dollar fixing anything."

CALL OUTCOMES to aim for: appointment set, offer made, callback scheduled, follow-up in 30 days.

Always be honest. Never make promises you can't keep. Build trust first, deals follow.`;

/**
 * Initiate a Vapi outbound call
 */
async function initiateCall({ lead, phoneNumber, callId }) {
  if (!VAPI_API_KEY) throw new Error('VAPI_API_KEY not configured');

  const firstMessage = `Hi, is this ${lead.first_name}? Great. My name is Alex — I'm a local real estate investor. I was reaching out about your property at ${lead.property_address || 'your property'} and wanted to see if you might be open to a quick conversation. Do you have just two or three minutes?`;

  const systemPrompt = ALEX_SYSTEM_PROMPT
    .replace(/{first_name}/g, lead.first_name || 'there')
    .replace(/{property_address}/g, lead.property_address || 'your property');

  const payload = {
    type: 'outboundPhoneCall',
    phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
    customer: {
      number: lead.phone,
      name: `${lead.first_name || ''} ${lead.last_name || ''}`.trim(),
    },
    assistant: {
      transcriber: { provider: 'deepgram', model: 'nova-2', language: 'en-US' },
      model: {
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        systemPrompt,
        temperature: 0.7,
        maxTokens: 500,
      },
      voice: {
        provider: 'elevenlabs',
        voiceId: process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB',
        stability: 0.5,
        similarityBoost: 0.75,
      },
      firstMessage,
      recordingEnabled: true,
      silenceTimeoutSeconds: 30,
      maxDurationSeconds: 1800, // 30 min max
      metadata: {
        callId,
        leadId: lead.id,
        leadName: `${lead.first_name} ${lead.last_name}`,
        propertyAddress: lead.property_address,
        estimatedValue: lead.estimated_value,
        estimatedEquity: lead.estimated_equity,
      },
    },
    serverUrl: WEBHOOK_URL,
    serverUrlSecret: process.env.VAPI_WEBHOOK_SECRET,
  };

  // Use Twilio number if configured, otherwise let Vapi pick
  if (phoneNumber?.number && !process.env.VAPI_PHONE_NUMBER_ID) {
    payload.phoneNumber = { twilioPhoneNumber: phoneNumber.number };
  }

  const { data } = await vapiHttp.post('/call/phone', payload);
  return data;
}

/**
 * Get live call status
 */
async function getCall(vapiCallId) {
  const { data } = await vapiHttp.get(`/call/${vapiCallId}`);
  return data;
}

/**
 * End a call
 */
async function endCall(vapiCallId) {
  const { data } = await vapiHttp.delete(`/call/${vapiCallId}`);
  return data;
}

/**
 * Mute the AI assistant (operator takeover)
 */
async function muteAssistant(vapiCallId) {
  // Vapi supports real-time control via the call update endpoint
  const { data } = await vapiHttp.patch(`/call/${vapiCallId}`, {
    assistant: { model: { maxTokens: 0 } }, // Effectively silences AI
  }).catch(() => ({ data: { muted: true } }));
  return data;
}

/**
 * Unmute the AI assistant (return to AI)
 */
async function unmuteAssistant(vapiCallId) {
  const { data } = await vapiHttp.patch(`/call/${vapiCallId}`, {
    assistant: { model: { maxTokens: 500 } },
  }).catch(() => ({ data: { unmuted: true } }));
  return data;
}

/**
 * List all active calls
 */
async function listActiveCalls() {
  const { data } = await vapiHttp.get('/call?status=in-progress&limit=20');
  return data;
}

/**
 * Create a buyer outreach call with different script
 */
async function initiateBuyerCall({ buyer, deal, phoneNumber, callId }) {
  if (!VAPI_API_KEY) throw new Error('VAPI_API_KEY not configured');

  const buyerScript = `You are Alex, a real estate wholesaler. You are calling ${buyer.name} about an off-market property.

Property details:
- Address: ${deal.property_address}, ${deal.property_city}, ${deal.property_state}
- ARV: $${deal.arv?.toLocaleString()}
- Asking: $${deal.buyer_price?.toLocaleString() || deal.offer_price?.toLocaleString()}
- Repairs: ~$${deal.repair_estimate?.toLocaleString()}

Your pitch: "Hi ${buyer.name}, this is Alex. I have an off-market property that I think fits your buy box perfectly. It's in ${deal.property_city}, ${deal.property_state} — asking $${deal.buyer_price?.toLocaleString()}, ARV is around $${deal.arv?.toLocaleString()}, needs about $${deal.repair_estimate?.toLocaleString()} in work. Are you interested in taking a closer look?"

If interested: "Great — I'm sending you the details and assignment agreement right now via text. Let me know once you review and we can get moving fast."`;

  const payload = {
    type: 'outboundPhoneCall',
    customer: { number: buyer.phone, name: buyer.name },
    assistant: {
      transcriber: { provider: 'deepgram', model: 'nova-2' },
      model: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', systemPrompt: buyerScript, maxTokens: 300 },
      voice: { provider: 'elevenlabs', voiceId: process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB' },
      firstMessage: `Hi ${buyer.name}, this is Alex. I have an off-market property I think fits your buy box. Do you have a quick minute?`,
      recordingEnabled: true,
      maxDurationSeconds: 600,
      metadata: { callId, buyerId: buyer.id, dealId: deal.id, type: 'buyer' },
    },
    serverUrl: WEBHOOK_URL,
  };

  const { data } = await vapiHttp.post('/call/phone', payload);
  return data;
}

module.exports = { initiateCall, getCall, endCall, muteAssistant, unmuteAssistant, listActiveCalls, initiateBuyerCall };
