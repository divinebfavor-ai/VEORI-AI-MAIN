/**
 * /api/v2/voice - Twilio voice webhooks for the Twilio + ElevenLabs call layer.
 *
 * These are the endpoints twilioCallService points the outbound call at:
 *   POST /twiml      - TwiML when the callee answers: opens the live conversation
 *   POST /gather     - one conversational turn (seller speech → agent reply)
 *   POST /amd        - async answering-machine-detection result (→ voicemail)
 *   POST /twiml-voicemail - spoken voicemail drop
 *   POST /status     - per-call lifecycle callbacks (ringing/answered/completed)
 *   POST /recording  - recording-ready callback (re-hosts + stores the URL)
 *
 * LIVE CONVERSATION ARCHITECTURE (Module 6): turn-based, NOT a raw-audio stream.
 * Twilio's built-in speech recognition (<Gather input="speech">) handles STT -
 * no extra STT key or cost. Each turn: agent speaks (ElevenLabs <Play>, Twilio
 * <Say> fallback) → <Gather> captures the seller's reply → Twilio POSTs the
 * transcript to /gather → the brain (voiceBrainService) returns the next line →
 * loop. Module 7 swaps the stubbed brain for the real Claude prompt; the brain's
 * public shape (openingLine/nextTurn) stays fixed so this file won't change again.
 * Module 4 added AMD→voicemail branching; Module 5 hardened recording storage.
 * These are NOT auth'd routes - Twilio calls them server-to-server (signature
 * validation is added in a later module).
 *
 * NO auth middleware here (Twilio is the caller, not a logged-in operator).
 * Mounted at /api/v2/voice in index.js, parallel to everything else.
 */

const express = require('express');
const axios = require('axios');
const twilio = require('twilio');
const supabase = require('../config/supabase');
const twilioCallService = require('../services/twilioCallService');
const elevenLabs = require('../services/elevenLabsService');
const voiceBrain = require('../services/voiceBrainService');
const aiService = require('../services/aiService');
const vapiService = require('../services/vapiService');
const { verifyTwilioSignature } = require('../middleware/twilioWebhook');

const router = express.Router();

// Every route in this file is a Twilio webhook (Twilio is the only legitimate
// caller). Verify Twilio's signature on all of them so no anonymous POST can
// forge a call outcome, overwrite a recording URL, drive the live conversation,
// or burn AI-scoring tokens. Fail-open only when TWILIO_AUTH_TOKEN is unset.
router.use(verifyTwilioSignature);

// Polly fallback voice used whenever ElevenLabs <Play> isn't available (no key,
// synth failure). Keeps the call audible so a turn is never silent.
const FALLBACK_SAY_VOICE = 'Polly.Joanna';

// Speak one line of agent text inside a TwiML response. Tries ElevenLabs first
// (synthesize → store → <Play> the public MP3 URL); on any miss falls back to
// Twilio <Say>. Mutates the passed VoiceResponse. Returns nothing.
// This is the single seam where ElevenLabs audio enters the live conversation.
//
// EMOTION (additive): the brain prefixes each line with a "{emotion}" cue and
// returns the parsed emotion in nextTurn(). We accept it as an explicit opt AND
// defensively re-parse any cue still on the text here - so BOTH the deterministic
// opener (no explicit emotion passed) and Claude's replies get delivered with the
// right per-line voice_settings, and a stray cue is NEVER read aloud. Absent/
// unknown emotion → base voice (byte-identical to before this change).
async function speakLine(vr, text, { voiceId, callSid, emotion } = {}) {
  if (!text) return;
  // Strip any leading "{cue}" that reached the text; prefer the explicit emotion
  // the caller passed, else the one parsed off the text.
  const parsed = elevenLabs.parseEmotionCue(text);
  const spoken = parsed.text;
  const useEmotion = emotion || parsed.emotion || null;
  if (!spoken) return;
  // PACING (additive): insert the natural pauses/breaths a real person makes so
  // the line isn't rushed and doesn't run on (ElevenLabs has no speed knob - pace
  // comes from punctuation in the text). Runs AFTER the emotion cue is stripped,
  // so a "{cue}" is never spoken. Gated by VOICE_PACING (default on); off → this
  // returns the text unchanged. The <Say> fallback speaks the paced text too so
  // cadence survives a synth miss.
  const paced = elevenLabs.humanizePacing(spoken);
  let url = null;
  try {
    url = await elevenLabs.synthesizeToUrl(paced, { voiceId, callSid, emotion: useEmotion });
  } catch (e) {
    console.warn('[v2voice] speakLine synth error:', e.message);
  }
  if (url) {
    vr.play(url);
  } else {
    vr.say({ voice: FALLBACK_SAY_VOICE }, paced);
  }
}

