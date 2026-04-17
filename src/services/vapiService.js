// ─── Vapi Service — All Telephony & SMS ───────────────────────────────────────
// Vapi handles everything: calls, recording, transcription, and SMS.
// No Twilio. One vendor, one invoice, simpler setup.
const axios = require('axios');

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_BASE    = 'https://api.vapi.ai';

const vapiHttp = axios.create({
  baseURL: VAPI_BASE,
  headers: { Authorization: `Bearer ${VAPI_API_KEY}`, 'Content-Type': 'application/json' },
  timeout: 30000,
});

const WEBHOOK_URL = process.env.VAPI_WEBHOOK_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/vapi/webhook`
    : null);

const ALEX_SYSTEM_PROMPT = `You are Alex, a professional real estate investor with 10 years of wholesale experience.

PERSONALITY: Warm, direct, genuinely helpful. You listen more than you talk. Never scripted. Confident but never pushy. You treat sellers with genuine respect. Your goal is to find a solution that works for everyone.

CALL FLOW:
1. INTRODUCTION: "Hi, is this {first_name}? Great. My name is Alex — I'm a local real estate investor. I was reaching out about your property at {property_address} and wanted to see if you might be open to a quick conversation. Do you have just two or three minutes?"
2. DISCOVERY: Ask how long they've owned it, if occupied or vacant, what their plans are. Listen carefully. Let the seller talk.
3. OFFER: "Based on what you've described and looking at comparable sales in your area, I can offer you [OFFER_AMOUNT] cash. We'd close in as little as 14 days — no repairs, no agent fees, no showings. You pick the closing date."

OBJECTIONS:
- Too low: "Help me understand — what would make this work for you today?" [Listen] "The most I can do is [MAO]. That's my ceiling."
- Maybe: "Of course. Could I follow up [specific day]?"
- Not interested: "Completely respect that. Would it be alright if I checked back in a few months?"
- Have agent: "No problem — your agent earns full commission. We just move faster."
- Need repairs: "We buy as-is — you don't spend a single dollar fixing anything."`;

async function initiateCall({ lead, phoneNumber, callId }) {
  if (!VAPI_API_KEY) throw new Error('VAPI_API_KEY not configured');

  const vapiPhoneNumberId = phoneNumber?.vapi_phone_number_id || process.env.VAPI_PHONE_NUMBER_ID;
  if (!vapiPhoneNumberId) throw new Error('No Vapi phone number ID. Purchase numbers in Vapi dashboard and store vapi_phone_number_id.');

  const firstName = lead.first_name || 'there';
  const address   = lead.property_address || 'your property';
  const firstMessage = `Hi, is this ${firstName}? Great. My name is Alex — I'm a local real estate investor. I was reaching out about your property at ${address} and wanted to see if you might be open to a quick conversation. Do you have just two or three minutes?`;

  const { data } = await vapiHttp.post('/call/phone', {
    phoneNumberId: vapiPhoneNumberId,
    customer: { number: lead.phone, name: `${lead.first_name || ''} ${lead.last_name || ''}`.trim() },
    assistant: {
      transcriber: { provider: 'deepgram', model: 'nova-2', language: 'en-US' },
      model: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', systemPrompt: ALEX_SYSTEM_PROMPT.replace(/{first_name}/g, firstName).replace(/{property_address}/g, address), temperature: 0.7, maxTokens: 500 },
      voice: { provider: 'elevenlabs', voiceId: process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB', stability: 0.5, similarityBoost: 0.75 },
      firstMessage,
      recordingEnabled: true,
      silenceTimeoutSeconds: 30,
      maxDurationSeconds: 1800,
      metadata: { callId, leadId: lead.id, leadName: `${lead.first_name} ${lead.last_name}`, propertyAddress: lead.property_address },
    },
    ...(WEBHOOK_URL && { serverUrl: WEBHOOK_URL }),
  });
  return data;
}

