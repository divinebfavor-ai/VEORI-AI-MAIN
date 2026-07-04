/**
 * Deepgram Stream Service - real-time streaming STT for the v2 "stream" calling
 * engine (Twilio Media Streams pipeline).
 *
 * This is a thin, dependency-free wrapper around a single Deepgram streaming
 * WebSocket. It uses the raw `ws` package (already installed) rather than
 * @deepgram/sdk so we add NO new npm dependency. It is used ONLY by the new
 * mediaStreamServer.js - nothing existing imports it, so it is inert until the
 * VOICE_ENGINE=stream flag routes a call through the streaming path.
 *
 * AUDIO CONTRACT (zero transcoding): Twilio Media Streams deliver mu-law (PCMU)
 * 8kHz base64 audio. We open Deepgram with encoding=mulaw & sample_rate=8000, so
 * the raw decoded bytes go straight in - no resampling/transcoding on our side.
 *
 * Deepgram live transcription reference:
 *   https://developers.deepgram.com/docs/live-streaming-audio
 * Query params we use:
 *   encoding=mulaw            - matches Twilio's PCMU
 *   sample_rate=8000          - telephony rate
 *   model=nova-2              - same model Vapi already used (proven quality)
 *   interim_results=true      - needed for barge-in (early partials)
 *   endpointing=300           - ms of silence to mark end of a spoken segment
 *   utterance_end_ms=1000     - emits an UtteranceEnd event as a turn fallback
 *   punctuate=true            - cleaner transcript for the brain + scoring
 *   smart_format=true         - numbers/dates formatted naturally
 *
 * PUBLIC SHAPE (event-emitter style, no external EventEmitter dep):
 *   const dg = createDeepgramStream({ onTranscript, onUtteranceEnd, onOpen, onClose, onError });
 *   dg.send(muLawBuffer)   - forward one chunk of caller audio (Buffer)
 *   dg.finish()            - politely flush + close (sends CloseStream)
 *   dg.close()             - hard close the socket
 *   dg.isOpen()            - boolean
 *
 * onTranscript payload: { text, isFinal, speechFinal, confidence }
 *   - isFinal      → Deepgram marked this segment final (is_final)
 *   - speechFinal  → Deepgram detected end-of-speech (speech_final) - fire a turn
 *
 * RESILIENCE: every callback is wrapped so a caller bug never crashes the socket
 * handler; JSON parse errors are swallowed with a warning. The caller
 * (mediaStreamServer) owns reconnect/downgrade policy - this file just reports
 * open/close/error truthfully.
 */

const WebSocket = require('ws');

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const DEEPGRAM_WS_BASE = process.env.DEEPGRAM_WS_URL || 'wss://api.deepgram.com/v1/listen';

// Tunables (env-overridable so live behavior can be nudged without a redeploy).
const DG_MODEL = process.env.DEEPGRAM_MODEL || 'nova-2';
const DG_ENDPOINTING_MS = process.env.DEEPGRAM_ENDPOINTING_MS || '300';
const DG_UTTERANCE_END_MS = process.env.DEEPGRAM_UTTERANCE_END_MS || '1000';

/** Build the fully-parameterised Deepgram live URL for telephony mu-law audio. */
function buildUrl() {
  const u = new URL(DEEPGRAM_WS_BASE);
  u.searchParams.set('encoding', 'mulaw');
  u.searchParams.set('sample_rate', '8000');
  u.searchParams.set('channels', '1');
  u.searchParams.set('model', DG_MODEL);
  u.searchParams.set('interim_results', 'true');
  u.searchParams.set('endpointing', String(DG_ENDPOINTING_MS));
  u.searchParams.set('utterance_end_ms', String(DG_UTTERANCE_END_MS));
  u.searchParams.set('punctuate', 'true');
  u.searchParams.set('smart_format', 'true');
  return u.toString();
}

