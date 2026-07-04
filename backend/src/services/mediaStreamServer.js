/**
 * Media Stream Server - the real-time streaming voice engine (VOICE_ENGINE=stream).
 *
 * This is the heart of the in-house, fully-off-Vapi calling pipeline. It attaches
 * a WebSocket server to the existing HTTP server and, for each Twilio Media Stream
 * connection, runs a live full-duplex conversation:
 *
 *   Twilio Media Stream (mu-law 8kHz)  ──►  Deepgram streaming STT
 *                                              │  (interim + final transcripts)
 *                                              ▼
 *                                        voiceBrainService.nextTurn (Claude haiku)
 *                                              │  { reply, end }
 *                                              ▼
 *                                   ElevenLabs streamTts (ulaw_8000 WebSocket)
 *                                              │  base64 mu-law frames
 *                                              ▼
 *   Twilio Media Stream  ◄──────────────  media frames (160-byte / 20ms) + marks
 *
 * BARGE-IN: while the agent is speaking, if Deepgram reports the seller starting
 * to talk (≥2 words on an interim), we (1) send Twilio {event:'clear'} to flush
 * queued agent audio, (2) abort the in-flight ElevenLabs stream, and (3) abort the
 * in-flight Claude turn - then keep listening. This is what makes it feel human.
 *
 * ADDITIVE + INERT: nothing imports this unless index.js calls attach(server), and
 * even then it only ever handles the NEW path /api/v2/voice/media-stream. Twilio
 * only connects to that path when VOICE_ENGINE=stream routes a call through
 * /twiml-stream. With the flag unset, no call ever opens this socket.
 *
 * REUSED UNCHANGED: voiceBrainService (brain, opt-out, [[END_CALL]], MAX_TURNS,
 * persistTranscript), twilioCallService.endCall, v2voice.loadCallContext,
 * elevenLabsService.streamTts, deepgramStreamService. The /status, /amd,
 * /recording webhooks fire exactly as today (they're set on the dial in
 * twilioCallStreamService), so scoring/voicemail/recording are all unchanged.
 *
 * STATE: one StreamSession per Twilio stream, keyed by streamSid. Single Railway
 * process; a call lasts minutes. Process restart mid-call loses live audio (same
 * documented limit as the turn-based engine) but calls.transcript survives for
 * scoring because voiceBrain.persistTranscript flushes every turn.
 */

const WebSocket = require('ws');
const { createDeepgramStream } = require('./deepgramStreamService');
const elevenLabs = require('./elevenLabsService');
const voiceBrain = require('./voiceBrainService');
const twilioCallService = require('./twilioCallService');
const v2voice = require('../routes/v2voice');

// WS path Twilio's <Stream url="..."> points at. Guarded on upgrade so we never
// hijack any other WebSocket traffic on the server.
const MEDIA_STREAM_PATH = '/api/v2/voice/media-stream';

// Twilio media framing: 8kHz mu-law, 20ms frames = 160 bytes. We re-chunk the
// ElevenLabs ulaw stream to exactly this so playback is smooth.
const TWILIO_FRAME_BYTES = 160;

// Barge-in threshold: require at least this many interim words before we treat it
// as the seller genuinely interrupting (filters coughs / single-word backchannel).
const BARGE_IN_MIN_WORDS = parseInt(process.env.STREAM_BARGE_IN_MIN_WORDS, 10) || 2;

// Inactivity nudge: if the seller goes silent this long with no turn, reprompt
// (matches the turn-based engine's actionOnEmptyResult behaviour).
const SILENCE_NUDGE_MS = parseInt(process.env.STREAM_SILENCE_NUDGE_MS, 10) || 8000;

// Active sessions keyed by streamSid (set once Twilio sends the `start` event).
const sessions = new Map();

// Secondary index: our calls.id → live StreamSession. Lets the live-listen WS find
// the right call's audio without knowing the Twilio streamSid. Set in handleStart,
// cleared in teardown. Additive - nothing else reads it.
const sessionsByCallId = new Map();

