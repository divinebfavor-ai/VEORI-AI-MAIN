/**
 * /api/v2/voice — Twilio voice webhooks for the Twilio + ElevenLabs call layer.
 *
 * These are the endpoints twilioCallService points the outbound call at:
 *   POST /twiml      — TwiML returned when the callee answers (what to say/do)
 *   POST /status     — per-call lifecycle callbacks (ringing/answered/completed)
 *   POST /recording  — recording-ready callback (stores the recording URL)
 *
 * MODULE 3 SCOPE: minimal but REAL handlers so an outbound call connects and the
 * calls row tracks lifecycle. The live two-way audio (<Connect><Stream> ↔ STT ↔
 * Claude ↔ ElevenLabs) replaces the placeholder TwiML in Module 6-7; voicemail
 * branching (AnsweredBy) is added in Module 4; recording storage hardens in
 * Module 5. These are NOT auth'd routes — Twilio calls them server-to-server
 * (signature validation is added alongside the live audio in a later module).
 *
 * NO auth middleware here (Twilio is the caller, not a logged-in operator).
 * Mounted at /api/v2/voice in index.js, parallel to everything else.
 */

const express = require('express');
const twilio = require('twilio');
const supabase = require('../config/supabase');
const twilioCallService = require('../services/twilioCallService');

const router = express.Router();

// Render an operator's voicemail script with the same token vocabulary the Vapi
// path uses (vapiService.js ~L955), so a voicemail an operator wrote once works
// identically whichever engine dials. Falls back to a sane default line.
// lead: { first_name, property_address }, operator: { ai_voicemail_script, ai_caller_name, company_name }
function renderVoicemailScript(lead = {}, operator = {}) {
  const aiName = operator.ai_caller_name || 'Alex';
  const companyName = operator.company_name || 'a local real estate group';
  const firstName = lead.first_name || 'there';
  const address = lead.property_address || 'your property';

  if (operator.ai_voicemail_script) {
    return operator.ai_voicemail_script
      .replace(/\[FirstName\]|\{first_name\}/gi, firstName)
      .replace(/\[Address\]|\{property_address\}/gi, address)
      .replace(/\[Company\]|\{company\}/gi, companyName)
      .replace(/\[AIName\]|\{ai_name\}/gi, aiName);
  }
  return `Hi ${firstName}, this is ${aiName} from ${companyName}. ` +
    `I was reaching out about your property at ${address}. ` +
    `Please give me a call back when you get a chance. Have a great day.`;
}