// Build the <Gather input="speech"> that captures the seller's next turn and
// POSTs the transcript (SpeechResult) back to /gather. Uses Twilio's built-in
// speech recognition - no extra STT key/cost (the cash-constrained launch path).
// action carries callId so the turn handler can reload context + thread Claude.
function appendListen(vr, callId) {
  const action = `/api/v2/voice/gather?callId=${encodeURIComponent(callId || '')}`;
  vr.gather({
    input: 'speech',
    action,
    method: 'POST',
    speechTimeout: 'auto',     // Twilio auto-detects end of speech
    speechModel: 'phone_call', // tuned for 8kHz telephony audio
    actionOnEmptyResult: true, // still POST on silence so we can reprompt/close
    language: 'en-US',
  });
}

// Supabase Storage bucket that permanently holds call recordings (Module 5).
// Create once in Supabase (public bucket named 'call-recordings'); recordings are
// re-hosted here so playback never depends on Twilio auth or Twilio retention.
const RECORDINGS_BUCKET = 'call-recordings';

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

// Resolve the active use case for a call so the post-call analyzer frames its
// scoring/outcome correctly. Mirrors vapi.js resolveCallUseCase (which is local
// to that file, not exported): operator default (users.ai_use_case) + optional
// per-campaign override (campaigns.use_case), arbitrated by vapiService.getUseCase.
// Best-effort - any miss falls back to 'wholesale' so scoring never breaks.
async function resolveCallUseCase(callRec) {
  try {
    let operator = {};
    if (callRec?.user_id) {
      const { data } = await supabase.from('users').select('ai_use_case').eq('id', callRec.user_id).single();
      if (data) operator = data;
    }
    let override = null;
    if (callRec?.campaign_id) {
      const { data } = await supabase.from('campaigns').select('use_case').eq('id', callRec.campaign_id).single();
      override = data?.use_case || null;
    }
    return vapiService.getUseCase(operator, override);
  } catch (e) {
    console.warn('[v2voice] resolveCallUseCase failed - defaulting to wholesale:', e.message);
    return 'wholesale';
  }
}

// Outcome → lead status/stage maps. Mirror vapi.js mapOutcomeToStatus /
// mapOutcomeToStage EXACTLY (they're local to that file, not exported - same
// precedent as resolveCallUseCase below). Without this, the in-house Twilio
// path never touched the leads table after a call: every dialed lead stayed
// stuck at status='calling' forever and the Kanban/pipeline never advanced
// (the Vapi webhook did this un-sticking; in-house calls skipped it).
function mapOutcomeToStatus(outcome) {
  const map = {
    not_home: 'new', not_interested: 'contacted', callback_requested: 'contacted',
    appointment: 'appointment_set', offer_made: 'offer_made', verbal_yes: 'under_contract',
  };
  return map[outcome] || 'contacted';
}
function mapOutcomeToStage(outcome) {
  const map = {
    no_answer: 'new', not_home: 'new', voicemail: 'new',
    not_interested: 'contacted', wrong_number: 'contacted',
    callback_requested: 'interested', appointment: 'interested', interested: 'interested',
    offer_made: 'offer_made',
    verbal_yes: 'closed',
  };
  return map[outcome] || 'contacted';
}