/** Safe callback runner - a handler throwing must never take down the socket. */
function safe(fn, ...args) {
  if (typeof fn !== 'function') return;
  try {
    fn(...args);
  } catch (err) {
    console.warn('[Deepgram] handler threw:', err.message);
  }
}

/**
 * Open a Deepgram streaming session.
 *
 * @param {object}   handlers
 * @param {function} [handlers.onOpen]          () => void - socket ready for audio
 * @param {function} [handlers.onTranscript]    ({text,isFinal,speechFinal,confidence}) => void
 * @param {function} [handlers.onUtteranceEnd]  ({lastWordEnd}) => void - turn fallback
 * @param {function} [handlers.onClose]         (code, reason) => void
 * @param {function} [handlers.onError]         (err) => void
 * @returns {{ send:Function, finish:Function, close:Function, isOpen:Function }}
 */
function createDeepgramStream(handlers = {}) {
  const { onOpen, onTranscript, onUtteranceEnd, onClose, onError } = handlers;

  if (!DEEPGRAM_API_KEY) {
    // No key → return a no-op stub so the caller can decide to downgrade the call
    // to the turn-based engine instead of crashing. Loud so it's obvious in logs.
    console.warn('[Deepgram] DEEPGRAM_API_KEY not set - STT stream is a no-op stub');
    return {
      send: () => {},
      finish: () => {},
      close: () => {},
      isOpen: () => false,
      unavailable: true,
    };
  }

  let ws;
  try {
    ws = new WebSocket(buildUrl(), {
      headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` },
    });
  } catch (err) {
    console.warn('[Deepgram] failed to construct socket:', err.message);
    safe(onError, err);
    return { send: () => {}, finish: () => {}, close: () => {}, isOpen: () => false };
  }

  ws.on('open', () => {
    console.log('[Deepgram] stream open');
    safe(onOpen);
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (err) {
      console.warn('[Deepgram] non-JSON message:', err.message);
      return;
    }

    // UtteranceEnd is a top-level event (not a Results channel) - used as a
    // reliable turn-end fallback when speech_final doesn't fire.
    if (msg.type === 'UtteranceEnd') {
      safe(onUtteranceEnd, { lastWordEnd: msg.last_word_end });
      return;
    }

    // Standard streaming transcript results.
    if (msg.type === 'Results' || msg.channel) {
      const alt = msg.channel?.alternatives?.[0];
      const text = (alt?.transcript || '').trim();
      // Deepgram sends empty inter.im frames constantly; skip the truly empty ones.
      if (!text) return;
      safe(onTranscript, {
        text,
        isFinal: Boolean(msg.is_final),
        speechFinal: Boolean(msg.speech_final),
        confidence: typeof alt?.confidence === 'number' ? alt.confidence : null,
      });
    }
  });

  ws.on('close', (code, reasonBuf) => {
    const reason = reasonBuf ? reasonBuf.toString() : '';
    console.log(`[Deepgram] stream closed code=${code} reason=${reason}`);
    safe(onClose, code, reason);
  });

  ws.on('error', (err) => {
    console.warn('[Deepgram] socket error:', err.message);
    safe(onError, err);
  });

  return {
    /** Forward one chunk of raw mu-law caller audio (Buffer). Dropped if not open. */
    send(buf) {
      if (ws.readyState === WebSocket.OPEN && buf && buf.length) {
        try {
          ws.send(buf);
        } catch (err) {
          console.warn('[Deepgram] send failed:', err.message);
        }
      }
    },
    /** Politely flush + close: send Deepgram's CloseStream control frame. */
    finish() {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'CloseStream' }));
        } catch (err) {
          console.warn('[Deepgram] finish failed:', err.message);
        }
      }
    },
    /** Hard close the socket (teardown). Idempotent. */
    close() {
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      } catch (err) {
        console.warn('[Deepgram] close failed:', err.message);
      }
    },
    isOpen() {
      return ws.readyState === WebSocket.OPEN;
    },
  };
}

module.exports = { createDeepgramStream, buildUrl };