// WS path the operator's browser connects to for live-listen (one-way audio out).
const LISTEN_PATH = '/api/v2/voice/listen';

// ── mu-law (PCMU) → 16-bit linear PCM decode ────────────────────────────────────
// Twilio media + our agent frames are 8kHz mu-law. The browser listen player expects
// 16-bit little-endian PCM (mono). This is the standard G.711 mu-law expansion table;
// pure math, no dependency. Precomputed once for speed.
const MULAW_DECODE = (() => {
  const table = new Int16Array(256);
  for (let i = 0; i < 256; i++) {
    const u = ~i & 0xff;
    const sign = u & 0x80;
    const exponent = (u >> 4) & 0x07;
    const mantissa = u & 0x0f;
    let sample = ((mantissa << 3) + 0x84) << exponent;
    sample -= 0x84;
    table[i] = sign ? -sample : sample;
  }
  return table;
})();

/** Decode a mu-law Buffer to a PCM16LE Buffer (mono, same sample count). */
function mulawToPcm16(mulawBuf) {
  const out = Buffer.allocUnsafe(mulawBuf.length * 2);
  for (let i = 0; i < mulawBuf.length; i++) {
    out.writeInt16LE(MULAW_DECODE[mulawBuf[i]], i * 2);
  }
  return out;
}

/**
 * One live streaming call. Owns the three sockets (Twilio WS in, Deepgram WS,
 * ElevenLabs WS via streamTts) plus turn state, barge-in, and teardown.
 */
class StreamSession {
  constructor(twilioWs) {
    this.twilioWs = twilioWs;
    this.streamSid = null;
    this.callSid = null;
    this.callId = null;      // our calls.id (rides in a <Parameter>)
    this.ctx = null;         // loadCallContext() result
    this.dg = null;          // Deepgram stream handle

    this.agentSpeaking = false;   // true while we're playing TTS (marks pending)
    this.everProducedAudio = false; // any TTS audio has reached Twilio this call
    this.pendingMarks = 0;        // Twilio marks sent but not yet echoed back
    this.ttsAbort = null;         // AbortController for the active streamTts
    this.turnInFlight = false;    // dedupe guard so one utterance = one brain turn
    this.turnAbort = null;        // AbortController for the active nextTurn
    this.finalBuffer = '';        // accumulated is_final words for the current turn
    this.turnCount = 0;
    this.ended = false;
    this.silenceTimer = null;

    // Operator takeover: when true, the AI is silenced (no new turns, no reprompt)
    // so a human operator can talk on the line. Default false → byte-identical to
    // the normal autonomous behaviour. Toggled by muteAgent()/unmuteAgent().
    this.muted = false;

    // Live-listen: operator browser WebSockets subscribed to this call's audio.
    // Empty by default → zero overhead. Each is a plain `ws` we push PCM16 frames to.
    this.listeners = new Set();
  }

  // ── live-listen (in-house, replaces Vapi monitor.listenUrl) ──────────────────

  /** Attach an operator browser socket. Sends the sampleRate config frame first. */
  addListener(ws) {
    if (this.ended) { try { ws.close(); } catch (_) { /* noop */ } return; }
    try { ws.send(JSON.stringify({ sampleRate: 8000, channels: 1, codec: 'pcm16' })); } catch (_) { /* noop */ }
    this.listeners.add(ws);
    ws.on('close', () => this.listeners.delete(ws));
    ws.on('error', () => this.listeners.delete(ws));
  }