async function initiateBuyerCall({ buyer, deal, phoneNumber, callId }) {
  if (!VAPI_API_KEY) throw new Error('VAPI_API_KEY not configured');
  const vapiPhoneNumberId = phoneNumber?.vapi_phone_number_id || process.env.VAPI_PHONE_NUMBER_ID;
  if (!vapiPhoneNumberId) throw new Error('No Vapi phone number ID');

  const askingPrice = (deal.buyer_price || deal.offer_price)?.toLocaleString();
  const systemPrompt = `You are Alex, a real estate wholesaler. Property: ${deal.property_address}, ${deal.property_city}, ${deal.property_state}. ARV: $${deal.arv?.toLocaleString()}, Asking: $${askingPrice}, Repairs: ~$${deal.repair_estimate?.toLocaleString()}. Pitch this deal. If interested, tell them you're sending details via text now.`;

  const { data } = await vapiHttp.post('/call/phone', {
    phoneNumberId: vapiPhoneNumberId,
    customer: { number: buyer.phone, name: buyer.name },
    assistant: {
      transcriber: { provider: 'deepgram', model: 'nova-2' },
      model: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', systemPrompt, maxTokens: 300 },
      voice: { provider: 'elevenlabs', voiceId: process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB' },
      firstMessage: `Hi ${buyer.name}, this is Alex. I have an off-market deal that fits your buy box. Quick minute?`,
      recordingEnabled: true, maxDurationSeconds: 600,
      metadata: { callId, buyerId: buyer.id, dealId: deal.id, type: 'buyer' },
    },
    ...(WEBHOOK_URL && { serverUrl: WEBHOOK_URL }),
  });
  return data;
}

// ─── Vapi Native SMS — no Twilio ──────────────────────────────────────────────
async function sendSMS({ to, message, vapiPhoneNumberId }) {
  if (!VAPI_API_KEY) throw new Error('VAPI_API_KEY not configured');
  const phoneNumId = vapiPhoneNumberId || process.env.VAPI_PHONE_NUMBER_ID;
  if (!phoneNumId) throw new Error('No Vapi phone number ID for SMS');
  const { data } = await vapiHttp.post('/message', { phoneNumberId: phoneNumId, to, message });
  return data;
}

async function sendContractSMS({ to, signingUrl, sellerName, propertyAddress, vapiPhoneNumberId }) {
  return sendSMS({ to, message: `Hi ${sellerName}, this is Alex. Your purchase agreement for ${propertyAddress} is ready to sign: ${signingUrl}`, vapiPhoneNumberId });
}

async function sendAppointmentSMS({ to, sellerName, dateTime, vapiPhoneNumberId }) {
  return sendSMS({ to, message: `Hi ${sellerName}, this is Alex confirming our call on ${dateTime}. Talk soon! Reply STOP to opt out.`, vapiPhoneNumberId });
}

async function sendBuyerDetailsSMS({ to, buyerName, deal, detailsUrl, vapiPhoneNumberId }) {
  return sendSMS({ to, message: `Hi ${buyerName} — Alex here. ${deal.property_address}: ARV $${deal.arv?.toLocaleString()}, Asking $${(deal.buyer_price || deal.offer_price)?.toLocaleString()}, ~$${deal.repair_estimate?.toLocaleString()} repairs. Details + assignment: ${detailsUrl}`, vapiPhoneNumberId });
}

// ─── Call Control ─────────────────────────────────────────────────────────────
async function getCall(vapiCallId) { const { data } = await vapiHttp.get(`/call/${vapiCallId}`); return data; }
async function endCall(vapiCallId) { const { data } = await vapiHttp.delete(`/call/${vapiCallId}`); return data; }
async function muteAssistant(vapiCallId) { return vapiHttp.patch(`/call/${vapiCallId}`, { assistant: { model: { maxTokens: 0 } } }).then(r => r.data).catch(() => ({ muted: true })); }
async function unmuteAssistant(vapiCallId) { return vapiHttp.patch(`/call/${vapiCallId}`, { assistant: { model: { maxTokens: 500 } } }).then(r => r.data).catch(() => ({ unmuted: true })); }
async function listActiveCalls() { const { data } = await vapiHttp.get('/call?status=in-progress&limit=20'); return data; }
async function listVapiPhoneNumbers() { const { data } = await vapiHttp.get('/phone-number'); return data; }

module.exports = { initiateCall, initiateBuyerCall, sendSMS, sendContractSMS, sendAppointmentSMS, sendBuyerDetailsSMS, getCall, endCall, muteAssistant, unmuteAssistant, listActiveCalls, listVapiPhoneNumbers };