// Module 8: run end-of-call PMI scoring + persistence for a finished Twilio call.
// Mirrors vapi.js handleCallEnded's write shape EXACTLY so Twilio calls light up
// the same UI/leads/analytics. Reads the durable transcript the brain persisted
// per-turn (calls.transcript), runs the canonical aiService.analyzeCallTranscript,
// and writes the same calls columns. Keyed by the Twilio Call SID (vapi_call_id).
// Best-effort and idempotent-ish: only scores rows that have a transcript and
// haven't already been scored (motivation_score still null).
async function scoreTwilioCall(callSid) {
  if (!callSid) return;
  try {
    const { data: callRec } = await supabase
      .from('calls')
      .select('*, leads(*)')
      .eq('vapi_call_id', callSid)
      .maybeSingle();
    if (!callRec) {
      console.warn(`[v2voice] scoreTwilioCall: no call row for sid=${callSid}`);
      return;
    }

    // Already scored - don't re-spend tokens or overwrite a prior analysis.
    if (callRec.motivation_score != null) {
      console.log(`[v2voice] scoreTwilioCall: sid=${callSid} already scored - skipping`);
      return;
    }

    const transcript = callRec.transcript;
    if (!transcript) {
      // No conversation captured (no-answer / immediate hangup / voicemail).
      // Leave outcome to whatever the status/AMD path set; nothing to analyze.
      // But NEVER leave the lead stuck on 'calling' - guarded so a status a real
      // conversation already set is untouched.
      console.log(`[v2voice] scoreTwilioCall: sid=${callSid} no transcript - skipping AI analysis`);
      if (callRec.lead_id) {
        await supabase.from('leads')
          .update({
            status: 'new',
            pipeline_stage: 'new',
            last_call_date: new Date().toISOString(),
            last_call_outcome: callRec.outcome || 'no_answer',
          })
          .eq('id', callRec.lead_id)
          .eq('status', 'calling')
          .then(null, e => console.warn('[v2voice] lead un-stick failed:', e.message));
      }
      return;
    }

    const useCase = await resolveCallUseCase(callRec);
    const aiAnalysis = await aiService.analyzeCallTranscript(transcript, callRec.leads, useCase);
    // Transcript is guaranteed non-null here (guard above), so a conversation
    // happened. NEVER default to 'not_home' - it maps the lead back to stage
    // 'new' and erases real progress. 'answered' falls through both outcome
    // maps to status/stage 'contacted', which is the truthful floor for any
    // call that produced a transcript.
    const outcome = aiAnalysis.outcome || callRec.outcome || 'answered';

    const { error } = await supabase.from('calls').update({
      motivation_score: aiAnalysis.motivation_score ?? null,
      seller_personality: aiAnalysis.seller_personality ?? null,
      key_signals: aiAnalysis.key_signals ?? null,
      objections: aiAnalysis.objections ?? null,
      outcome,
      ai_summary: aiAnalysis.ai_summary ?? null,
      // offer_made is a NUMERIC column (dollar amount or null). aiAnalysis.offer_made
      // is "<number or null>". Never write a boolean - Postgres rejects the UPDATE.
      offer_made: typeof aiAnalysis.offer_made === 'number' ? aiAnalysis.offer_made : null,
    }).eq('vapi_call_id', callSid);

    if (error) {
      console.error(`[v2voice] scoreTwilioCall write failed sid=${callSid}:`, error.message);
    } else {
      console.log(`[v2voice] scored sid=${callSid} useCase=${useCase} outcome=${outcome} score=${aiAnalysis.motivation_score}`);
    }

    // Advance the LEAD too - mirrors vapi.js handleCallEnded's lead write so the
    // pipeline/Kanban moves after an in-house call exactly like it did on Vapi.
    if (callRec.lead_id) {
      const leadUpdate = {
        status: mapOutcomeToStatus(outcome),
        pipeline_stage: mapOutcomeToStage(outcome),
        last_call_date: new Date().toISOString(),
        last_call_outcome: outcome,
      };
      if (aiAnalysis.motivation_score) {
        leadUpdate.motivation_score  = aiAnalysis.motivation_score;
        leadUpdate.seller_personality = aiAnalysis.seller_personality;
      }
      const { error: leadErr } = await supabase.from('leads').update(leadUpdate).eq('id', callRec.lead_id);
      if (leadErr) console.warn(`[v2voice] lead advance failed lead=${callRec.lead_id}:`, leadErr.message);
    }

    // CAPTURE: feed this verified outcome into the learning loop so the next
    // call is smarter than this one. Best-effort; never blocks scoring.
    try {
      const { learnFromCall } = require('../services/learningLoopService');
      learnFromCall({ ...callRec, transcript, outcome }, aiAnalysis)
        .then(null, (e) => console.warn('[v2voice] learnFromCall failed:', e.message));
    } catch (_) { /* additive */ }
  } catch (e) {
    console.warn('[v2voice] scoreTwilioCall error:', e.message);
  }
}