  /**
   * Fan one mu-law frame (caller OR agent audio) out to every listener as PCM16.
   * No-op when no one is listening, so normal calls pay nothing.
   */
  broadcastAudio(mulawBuf) {
    if (this.listeners.size === 0 || !mulawBuf || !mulawBuf.length) return;
    let pcm = null;
    for (const ws of this.listeners) {
      if (ws.readyState !== WebSocket.OPEN) { this.listeners.delete(ws); continue; }
      if (!pcm) pcm = mulawToPcm16(mulawBuf); // decode lazily, once per frame
      try { ws.send(pcm); } catch (_) { this.listeners.delete(ws); }
    }
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  async handleStart(data) {
    this.streamSid = data.streamSid;
    const params = data.start?.customParameters || {};
    this.callId = params.callId || null;
    this.callSid = data.start?.callSid || null;
    sessions.set(this.streamSid, this);
    if (this.callId) sessionsByCallId.set(this.callId, this);

    console.log(`[MediaStream] start streamSid=${this.streamSid} callSid=${this.callSid} callId=${this.callId}`);

    // Load lead/operator/voice context (the only "auth" on this unauth'd WS is
    // that callId must resolve to a real calls row).
    try {
      this.ctx = await v2voice.loadCallContext(this.callId);
    } catch (err) {
      console.warn('[MediaStream] loadCallContext failed:', err.message);
    }
    if (!this.ctx || !this.ctx.call) {
      console.warn(`[MediaStream] no context for callId=${this.callId} - closing stream`);
      return this.teardown();
    }
    // Thread callId into ctx so the brain's session map keys line up.
    this.ctx.callId = this.callId;

    // Open the Deepgram STT stream for this call.
    this.openDeepgram();

    // Speak the deterministic opener immediately (no model call → zero dead air).
    // Delivered warm - a cold, flat first line is what makes sellers hang up.
    const opener = voiceBrain.openingLine(this.ctx);
    await this.speak(opener, { emotion: 'warm' });

    this.armSilenceTimer();
  }

  openDeepgram() {
    this.dg = createDeepgramStream({
      onOpen: () => console.log(`[MediaStream] Deepgram ready for ${this.streamSid}`),
      onTranscript: (t) => this.onTranscript(t),
      onUtteranceEnd: () => this.onUtteranceEnd(),
      onClose: () => {},
      onError: (err) => console.warn('[MediaStream] Deepgram error:', err.message),
    });
    if (this.dg?.unavailable) {
      // No Deepgram key → we can't run streaming STT. Rather than sit on a dead
      // call, redirect to the turn-based TwiML so the call still works.
      console.warn('[MediaStream] Deepgram unavailable - downgrading to turn-based /twiml');
      this.downgradeToTurnBased();
    }
  }

  // ── inbound caller audio ─────────────────────────────────────────────────────

  handleMedia(data) {
    // Twilio media.payload is base64 mu-law (the SELLER's audio).
    const payload = data.media?.payload;
    if (!payload) return;
    const bytes = Buffer.from(payload, 'base64');
    if (this.dg) this.dg.send(bytes);          // → Deepgram STT
    if (this.listeners.size) this.broadcastAudio(bytes); // → live-listen (seller voice)
  }

  handleMark(data) {
    // Twilio echoes a mark only after the audio before it has actually played.
    // Decrement the pending count; when it hits zero the agent has finished speaking.
    if (data.mark?.name && this.pendingMarks > 0) {
      this.pendingMarks -= 1;
      if (this.pendingMarks === 0 && !this.ttsAbort) {
        this.agentSpeaking = false;
        this.armSilenceTimer();
      }
    }
  }

  // ── STT → turn logic ─────────────────────────────────────────────────────────

  onTranscript({ text, isFinal, speechFinal }) {
    if (this.ended || !text) return;

    // BARGE-IN: seller starts talking while the agent is speaking.
    if (this.agentSpeaking && this.wordCount(text) >= BARGE_IN_MIN_WORDS) {
      this.bargeIn();
    }

    if (isFinal) {
      this.finalBuffer = `${this.finalBuffer} ${text}`.trim();
      // speech_final is Deepgram's "end of utterance" - fire the turn now.
      if (speechFinal) this.fireTurn();
    }
    this.armSilenceTimer();
  }

  onUtteranceEnd() {
    // Fallback turn trigger when speech_final never fired but Deepgram decided the
    // utterance ended (utterance_end_ms). Only fire if we have buffered final words.
    if (this.finalBuffer) this.fireTurn();
  }

  async fireTurn() {
    if (this.turnInFlight || this.ended || this.muted) return;
    const heard = this.finalBuffer.trim();
    this.finalBuffer = '';
    if (!heard) return;

    this.turnInFlight = true;
    this.clearSilenceTimer();
    this.turnAbort = new AbortController();
    this.turnCount += 1;

    try {
      const { reply, end, emotion } = await voiceBrain.nextTurn({
        ...this.ctx,
        callId: this.callId,
        callSid: this.callSid,
        speech: heard,
        operator: this.ctx.operator,
        lead: this.ctx.lead,
        useCaseOverride: this.ctx.useCaseOverride || null,
      });

      // If a barge-in aborted this turn while the brain was thinking, drop the reply.
      if (this.turnAbort?.signal.aborted || this.ended) return;

      if (reply) await this.speak(reply, { emotion });
      if (end) return this.endCall();
    } catch (err) {
      console.warn('[MediaStream] nextTurn failed:', err.message);
      if (!this.ended) await this.speak("Sorry, I didn't quite catch that - could you say that again?");
    } finally {
      this.turnInFlight = false;
      if (!this.ended) this.armSilenceTimer();
    }
  }

  // ── agent audio out (ElevenLabs → Twilio) ────────────────────────────────────

  async speak(text, { emotion } = {}) {
    if (this.ended || !text) return;
    // Human pacing (breath/beat punctuation) - same treatment the turn-based
    // engine gives every line in v2voice.speakLine. Without it the stream engine
    // read raw model text: run-on, no beats, rushed asks.
    text = elevenLabs.humanizePacing(text);
    if (!text) return;
    this.agentSpeaking = true;
    this.ttsAbort = new AbortController();

    let carry = Buffer.alloc(0); // leftover bytes to keep frames exactly 160B

    const flushFrames = (buf, force = false) => {
      let combined = Buffer.concat([carry, buf]);
      let offset = 0;
      while (combined.length - offset >= TWILIO_FRAME_BYTES) {
        const frame = combined.subarray(offset, offset + TWILIO_FRAME_BYTES);
        this.sendTwilioMedia(frame.toString('base64'));
        offset += TWILIO_FRAME_BYTES;
      }
      carry = combined.subarray(offset);
      if (force && carry.length) {
        // Pad the final short frame with mu-law silence (0xFF) so Twilio plays it.
        const pad = Buffer.alloc(TWILIO_FRAME_BYTES - carry.length, 0xff);
        this.sendTwilioMedia(Buffer.concat([carry, pad]).toString('base64'));
        carry = Buffer.alloc(0);
      }
    };

    const ok = await elevenLabs.streamTts(text, {
      voiceId: this.ctx.voiceId,
      emotion: emotion || null,
      signal: this.ttsAbort.signal,
      onChunk: (b64) => {
        if (this.ttsAbort?.signal.aborted || this.ended) return;
        flushFrames(Buffer.from(b64, 'base64'));
      },
    });

    if (!this.ttsAbort?.signal.aborted && !this.ended) {
      flushFrames(Buffer.alloc(0), true); // flush the tail
      this.sendTwilioMark(`agent-utt-${this.turnCount}`);
    }
    this.ttsAbort = null;

    if (ok) this.everProducedAudio = true;

    if (!ok && !this.ended) {
      this.agentSpeaking = false;
      // streamTts produced nothing (no key / expired key / quota / socket error).
      // These failures are call-wide, not per-line - if this call has NEVER been
      // audible, "keep listening" means the seller hears permanent dead air (the
      // silent-call bug). Downgrade to the turn-based /twiml engine instead: its
      // speakLine falls back to Twilio <Say>, so the call is always audible.
      // Mid-call blips (audio worked before) keep the old behaviour: stay on the
      // stream and let the next turn retry.
      if (!this.everProducedAudio) {
        console.warn('[MediaStream] no audio ever produced - downgrading to turn-based /twiml so the call is not silent');
        return this.downgradeToTurnBased();
      }
      console.warn('[MediaStream] streamTts produced no audio for this line');
    }
  }

  bargeIn() {
    // Flush queued agent audio in Twilio, abort the TTS + the in-flight brain turn.
    this.sendTwilioClear();
    if (this.ttsAbort) this.ttsAbort.abort();
    if (this.turnAbort) this.turnAbort.abort();
    this.agentSpeaking = false;
    this.pendingMarks = 0;
  }

  // ── operator takeover (in-house equivalent of Vapi muteAssistant) ────────────

  /**
   * Silence the AI so a human operator can take over the line. Same primitives as
   * bargeIn (flush queued audio, abort any in-flight TTS/turn) plus it latches
   * `muted` so no NEW turn or silence-reprompt fires until unmuteAgent(). The
   * caller (seller) audio still flows to Deepgram + live-listen untouched.
   */
  muteAgent() {
    if (this.ended) return false;
    this.muted = true;
    this.clearSilenceTimer();
    this.sendTwilioClear();
    if (this.ttsAbort) this.ttsAbort.abort();
    if (this.turnAbort) this.turnAbort.abort();
    this.agentSpeaking = false;
    this.pendingMarks = 0;
    console.log(`[MediaStream] operator takeover - AI muted callId=${this.callId}`);
    return true;
  }

  /** Hand control back to the AI: clear the latch and resume normal listening. */
  unmuteAgent() {
    if (this.ended) return false;
    this.muted = false;
    this.finalBuffer = '';
    this.armSilenceTimer();
    console.log(`[MediaStream] operator returned control - AI unmuted callId=${this.callId}`);
    return true;
  }

  // ── Twilio WS control frames ─────────────────────────────────────────────────

  sendTwilioMedia(b64) {
    this.sendTwilio({ event: 'media', streamSid: this.streamSid, media: { payload: b64 } });
    // Mirror the AGENT's audio to any live-listeners so the operator hears both sides.
    if (this.listeners.size) this.broadcastAudio(Buffer.from(b64, 'base64'));
  }

  sendTwilioMark(name) {
    this.pendingMarks += 1;
    this.sendTwilio({ event: 'mark', streamSid: this.streamSid, mark: { name } });
  }

  sendTwilioClear() {
    this.sendTwilio({ event: 'clear', streamSid: this.streamSid });
  }

  sendTwilio(obj) {
    if (this.twilioWs.readyState === WebSocket.OPEN) {
      try {
        this.twilioWs.send(JSON.stringify(obj));
      } catch (err) {
        console.warn('[MediaStream] twilio send failed:', err.message);
      }
    }
  }

  // ── silence / inactivity ─────────────────────────────────────────────────────

  armSilenceTimer() {
    this.clearSilenceTimer();
    if (this.ended || this.muted) return; // muted = operator has the line; AI stays quiet
    this.silenceTimer = setTimeout(() => {
      // Seller went quiet - let the brain reprompt (empty speech), same as today.
      if (!this.ended && !this.turnInFlight && !this.agentSpeaking) {
        this.finalBuffer = '';
        this.fireTurnWithSilence();
      }
    }, SILENCE_NUDGE_MS);
  }

  clearSilenceTimer() {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  async fireTurnWithSilence() {
    if (this.turnInFlight || this.ended || this.muted) return;
    this.turnInFlight = true;
    this.turnAbort = new AbortController();
    try {
      const { reply, end, emotion } = await voiceBrain.nextTurn({
        ...this.ctx,
        callId: this.callId,
        callSid: this.callSid,
        speech: '', // silence - brain reprompts
        operator: this.ctx.operator,
        lead: this.ctx.lead,
      });
      if (this.turnAbort?.signal.aborted || this.ended) return;
      if (reply) await this.speak(reply, { emotion });
      if (end) return this.endCall();
    } catch (err) {
      console.warn('[MediaStream] silence turn failed:', err.message);
    } finally {
      this.turnInFlight = false;
      if (!this.ended) this.armSilenceTimer();
    }
  }

  // ── teardown ─────────────────────────────────────────────────────────────────

  async endCall() {
    if (this.ended) return;
    // Politely hang up the Twilio call (fires /status → scoreTwilioCall as today).
    if (this.callSid) {
      try {
        await twilioCallService.endCall(this.callSid);
      } catch (err) {
        console.warn('[MediaStream] endCall failed:', err.message);
      }
    }
    this.teardown();
  }

  /** Downgrade a call to the turn-based /twiml when streaming can't run. */
  async downgradeToTurnBased() {
    if (this.callSid) {
      try {
        await twilioCallService.redirectCall(this.callSid, `/api/v2/voice/twiml?callId=${this.callId || ''}`);
      } catch (err) {
        console.warn('[MediaStream] downgrade redirect failed:', err.message);
      }
    }
    this.teardown();
  }

  /** Idempotent close of all sockets + timers. Safe to call multiple times. */
  teardown() {
    if (this.ended) return;
    this.ended = true;
    this.clearSilenceTimer();
    if (this.ttsAbort) { try { this.ttsAbort.abort(); } catch (_) { /* noop */ } }
    if (this.turnAbort) { try { this.turnAbort.abort(); } catch (_) { /* noop */ } }
    if (this.dg) { try { this.dg.finish(); this.dg.close(); } catch (_) { /* noop */ } }
    try { if (this.twilioWs.readyState === WebSocket.OPEN) this.twilioWs.close(); } catch (_) { /* noop */ }
    // Close any live-listeners so their browser player stops cleanly (call over).
    for (const ws of this.listeners) { try { ws.close(); } catch (_) { /* noop */ } }
    this.listeners.clear();
    if (this.streamSid) sessions.delete(this.streamSid);
    if (this.callId && sessionsByCallId.get(this.callId) === this) sessionsByCallId.delete(this.callId);
    console.log(`[MediaStream] teardown streamSid=${this.streamSid}`);
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  wordCount(s) {
    return String(s || '').trim().split(/\s+/).filter(Boolean).length;
  }
}

/**
 * Authenticate + authorize a live-listen WebSocket upgrade, then attach the socket
 * to the matching live StreamSession. Rejects (destroys the socket) if the token is
 * bad, the call isn't the user's, or there's no live stream session for that call.
 *
 * URL: wss://host/api/v2/voice/listen?callId=<calls.id>&token=<jwt>
 */
async function handleListenUpgrade(url, req, socket, head, listenWss) {
  const callId = url.searchParams.get('callId');
  const token = url.searchParams.get('token');
  if (!callId || !token) { try { socket.destroy(); } catch (_) { /* noop */ } return; }

  // Verify JWT (same secret as the HTTP requireAuth middleware).
  let userId;
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    userId = decoded?.id || decoded?.user_id || decoded?.sub;
  } catch (_) {
    try { socket.destroy(); } catch (_) { /* noop */ }
    return;
  }
  if (!userId) { try { socket.destroy(); } catch (_) { /* noop */ } return; }

  // Confirm this call belongs to this user (ownership check).
  try {
    const supabase = require('../config/supabase');
    const { data: call } = await supabase.from('calls')
      .select('id, user_id')
      .eq('id', callId)
      .eq('user_id', userId)
      .single();
    if (!call) { try { socket.destroy(); } catch (_) { /* noop */ } return; }
  } catch (_) {
    try { socket.destroy(); } catch (_) { /* noop */ }
    return;
  }

  // Find the live streaming session for this call. If none, the call isn't on the
  // stream engine (or hasn't connected yet) - close cleanly; the browser retries.
  const session = sessionsByCallId.get(callId);
  if (!session || session.ended) { try { socket.destroy(); } catch (_) { /* noop */ } return; }

  listenWss.handleUpgrade(req, socket, head, (ws) => {
    session.addListener(ws);
    console.log(`[MediaStream] listener attached callId=${callId} user=${userId}`);
  });
}

/**
 * Attach the media-stream WebSocket server to an existing HTTP server.
 * Called once from index.js after http.createServer(app). Guards on the upgrade
 * path so only /api/v2/voice/media-stream connections are handled here.
 *
 * @param {import('http').Server} httpServer
 */
function attach(httpServer) {
  if (!httpServer) {
    console.warn('[MediaStream] attach called without an http server - skipping');
    return;
  }
  const wss = new WebSocket.Server({ noServer: true });        // Twilio media streams
  const listenWss = new WebSocket.Server({ noServer: true });  // operator live-listen

  httpServer.on('upgrade', (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch (_) {
      return; // malformed - let other handlers / default deal with it
    }
    const pathname = url.pathname;

    if (pathname === MEDIA_STREAM_PATH) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
      return;
    }

    if (pathname === LISTEN_PATH) {
      // Live-listen: operator browser subscribing to a call's audio. Authenticate
      // from the query token and confirm the call belongs to this user BEFORE
      // attaching, so no one can listen to a call that isn't theirs.
      handleListenUpgrade(url, req, socket, head, listenWss).catch((err) => {
        console.warn('[MediaStream] listen upgrade failed:', err.message);
        try { socket.destroy(); } catch (_) { /* noop */ }
      });
      return;
    }
    // not ours - leave it alone
  });

  wss.on('connection', (ws) => {
    const session = new StreamSession(ws);

    ws.on('message', (raw) => {
      let data;
      try {
        data = JSON.parse(raw.toString());
      } catch (_) {
        return; // Twilio always sends JSON text frames on this socket
      }
      switch (data.event) {
        case 'connected':
          break; // protocol handshake - nothing to do
        case 'start':
          session.handleStart(data);
          break;
        case 'media':
          session.handleMedia(data);
          break;
        case 'mark':
          session.handleMark(data);
          break;
        case 'stop':
          session.teardown();
          break;
        default:
          break; // ignore dtmf/unknown for v1
      }
    });

    ws.on('close', () => session.teardown());
    ws.on('error', (err) => {
      console.warn('[MediaStream] twilio ws error:', err.message);
      session.teardown();
    });
  });

  console.log(`[MediaStream] WebSocket server attached at ${MEDIA_STREAM_PATH} (+ live-listen at ${LISTEN_PATH})`);
  return wss;
}

/** True if a live streaming session exists for this calls.id (used by the listen route). */
function hasLiveSession(callId) {
  const s = sessionsByCallId.get(callId);
  return !!(s && !s.ended);
}

/**
 * Silence the AI on a live stream call so a human operator can take over.
 * Returns true if a live session was found and muted, false otherwise (so the
 * caller can fall back to the Vapi path for legacy calls).
 */
function muteSession(callId) {
  const s = sessionsByCallId.get(callId);
  return s && !s.ended ? s.muteAgent() : false;
}

/** Hand the live stream call back to the AI. Returns true if a session was unmuted. */
function unmuteSession(callId) {
  const s = sessionsByCallId.get(callId);
  return s && !s.ended ? s.unmuteAgent() : false;
}

module.exports = {
  attach, StreamSession, MEDIA_STREAM_PATH, LISTEN_PATH, sessions, sessionsByCallId,
  hasLiveSession, muteSession, unmuteSession, mulawToPcm16,
};
