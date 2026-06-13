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

const router = express.Router();

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