// Load the lead + operator behind a calls.id so a webhook can personalise the
// voicemail. One round trip: read the call row, then the lead and operator it
// points at. Returns { lead, operator } with empty objects on any miss.
async function loadCallContext(callId) {
  if (!callId) return { lead: {}, operator: {} };
  const { data: call } = await supabase
    .from('calls')
    .select('lead_id, user_id, lead_name, property_address')
    .eq('id', callId)
    .maybeSingle();
  if (!call) return { lead: {}, operator: {} };

  const [{ data: lead }, { data: operator }] = await Promise.all([
    call.lead_id
      ? supabase.from('leads').select('first_name, property_address').eq('id', call.lead_id).maybeSingle()
      : Promise.resolve({ data: null }),
    call.user_id
      ? supabase.from('users').select('ai_caller_name, company_name, ai_voicemail_script').eq('id', call.user_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    lead: lead || { first_name: call.lead_name, property_address: call.property_address },
    operator: operator || {},
  };
}

// POST /api/v2/voice/twiml — returned when the seller picks up.
// Module 3 placeholder: a short hold line. Module 6 swaps the body for a
// <Connect><Stream> that bridges the call to our media-stream WebSocket where
// Claude + ElevenLabs run the conversation.
router.post('/twiml', (req, res) => {
  const callId = req.query.callId || req.body.CallSid || '';
  const vr = new twilio.twiml.VoiceResponse();

  // Placeholder hold message. Intentionally brief — replaced by live audio in M6.
  vr.say(
    { voice: 'Polly.Joanna' },
    'One moment please while I connect you.'
  );
  vr.pause({ length: 2 });

  console.log(`[v2voice] TwiML served for callId=${callId}`);
  res.type('text/xml').send(vr.toString());
});

// POST /api/v2/voice/amd — Twilio async answering-machine-detection result.
// Twilio runs AMD in parallel with the live call (asyncAmd) and POSTs the result
// here when it resolves. On a machine, we redirect the still-live call to the
// voicemail TwiML so the operator's script is left; on a human we do nothing and
// the conversation path (twiml) keeps running. callId rides in the query.
router.post('/amd', async (req, res) => {
  // 200 fast — Twilio retries on non-2xx; do the redirect work after responding.
  res.sendStatus(200);

  try {
    const callSid = req.body.CallSid;
    const answeredBy = req.body.AnsweredBy;        // human|machine_start|machine_end_beep|machine_end_silence|machine_end_other|fax|unknown
    const callId = req.query.callId || '';
    if (!callSid || !answeredBy) return;

    const isMachine = answeredBy.startsWith('machine');
    console.log(`[v2voice] amd sid=${callSid} answeredBy=${answeredBy} machine=${isMachine}`);

    if (!isMachine) return; // human (or fax/unknown) — leave the live call alone.

    // Redirect the in-progress call to the voicemail TwiML (REST update).
    await twilioCallService.redirectCall(
      callSid,
      `/api/v2/voice/twiml-voicemail?callId=${encodeURIComponent(callId)}`,
    );
    console.log(`[v2voice] voicemail redirect sent sid=${callSid} callId=${callId}`);
  } catch (e) {
    console.warn('[v2voice] amd handler error:', e.message);
  }
});

// POST /api/v2/voice/twiml-voicemail — spoken voicemail drop.
// Reached only when AMD redirected the call here (machine answered). Loads the
// lead+operator behind callId, renders the operator's voicemail script, and
// speaks it. ElevenLabs <Play> is the future upgrade (needs hosted audio, lands
// with the Module 5 storage work); Twilio <Say> keeps this self-contained today.
router.post('/twiml-voicemail', async (req, res) => {
  const callId = req.query.callId || req.body.CallSid || '';
  const vr = new twilio.twiml.VoiceResponse();

  try {
    const { lead, operator } = await loadCallContext(req.query.callId);
    const message = renderVoicemailScript(lead, operator);
    // Small lead-in pause so the start of the message isn't clipped by the beep.
    vr.pause({ length: 1 });
    vr.say({ voice: 'Polly.Joanna' }, message);
    console.log(`[v2voice] voicemail spoken callId=${callId} len=${message.length}`);
  } catch (e) {
    console.warn('[v2voice] voicemail render error:', e.message);
    vr.say({ voice: 'Polly.Joanna' }, 'Sorry we missed you. Please call us back when you get a chance.');
  }

  vr.hangup();
  res.type('text/xml').send(vr.toString());
});

// POST /api/v2/voice/status — Twilio per-call lifecycle callback.
// Maps Twilio CallStatus -> our calls.status and stamps timestamps. Looked up by
// the Twilio Call SID stored in calls.vapi_call_id (provider-agnostic column).
router.post('/status', async (req, res) => {
  // Always 200 fast so Twilio doesn't retry; do the DB work after responding.
  res.sendStatus(200);

  try {
    const callSid = req.body.CallSid;
    const callStatus = req.body.CallStatus;        // queued|ringing|in-progress|completed|busy|failed|no-answer|canceled
    const answeredBy = req.body.AnsweredBy;        // human|machine_*|fax|unknown (Module 4 uses this)
    const durationStr = req.body.CallDuration;     // seconds, on completed
    if (!callSid) return;

    // Map Twilio status -> our schema's status vocabulary (kept close to Vapi's).
    const STATUS_MAP = {
      queued:        'initiated',
      initiated:     'initiated',
      ringing:       'ringing',
      'in-progress': 'in-progress',
      completed:     'completed',
      busy:          'failed',
      failed:        'failed',
      'no-answer':   'no-answer',
      canceled:      'failed',
    };
    const mapped = STATUS_MAP[callStatus] || callStatus;

    const update = { status: mapped };
    if (callStatus === 'in-progress') update.started_at = new Date().toISOString();
    if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(callStatus)) {
      update.ended_at = new Date().toISOString();
      if (durationStr) update.duration_seconds = parseInt(durationStr, 10) || null;
    }

    const { error } = await supabase
      .from('calls')
      .update(update)
      .eq('vapi_call_id', callSid);
    if (error) console.warn('[v2voice] status update failed:', error.message);

    console.log(`[v2voice] status sid=${callSid} ${callStatus}->${mapped}` +
      (answeredBy ? ` answeredBy=${answeredBy}` : ''));
  } catch (e) {
    console.warn('[v2voice] status handler error:', e.message);
  }
});

// POST /api/v2/voice/recording — Twilio recording-ready callback.
// Stores the recording URL on the calls row. Module 5 adds permanent re-hosting
// to Supabase Storage; Module 3 just captures Twilio's hosted URL.
router.post('/recording', async (req, res) => {
  res.sendStatus(200);

  try {
    const callSid = req.body.CallSid;
    const recordingUrl = req.body.RecordingUrl;    // Twilio-hosted .mp3/.wav (append extension to fetch)
    if (!callSid || !recordingUrl) return;

    const { error } = await supabase
      .from('calls')
      .update({ recording_url: recordingUrl })
      .eq('vapi_call_id', callSid);
    if (error) console.warn('[v2voice] recording update failed:', error.message);

    console.log(`[v2voice] recording sid=${callSid} url stored`);
  } catch (e) {
    console.warn('[v2voice] recording handler error:', e.message);
  }
});

module.exports = router;
