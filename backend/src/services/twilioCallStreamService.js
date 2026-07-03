/**
 * Twilio Call Stream Service — outbound dial engine for the v2 "stream" pipeline.
 *
 * This is the streaming-mode sibling of twilioCallService.js. It exists so the
 * VOICE_ENGINE=stream branch of vapiService.initiateCall has something to delegate
 * to. Its call signature and return contract are BYTE-FOR-BYTE identical to
 * twilioCallService.initiateCall, so the dispatcher swap is a one-liner and none
 * of the 6 callers (or calls.js) change:
 *
 *     initiateCall({ lead, phoneNumber, callId, operator, useCaseOverride }) -> { id, provider }
 *
 * The ONLY difference from twilioCallService is the answer TwiML URL: this points
 * at /api/v2/voice/twiml-stream (which returns <Connect><Stream>) instead of
 * /api/v2/voice/twiml (which returns the turn-based <Gather>). Every other Twilio
 * callback is IDENTICAL and REUSED:
 *   - statusCallback → /api/v2/voice/status  (scoring, unchanged)
 *   - asyncAmd       → /api/v2/voice/amd      (voicemail redirect, unchanged)
 *   - record + recordingStatusCallback → /api/v2/voice/recording (unchanged)
 *
 * It re-uses twilioCallService's toE164 + resolveFromNumber so dial/normalisation
 * behaviour is guaranteed identical. No new Twilio credentials.
 */

const twilio = require('twilio');
const { toE164, resolveFromNumber } = require('./twilioCallService');

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;

const PUBLIC_BASE = process.env.PUBLIC_BASE_URL
  || (process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : null);

/** Lazy Twilio client — only when creds present (same pattern as twilioCallService). */
function getClient() {
  if (!TWILIO_SID || !TWILIO_TOKEN) return null;
  return twilio(TWILIO_SID, TWILIO_TOKEN);
}

/**
 * Place an outbound streaming call via Twilio.
 * Identical contract to twilioCallService.initiateCall; only the answer TwiML URL
 * differs (→ /twiml-stream, which starts the <Connect><Stream> media pipeline).
 *
 * @param {object}  args
 * @param {object}  args.lead
 * @param {object}  args.phoneNumber
 * @param {string}  args.callId
 * @param {object}  [args.operator]
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

  // Streaming answer TwiML: returns <Connect><Stream> pointing at the media-stream WS.
  const twimlUrl = new URL(`${PUBLIC_BASE}/api/v2/voice/twiml-stream`);
  twimlUrl.searchParams.set('callId', callId || '');
  if (useCaseOverride) twimlUrl.searchParams.set('useCase', useCaseOverride);

  // Identical lifecycle / AMD / recording callbacks to the turn-based engine.
  // callId rides in the query so /status can key on OUR calls.id from the very
  // first event — Twilio fires 'initiated'/'ringing' before the dial path has
  // written vapi_call_id to the row, so sid-keyed updates lose that race
  // (0 rows matched, status/outcome silently dropped).
  const statusUrl = `${PUBLIC_BASE}/api/v2/voice/status?callId=${encodeURIComponent(callId || '')}`;
  const amdUrl = new URL(`${PUBLIC_BASE}/api/v2/voice/amd`);
  amdUrl.searchParams.set('callId', callId || '');

  const call = await client.calls.create({
    to,
    from,
    url: twimlUrl.toString(),
    method: 'POST',
    statusCallback: statusUrl,
    statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    statusCallbackMethod: 'POST',
    machineDetection: 'DetectMessageEnd',
    asyncAmd: 'true',
    asyncAmdStatusCallback: amdUrl.toString(),
    asyncAmdStatusCallbackMethod: 'POST',
    machineDetectionTimeout: 30,
    record: true,
    recordingStatusCallback: `${PUBLIC_BASE}/api/v2/voice/recording`,
    recordingStatusCallbackMethod: 'POST',
    timeout: 30,
  });

  console.log(`[TwilioStreamCall] Outbound dial sid=${call.sid} to=${to} from=${from} callId=${callId}`);
  return { id: call.sid, provider: 'twilio' };
}

module.exports = { initiateCall };