// Load the lead + operator behind a calls.id so a webhook can personalise the
// voicemail AND run the live conversation. One round trip: read the call row,
// then the lead and operator it points at. Returns { call, lead, operator,
// operatorId, leadId, voiceId } with safe fallbacks on any miss. voiceId is the
// operator's chosen ElevenLabs voice (resolved through the v2 settings table).
async function loadCallContext(callId) {
  if (!callId) return { call: {}, lead: {}, operator: {}, operatorId: null, leadId: null, voiceId: null };
  const { data: call } = await supabase
    .from('calls')
    .select('lead_id, user_id, lead_name, property_address')
    .eq('id', callId)
    .maybeSingle();
  if (!call) return { call: {}, lead: {}, operator: {}, operatorId: null, leadId: null, voiceId: null };

  // FULL lead + operator rows. The old narrow selects (lead: first_name +
  // property_address; operator: 3 fields) silently starved the brain: the
  // prompt's veteran-read, tag-intelligence, strategy, offer-math, tone and
  // operator custom-instruction layers all read fields that were never loaded,
  // so every in-house call ran with them empty. One-row selects - cost is nil.
  const [{ data: lead }, { data: operator }, voiceId, lastCallRes] = await Promise.all([
    call.lead_id
      ? supabase.from('leads').select('*').eq('id', call.lead_id).maybeSingle()
      : Promise.resolve({ data: null }),
    call.user_id
      ? supabase.from('users').select('*').eq('id', call.user_id).maybeSingle()
      : Promise.resolve({ data: null }),
    call.user_id
      ? elevenLabs.resolveOperatorVoiceId(call.user_id).then(null, () => null)
      : Promise.resolve(null),
    // Cross-call memory: the most recent completed conversation with this lead
    // (excluding the current call) so the brain picks up where it left off.
    call.lead_id
      ? supabase.from('calls')
          .select('ai_summary, outcome, objections')
          .eq('lead_id', call.lead_id)
          .neq('id', callId)
          .not('ended_at', 'is', null)
          .order('ended_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const leadOut = lead || { first_name: call.lead_name, property_address: call.property_address };
  const lastCall = lastCallRes?.data || null;
  if (lastCall) {
    // Attached (not persisted) fields consumed by buildPriorContactBlock.
    leadOut.last_call_summary = lastCall.ai_summary || null;
    leadOut.last_call_objections = Array.isArray(lastCall.objections)
      ? lastCall.objections.join('; ')
      : (lastCall.objections || null);
    if (!leadOut.last_call_outcome && lastCall.outcome) leadOut.last_call_outcome = lastCall.outcome;
  }

  // Warm this operator's learned-lesson cache so the brain's turn prompt can
  // inject lessons synchronously. Fire-and-forget - never delays TwiML.
  if (call.user_id) {
    try {
      require('../services/learningLoopService').primeLessonCache(call.user_id);
    } catch (_) { /* additive - absence never breaks a call */ }
  }

  return {
    call,
    lead: leadOut,
    operator: operator || {},
    operatorId: call.user_id || null,
    leadId: call.lead_id || null,
    voiceId: voiceId || null,
  };
}

// POST /api/v2/voice/twiml - returned when the seller picks up.
// Module 6: opens the live, turn-based conversation. Speaks the agent's opening
// line (ElevenLabs <Play>, Twilio <Say> fallback) then hands the mic to the
// seller via <Gather input="speech">. Twilio transcribes their reply and POSTs
// it to /gather, which threads it to the brain and speaks the response - looping
// the conversation. Module 7 swaps the stubbed brain for the real Claude prompt.
router.post('/twiml', async (req, res) => {
  const callId = req.query.callId || req.body.CallSid || '';
  const callSid = req.body.CallSid || '';
  const vr = new twilio.twiml.VoiceResponse();

  try {
    const ctx = await loadCallContext(req.query.callId);
    const opening = voiceBrain.openingLine(ctx);
    await speakLine(vr, opening, { voiceId: ctx.voiceId, callSid });
    appendListen(vr, callId);
    console.log(`[v2voice] twiml opened conversation callId=${callId}`);
  } catch (e) {
    console.warn('[v2voice] twiml open error:', e.message);
    // Never leave the line dead - at least greet + listen with the fallback voice.
    vr.say({ voice: FALLBACK_SAY_VOICE }, 'Hi, thanks for taking my call. How are you doing today?');
    appendListen(vr, callId);
  }

  res.type('text/xml').send(vr.toString());
});

// POST|GET /api/v2/voice/twiml-stream - answer TwiML for the v2 "stream" engine.
// ADDITIVE + inert: only twilioCallStreamService points calls here, and that only
// runs when VOICE_ENGINE=stream. Returns <Connect><Stream> so Twilio opens a
// bidirectional Media Stream WebSocket to mediaStreamServer (real-time STT ↔
// Claude ↔ ElevenLabs with barge-in). callId rides in a <Parameter> so the WS
// session can loadCallContext the right lead/operator/voice. The turn-based
// /twiml above is untouched and still serves the elevenlabs engine.
async function twimlStreamHandler(req, res) {
  const callId = req.query.callId || req.body?.CallSid || '';
  const vr = new twilio.twiml.VoiceResponse();

  try {
    // Public WS host: strip scheme from PUBLIC_BASE and use wss://.
    const publicBase = process.env.PUBLIC_BASE_URL
      || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '');
    const host = publicBase.replace(/^https?:\/\//i, '');
    if (!host) throw new Error('PUBLIC_BASE_URL / RAILWAY_PUBLIC_DOMAIN not set');

    const connect = vr.connect();
    const stream = connect.stream({ url: `wss://${host}/api/v2/voice/media-stream` });
    stream.parameter({ name: 'callId', value: String(callId) });
    console.log(`[v2voice] twiml-stream opened media stream callId=${callId}`);
  } catch (e) {
    console.warn('[v2voice] twiml-stream error, downgrading to turn-based:', e.message);
    // Never leave the line dead - fall back to the proven turn-based conversation.
    vr.redirect(`/api/v2/voice/twiml?callId=${encodeURIComponent(callId)}`);
  }

  res.type('text/xml').send(vr.toString());
}
router.post('/twiml-stream', twimlStreamHandler);
router.get('/twiml-stream', twimlStreamHandler);

// POST /api/v2/voice/gather - one conversational turn.
// Twilio POSTs here after each <Gather> with the seller's transcribed speech in
// SpeechResult. We load context, ask the brain for the next line (Module 7 wires
// Claude here), speak it, and re-arm the <Gather> to keep the conversation going.
// When the brain signals the call should end, we speak the closer and <Hangup>.
router.post('/gather', async (req, res) => {
  const callId = req.query.callId || '';
  const callSid = req.body.CallSid || '';
  const speech = (req.body.SpeechResult || '').trim();
  const confidence = req.body.Confidence ? parseFloat(req.body.Confidence) : null;
  const vr = new twilio.twiml.VoiceResponse();

  try {
    const ctx = await loadCallContext(callId);
    console.log(`[v2voice] gather callId=${callId} heard="${speech}" conf=${confidence ?? 'n/a'}`);

    // Ask the brain for the next turn. Stub today (Module 6); real Claude in M7.
    // emotion (additive) is the per-line delivery cue the brain parsed off the
    // reply → dynamic voice_settings so the line is spoken with feeling.
    const { reply, end, emotion } = await voiceBrain.nextTurn({
      ...ctx, callId, callSid, speech, confidence,
    });

    await speakLine(vr, reply, { voiceId: ctx.voiceId, callSid, emotion });

    if (end) {
      vr.hangup();
      console.log(`[v2voice] gather closing call callId=${callId}`);
    } else {
      appendListen(vr, callId);
    }
  } catch (e) {
    console.warn('[v2voice] gather handler error:', e.message);
    // On error, say a graceful line and keep listening rather than dropping.
    vr.say({ voice: FALLBACK_SAY_VOICE }, 'Sorry, could you say that again?');
    appendListen(vr, callId);
  }

  res.type('text/xml').send(vr.toString());
});

// POST /api/v2/voice/amd - Twilio async answering-machine-detection result.
// Twilio runs AMD in parallel with the live call (asyncAmd) and POSTs the result
// here when it resolves. On a machine, we redirect the still-live call to the
// voicemail TwiML so the operator's script is left; on a human we do nothing and
// the conversation path (twiml) keeps running. callId rides in the query.
router.post('/amd', async (req, res) => {
  // 200 fast - Twilio retries on non-2xx; do the redirect work after responding.
  res.sendStatus(200);

  try {
    const callSid = req.body.CallSid;
    const answeredBy = req.body.AnsweredBy;        // human|machine_start|machine_end_beep|machine_end_silence|machine_end_other|fax|unknown
    const callId = req.query.callId || '';
    if (!callSid || !answeredBy) return;

    const isMachine = answeredBy.startsWith('machine');
    console.log(`[v2voice] amd sid=${callSid} answeredBy=${answeredBy} machine=${isMachine}`);

    if (!isMachine) return; // human (or fax/unknown) - leave the live call alone.

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

// POST /api/v2/voice/twiml-voicemail - spoken voicemail drop.
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

// POST /api/v2/voice/status - Twilio per-call lifecycle callback.
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

    // Key on OUR calls.id when the dial put it in the callback URL. The old
    // sid-only lookup raced the dial path: Twilio fires 'initiated'/'ringing'
    // (and for busy/no-answer even 'completed') BEFORE vapi_call_id is written
    // to the row, so the update matched 0 rows and the outcome was silently
    // dropped. callId exists from the row's INSERT, so this never races.
    // Backfill vapi_call_id here too - the /recording webhook + scoring look
    // rows up by sid, and this may run before the dial path's own sid write.
    const callId = req.query.callId || '';
    let error = null;
    if (callId) {
      update.vapi_call_id = callSid;
      ({ error } = await supabase.from('calls').update(update).eq('id', callId));
    } else {
      // Legacy/foreign dials with no callId in the URL - sid lookup as before.
      ({ error } = await supabase.from('calls').update(update).eq('vapi_call_id', callSid));
    }
    if (error) console.warn('[v2voice] status update failed:', error.message);

    console.log(`[v2voice] status sid=${callSid} ${callStatus}->${mapped}` +
      (answeredBy ? ` answeredBy=${answeredBy}` : ''));

    // Module 8: on the authoritative call-end event, run PMI scoring + persistence
    // off the durable transcript the brain wrote per-turn. Awaited so the work
    // completes within this handler invocation (the 200 already went out above).
    if (callStatus === 'completed') {
      await scoreTwilioCall(callSid);
    } else if (['busy', 'failed', 'no-answer', 'canceled'].includes(callStatus)) {
      // Terminal without a conversation - un-stick the lead from 'calling' so the
      // pipeline board advances (guarded: never clobbers a richer status).
      const { data: rec } = await supabase.from('calls')
        .select('lead_id').eq('vapi_call_id', callSid).maybeSingle();
      if (rec?.lead_id) {
        await supabase.from('leads')
          .update({
            status: 'new',
            pipeline_stage: 'new',
            last_call_date: new Date().toISOString(),
            last_call_outcome: callStatus === 'no-answer' ? 'no_answer' : 'failed',
          })
          .eq('id', rec.lead_id)
          .eq('status', 'calling')
          .then(null, e => console.warn('[v2voice] lead un-stick failed:', e.message));
      }
    }
  } catch (e) {
    console.warn('[v2voice] status handler error:', e.message);
  }
});

// Re-host a Twilio recording into Supabase Storage and return the permanent
// public URL. Twilio's RecordingUrl needs the account's Basic Auth to fetch and
// is subject to Twilio retention, so we copy the bytes once into our own bucket.
// Returns the public Supabase URL, or null if any step fails (caller falls back
// to the Twilio URL so a recording is never lost).
async function rehostRecording({ callSid, recordingSid, recordingUrl }) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    console.warn('[v2voice] rehost skipped - Twilio creds missing');
    return null;
  }

  // Twilio serves the media when you append a format extension; .mp3 is compact.
  const mediaUrl = `${recordingUrl}.mp3`;
  const { data } = await axios.get(mediaUrl, {
    responseType: 'arraybuffer',
    auth: { username: sid, password: token },
    timeout: 30000,
  });

  const path = `${callSid}/${recordingSid || Date.now()}.mp3`;
  const { error: uploadErr } = await supabase.storage
    .from(RECORDINGS_BUCKET)
    .upload(path, Buffer.from(data), { contentType: 'audio/mpeg', upsert: true });
  if (uploadErr) throw uploadErr;

  const { data: pub } = supabase.storage.from(RECORDINGS_BUCKET).getPublicUrl(path);
  return pub?.publicUrl || null;
}

// POST /api/v2/voice/recording - Twilio recording-ready callback.
// Re-hosts the recording into Supabase Storage (permanent, no Twilio auth needed)
// and stores that URL on the calls row. If re-hosting fails for any reason we
// store Twilio's hosted URL instead so the recording link is never lost.
router.post('/recording', async (req, res) => {
  res.sendStatus(200);

  try {
    const callSid = req.body.CallSid;
    const recordingSid = req.body.RecordingSid;
    const recordingUrl = req.body.RecordingUrl;    // Twilio-hosted (append .mp3 to fetch)
    if (!callSid || !recordingUrl) return;

    let finalUrl = recordingUrl;
    let source = 'twilio';
    try {
      const hosted = await rehostRecording({ callSid, recordingSid, recordingUrl });
      if (hosted) { finalUrl = hosted; source = 'supabase'; }
    } catch (rehostErr) {
      console.warn(`[v2voice] recording rehost failed sid=${callSid}, falling back to Twilio URL:`, rehostErr.message);
    }

    const { error } = await supabase
      .from('calls')
      .update({ recording_url: finalUrl })
      .eq('vapi_call_id', callSid);
    if (error) console.warn('[v2voice] recording update failed:', error.message);

    console.log(`[v2voice] recording sid=${callSid} stored (${source})`);
  } catch (e) {
    console.warn('[v2voice] recording handler error:', e.message);
  }
});

// ADDITIVE: expose loadCallContext on the router so the streaming media-stream
// server (mediaStreamServer.js) reuses the exact same lead/operator/voice loader
// the turn-based path uses. The default export stays the Express router so the
// existing `app.use('/api/v2/voice', require('./routes/v2voice'))` mount is unchanged.
router.loadCallContext = loadCallContext;

module.exports = router;
