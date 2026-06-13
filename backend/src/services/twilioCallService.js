/**
 * Twilio Call Service — outbound dial engine for the Twilio + ElevenLabs layer.
 *
 * This is the v2 replacement for vapiService.initiateCall(). It is built with the
 * IDENTICAL call signature so it can slot into the single swap point later
 * (Module 9) with zero changes to the 6 callers:
 *
 *     initiateCall({ lead, phoneNumber, callId, operator, useCaseOverride })  ->  { id }
 *
 * The returned `id` is the Twilio Call SID; the caller stores it in
 * calls.vapi_call_id exactly as before (column name unchanged — it's just the
 * provider call id now). Nothing here touches Vapi.
 *
 * MODULE 3 SCOPE (this file, right now): place the outbound call + status
 * callback only. The TwiML it points at is a minimal placeholder; the live
 * two-way audio (<Connect><Stream> ↔ STT ↔ Claude ↔ ElevenLabs) is added in
 * Modules 6-7 by filling in the /api/v2/voice/twiml + media-stream endpoints.
 *
 * Twilio creds are the SAME account that already powers SMS (smsService.js):
 *   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER.
 * No new Twilio credentials are introduced.
 */

const twilio = require('twilio');

const TWILIO_SID   = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const CALL_FROM_FALLBACK = process.env.TWILIO_PHONE_NUMBER;

// Public base URL for Twilio to reach our webhooks. Railway injects
// RAILWAY_PUBLIC_DOMAIN; an explicit override wins (mirrors vapiService L8-11).
const PUBLIC_BASE = process.env.PUBLIC_BASE_URL
  || (process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : null);

/** Lazy Twilio client — only when creds present (same pattern as smsService). */
function getClient() {
  if (!TWILIO_SID || !TWILIO_TOKEN) return null;
  return twilio(TWILIO_SID, TWILIO_TOKEN);
}

/**
 * Normalize a phone number to E.164 (+1XXXXXXXXXX).
 * Mirrors vapiService.toE164 (not exported there) so dial behavior is identical.
 */
function toE164(phone) {
  if (!phone) return phone;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`;
  return String(phone).startsWith('+') ? String(phone) : `+${digits}`;
}

/**
 * Resolve the operator's caller-ID number to dial FROM.
 * Priority: the operator's provisioned number passed in -> TWILIO_PHONE_NUMBER env.
 * (phoneNumber is the same object Vapi got: a row from phone_numbers.)
 */
function resolveFromNumber(phoneNumber) {
  if (phoneNumber?.number) return toE164(phoneNumber.number);
  if (CALL_FROM_FALLBACK) return toE164(CALL_FROM_FALLBACK);
  return null;
}

/**
 * Place an outbound call via Twilio.
 *
 * Signature is byte-for-byte compatible with vapiService.initiateCall so the
 * Module 9 swap is a one-line change. Returns { id: <Twilio Call SID>, provider }
 * so calls.js can keep doing `calls.update({ vapi_call_id: result.id })`.
 *
 * @param {object}  args
 * @param {object}  args.lead             lead row (phone, first_name, …)
 * @param {object}  args.phoneNumber      operator's phone_numbers row (caller ID)
 * @param {string}  args.callId           our calls.id UUID (threaded into webhooks)
 * @param {object}  [args.operator]       operator/users row (voice, name, scripts)
 * @param {string}  [args.useCaseOverride]
 * @returns {Promise<{ id: string, provider: string }>}
 */
async function initiateCall({ lead, phoneNumber, callId, operator = {}, useCaseOverride = null }) {
  const client = getClient();
  if (!client) {
    throw new Error('Twilio not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN missing)');
  }
  if (!PUBLIC_BASE) {
    throw new Error('PUBLIC_BASE_URL / RAILWAY_PUBLIC_DOMAIN not set — Twilio cannot reach the voice webhook');
  }

  const to = toE164(lead?.phone);
  if (!to) throw new Error('Lead has no phone number to dial');

  const from = resolveFromNumber(phoneNumber);
  if (!from) {
    throw new Error('No caller-ID number for this operator. Provision a number in Settings → Phone Numbers.');
  }

  // The voice webhook Twilio fetches when the callee answers. callId rides in the
  // query so the TwiML handler (Module 6-7) can load the right lead/operator and
  // start the Claude-driven media stream. useCaseOverride is passed through too.
  const twimlUrl = new URL(`${PUBLIC_BASE}/api/v2/voice/twiml`);
  twimlUrl.searchParams.set('callId', callId || '');
  if (useCaseOverride) twimlUrl.searchParams.set('useCase', useCaseOverride);

  // Per-call lifecycle callbacks (ringing/answered/completed) → updates calls row.
  const statusUrl = `${PUBLIC_BASE}/api/v2/voice/status`;

  const call = await client.calls.create({
    to,
    from,
    url: twimlUrl.toString(),                 // GET/POST → returns TwiML
    method: 'POST',
    statusCallback: statusUrl,
    statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    statusCallbackMethod: 'POST',
    // Twilio-native answering-machine detection. The result is delivered to the
    // status callback as AnsweredBy; Module 4 acts on it (voicemail drop).
    machineDetection: 'DetectMessageEnd',
    machineDetectionTimeout: 30,
    record: true,                             // recording handled/stored in Module 5
    recordingStatusCallback: `${PUBLIC_BASE}/api/v2/voice/recording`,
    recordingStatusCallbackMethod: 'POST',
    timeout: 30,
  });

  console.log(`[TwilioCall] Outbound dial sid=${call.sid} to=${to} from=${from} callId=${callId}`);
  return { id: call.sid, provider: 'twilio' };
}

/**
 * Fetch a call's current Twilio status (parity with vapiService.getCall).
 * @param {string} callSid
 */
async function getCall(callSid) {
  const client = getClient();
  if (!client) throw new Error('Twilio not configured');
  const call = await client.calls(callSid).fetch();
  return call;
}

/**
 * End an in-progress call (parity with vapiService.endCall).
 * @param {string} callSid
 */
async function endCall(callSid) {
  const client = getClient();
  if (!client) throw new Error('Twilio not configured');
  return client.calls(callSid).update({ status: 'completed' });
}

module.exports = {
  initiateCall,
  getCall,
  endCall,
  toE164,
  resolveFromNumber,
};
