/**
 * Ambience Service - background room/office ambience for live calls + previews.
 *
 * WHY: studio TTS is dead-silent between and behind words, and that sterile
 * silence is one of the biggest "this is a robot" tells on a phone line. A real
 * caller sits in a room: faint HVAC hum, muffled co-workers, tiny movement.
 * This service maintains ONE shared, loopable ambience bed (8 kHz mono PCM16)
 * and lets each live StreamSession mix it into the call:
 *   - between agent utterances (idle bed frames, full VOICE_AMBIENCE_GAIN)
 *   - underneath agent speech (ducked to VOICE_AMBIENCE_TALK_GAIN so the words
 *     stay perfectly clear - present, never competing)
 * The SAME bed is mixed into voice-picker previews (mixPreviewPcm16) so what an
 * operator hears in Settings is what a seller hears on the phone.
 *
 * BED SOURCE CHAIN (first that works wins; never throws, never blocks a call):
 *   1. VOICE_AMBIENCE_URL        - operator-supplied WAV (PCM16) or raw file.
 *   2. Supabase Storage cache    - ambience/bed-amb1-pcm16-8k.raw (written by 3).
 *   3. ElevenLabs sound-generation API - generated once from
 *      VOICE_AMBIENCE_PROMPT, then cached to Storage so it's billed ~once ever.
 *   4. Procedural room tone      - filtered noise with a slow "murmur" swell.
 *      Always succeeds, so ambience can never hard-fail a call.
 * The bed is RMS-normalised and loop-crossfaded (~200 ms) so it plays seamless
 * forever. Loading is async + lazy: the first call kicks it off; until it's
 * ready, sessions simply get no bed (silence), exactly like today.
 *
 * ENV KNOBS (all live-tunable on Railway, no redeploy):
 *   VOICE_AMBIENCE            on|off (default on). off → every API is a no-op.
 *   VOICE_AMBIENCE_URL        https URL to a custom bed (WAV PCM16 or raw ulaw/pcm).
 *   VOICE_AMBIENCE_PROMPT     sound-generation prompt for source 3.
 *   VOICE_AMBIENCE_GAIN       idle bed level multiplier (default 1.0).
 *   VOICE_AMBIENCE_TALK_GAIN  bed level under speech (default 0.45 - ducked).
 *   VOICE_AMBIENCE_RMS        normalisation target RMS in int16 units (default 850,
 *                             ≈ -32 dBFS: clearly there, never louder than words).
 *
 * ADDITIVE + INERT: nothing runs unless a caller invokes it, and VOICE_AMBIENCE=off
 * restores byte-identical behaviour everywhere.
 */

const axios = require('axios');
const supabase = require('../config/supabase');

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_API_URL = process.env.ELEVENLABS_API_URL || 'https://api.elevenlabs.io/v1';

// Same public bucket the TTS clips + previews live in (read directly from env to
// avoid a require cycle with elevenLabsService, which requires this file).
const BUCKET = process.env.ELEVENLABS_TTS_BUCKET || 'voice-previews';
const BED_CACHE_PATH = 'ambience/bed-amb1-pcm16-8k.raw';

const envFloat = (name, fallback) => {
  const v = parseFloat(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
};

const AMB_IDLE_GAIN = envFloat('VOICE_AMBIENCE_GAIN', 1.0);
const AMB_TALK_GAIN = envFloat('VOICE_AMBIENCE_TALK_GAIN', 0.45);
const AMB_TARGET_RMS = envFloat('VOICE_AMBIENCE_RMS', 850);

// Office-room prompt: steady + loopable by construction (no one-off events that
// would give the loop away), faint human presence per the product requirement
// ("humans talking in background... so it sounds more human").
const AMB_PROMPT = process.env.VOICE_AMBIENCE_PROMPT
  || 'Quiet open-plan office room tone: soft air-conditioning hum, very faint muffled '
   + 'conversations of a few coworkers in the distance, occasional gentle keyboard typing. '
   + 'Steady and consistent, no music, no phones ringing, no sudden loud sounds, seamless loop.';

const SAMPLE_RATE = 8000;          // telephony rate - matches Twilio mu-law frames
const FRAME_SAMPLES = 160;         // 20ms @ 8kHz (Twilio media frame)
const BED_SECONDS = 20;            // generated/procedural bed length before crossfade

/** Feature gate. off → every public API becomes a cheap no-op. */
function enabled() {
  return (process.env.VOICE_AMBIENCE || 'on').toLowerCase() !== 'off';
}

// ── G.711 mu-law codec (pure math, no deps) ──────────────────────────────────

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

const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

/** Encode one 16-bit linear sample to a mu-law byte (standard G.711). */
function pcm16ToMulawSample(sample) {
  let s = sample;
  const sign = s < 0 ? 0x80 : 0;
  if (sign) s = -s;
  if (s > MULAW_CLIP) s = MULAW_CLIP;
  s += MULAW_BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; exponent -= 1, mask >>= 1) { /* scan */ }
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

const clamp16 = (n) => Math.max(-32768, Math.min(32767, n | 0));

// ── bed construction helpers ─────────────────────────────────────────────────

/** Downmix + resample an Int16Array to 8kHz mono via span averaging. */
function resampleTo8k(int16, srcRate) {
  if (srcRate === SAMPLE_RATE) return int16;
  const ratio = srcRate / SAMPLE_RATE;
  const outLen = Math.floor(int16.length / ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.max(start + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end && j < int16.length; j++) sum += int16[j];
    out[i] = clamp16(sum / (end - start));
  }
  return out;
}

/**
 * Minimal WAV (RIFF) parser - PCM16 only. Returns Int16Array mono @8k or null.
 * Deliberately strict + throw-free: anything unexpected → null (next source).
 */
function parseWavTo8kMono(buf) {
  try {
    if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
    let pos = 12;
    let fmt = null;
    let data = null;
    while (pos + 8 <= buf.length) {
      const id = buf.toString('ascii', pos, pos + 4);
      const size = buf.readUInt32LE(pos + 4);
      const body = pos + 8;
      if (id === 'fmt ') {
        fmt = {
          audioFormat: buf.readUInt16LE(body),
          channels: buf.readUInt16LE(body + 2),
          sampleRate: buf.readUInt32LE(body + 4),
          bitsPerSample: buf.readUInt16LE(body + 14),
        };
      } else if (id === 'data') {
        data = buf.subarray(body, Math.min(body + size, buf.length));
      }
      pos = body + size + (size % 2); // chunks are word-aligned
    }
    if (!fmt || !data || fmt.audioFormat !== 1 || fmt.bitsPerSample !== 16 || fmt.channels < 1) return null;
    const frames = Math.floor(data.length / 2 / fmt.channels);
    const mono = new Int16Array(frames);
    for (let i = 0; i < frames; i++) {
      let sum = 0;
      for (let c = 0; c < fmt.channels; c++) sum += data.readInt16LE((i * fmt.channels + c) * 2);
      mono[i] = clamp16(sum / fmt.channels);
    }
    return resampleTo8k(mono, fmt.sampleRate);
  } catch (_e) {
    return null;
  }
}

/** Normalise the bed to the target RMS (cap the boost so near-silence can't blow up). */
function normaliseRms(int16, targetRms) {
  let sumSq = 0;
  for (let i = 0; i < int16.length; i++) sumSq += int16[i] * int16[i];
  const rms = Math.sqrt(sumSq / Math.max(1, int16.length));
  if (!Number.isFinite(rms) || rms <= 0) return int16;
  const scale = Math.min(8, targetRms / rms);
  const out = new Int16Array(int16.length);
  for (let i = 0; i < int16.length; i++) out[i] = clamp16(int16[i] * scale);
  return out;
}

/** Crossfade the tail into the head (~200ms) so the loop point is seamless. */
function loopCrossfade(int16) {
  const N = Math.min(FRAME_SAMPLES * 10, Math.floor(int16.length / 4)); // ≤200ms
  if (N < 8) return int16;
  const len = int16.length;
  const out = new Int16Array(len - N);
  for (let i = 0; i < N; i++) {
    const t = i / N;
    out[i] = clamp16(int16[i] * t + int16[len - N + i] * (1 - t));
  }
  for (let i = N; i < len - N; i++) out[i] = int16[i];
  return out;
}

/**
 * Procedural room tone: leaky-integrated (brown-ish) noise, dominated by low
 * frequencies like real HVAC/room rumble, with a slow multi-LFO "murmur" swell
 * that reads as distant activity. Never fails - the guaranteed fallback.
 */
function proceduralBed() {
  const len = SAMPLE_RATE * BED_SECONDS;
  const out = new Int16Array(len);
  let v = 0;
  const p1 = Math.random() * Math.PI * 2;
  const p2 = Math.random() * Math.PI * 2;
  const p3 = Math.random() * Math.PI * 2;
  for (let i = 0; i < len; i++) {
    // brown-ish noise: integrate white noise with a leak so it can't wander off.
    v = v * 0.995 + (Math.random() * 2 - 1) * 220;
    const t = i / SAMPLE_RATE;
    // slow, incommensurate LFOs → non-repeating swell (distant-chatter feel).
    const swell = 0.72
      + 0.14 * Math.sin(2 * Math.PI * 0.13 * t + p1)
      + 0.09 * Math.sin(2 * Math.PI * 0.047 * t + p2)
      + 0.05 * Math.sin(2 * Math.PI * 0.31 * t + p3);
    out[i] = clamp16(v * swell);
  }
  return out;
}

// ── bed source chain ─────────────────────────────────────────────────────────

/** Source 1: operator-supplied URL (WAV PCM16, raw mu-law, or raw PCM16 @8k). */
async function bedFromUrl() {
  const url = process.env.VOICE_AMBIENCE_URL;
  if (!url) return null;
  try {
    const { data } = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
    const buf = Buffer.from(data);
    const wav = parseWavTo8kMono(buf);
    if (wav) return wav;
    if (/\.(ulaw|ul|mulaw)(\?|$)/i.test(url)) {
      const out = new Int16Array(buf.length);
      for (let i = 0; i < buf.length; i++) out[i] = MULAW_DECODE[buf[i]];
      return out;
    }
    if (/\.(raw|pcm)(\?|$)/i.test(url) && buf.length >= 2) {
      return new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
    }
    console.warn('[Ambience] VOICE_AMBIENCE_URL fetched but not a supported format (WAV PCM16 / .ulaw / .raw)');
    return null;
  } catch (err) {
    console.warn('[Ambience] VOICE_AMBIENCE_URL fetch failed:', err.message);
    return null;
  }
}

/** Source 2: previously generated bed cached in Supabase Storage (raw PCM16 @8k). */
async function bedFromStorageCache() {
  try {
    const { data, error } = await supabase.storage.from(BUCKET).download(BED_CACHE_PATH);
    if (error || !data) return null;
    const buf = Buffer.from(await data.arrayBuffer());
    if (buf.length < SAMPLE_RATE) return null; // <0.5s of audio → junk
    return new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
  } catch (_e) {
    return null;
  }
}

/**
 * Source 3: generate the bed once via the ElevenLabs sound-generation API, then
 * cache it to Storage so it is billed ~once for the lifetime of the product.
 * Requests pcm_16000 (downsampled to 8k here); an MP3 response (plan doesn't
 * honour output_format) is detected and discarded → procedural fallback.
 */
async function bedFromSoundGeneration() {
  if (!ELEVENLABS_API_KEY) return null;
  try {
    const { data } = await axios.post(
      `${ELEVENLABS_API_URL}/sound-generation`,
      { text: AMB_PROMPT, duration_seconds: BED_SECONDS, prompt_influence: 0.3 },
      {
        headers: { 'xi-api-key': ELEVENLABS_API_KEY },
        params: { output_format: 'pcm_16000' },
        responseType: 'arraybuffer',
        timeout: 60000,
      },
    );
    const buf = Buffer.from(data);
    if (buf.length < 4) return null;
    const isMp3 = (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33)      // 'ID3'
      || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0 && buf.length < SAMPLE_RATE * 4); // mp3 sync + too small for pcm
    if (isMp3) {
      console.warn('[Ambience] sound-generation returned MP3 (output_format not honoured) - skipping');
      return null;
    }
    const pcm16k = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
    const pcm8k = resampleTo8k(pcm16k, 16000);

    // Best-effort cache so future boots use source 2 and never re-bill.
    try {
      const raw = Buffer.from(pcm8k.buffer, pcm8k.byteOffset, pcm8k.length * 2);
      await supabase.storage.from(BUCKET).upload(BED_CACHE_PATH, raw, {
        contentType: 'application/octet-stream',
        upsert: true,
      });
    } catch (err) {
      console.warn('[Ambience] bed cache upload failed (will regenerate next boot):', err.message);
    }
    return pcm8k;
  } catch (err) {
    const detail = err.response?.status ? `HTTP ${err.response.status}` : err.message;
    console.warn('[Ambience] sound-generation failed:', detail);
    return null;
  }
}

async function loadBed() {
  let raw = await bedFromUrl();
  if (!raw) raw = await bedFromStorageCache();
  if (!raw) raw = await bedFromSoundGeneration();
  let source = 'custom-url';
  if (!raw) { raw = proceduralBed(); source = 'procedural'; }
  else if (raw.length && !process.env.VOICE_AMBIENCE_URL) source = 'generated/cached';
  const bed = loopCrossfade(normaliseRms(raw, AMB_TARGET_RMS));
  console.log(`[Ambience] bed ready: ${(bed.length / SAMPLE_RATE).toFixed(1)}s @8k (source: ${source})`);
  return bed;
}

// Shared bed state: loaded once per process, shared by every session + preview.
let bedPromise = null;
let bed = null;

/** Kick off (or join) the shared bed load. Resolves to Int16Array (never rejects). */
function ensureBed() {
  if (!enabled()) return Promise.resolve(null);
  if (!bedPromise) {
    bedPromise = loadBed()
      .then((b) => { bed = b; return b; })
      .catch((err) => {
        // loadBed shouldn't reject (procedural always succeeds) - belt & braces.
        console.warn('[Ambience] bed load failed, ambience disabled this boot:', err.message);
        return null;
      });
  }
  return bedPromise;
}

// ── per-session cursor (live calls) ──────────────────────────────────────────

/**
 * Create a per-call ambience cursor. One cursor per StreamSession; all frames a
 * session sends (idle bed + bed-under-speech) advance the SAME cursor, so the
 * room sounds continuous across the whole call. Starts at a random offset so two
 * concurrent calls never play the identical room.
 */
function createCursor() {
  ensureBed(); // lazy shared load - first call in a boot pays the (async) cost
  let pos = -1; // randomised on first use, once the bed exists

  const advance = () => {
    if (pos < 0) pos = Math.floor(Math.random() * bed.length);
    const start = pos;
    pos = (pos + FRAME_SAMPLES) % bed.length;
    return start;
  };

  return {
    /**
     * Next 20ms of bed alone as a 160-byte mu-law frame (idle - no speech).
     * Returns null while the bed is still loading or ambience is off.
     */
    nextFrameUlaw(gain = AMB_IDLE_GAIN) {
      if (!enabled() || !bed) return null;
      const start = advance();
      const out = Buffer.allocUnsafe(FRAME_SAMPLES);
      for (let i = 0; i < FRAME_SAMPLES; i++) {
        out[i] = pcm16ToMulawSample(clamp16(bed[(start + i) % bed.length] * gain));
      }
      return out;
    },

    /**
     * Mix the (ducked) bed under one 160-byte mu-law TTS frame. Decode → sum in
     * linear PCM → re-encode. Bed missing/off → the frame passes through untouched.
     */
    mixTtsFrame(ulawFrame, gain = AMB_TALK_GAIN) {
      if (!enabled() || !bed || !ulawFrame || !ulawFrame.length) return ulawFrame;
      const start = advance();
      const out = Buffer.allocUnsafe(ulawFrame.length);
      for (let i = 0; i < ulawFrame.length; i++) {
        const speech = MULAW_DECODE[ulawFrame[i]];
        const amb = bed[(start + i) % bed.length] * gain;
        out[i] = pcm16ToMulawSample(clamp16(speech + amb));
      }
      return out;
    },
  };
}

// ── preview helpers (voice picker parity) ────────────────────────────────────

/**
 * Mix the ambience bed under a PCM16LE mono voice clip (any 8k-multiple rate),
 * with a short bed-only lead-in and tail so the preview opens like a real call
 * ("room first, then the voice"). Bed unavailable/off → returns the input as-is.
 *
 * @param {Buffer} voicePcm    PCM16LE mono voice audio
 * @param {number} sampleRate  e.g. 16000 (must be a multiple of 8000)
 * @param {object} [opts]      { leadMs, tailMs, gain, talkGain }
 * @returns {Promise<Buffer>}  PCM16LE mono at the same sampleRate
 */
async function mixPreviewPcm16(voicePcm, sampleRate, opts = {}) {
  const b = await ensureBed();
  if (!b || !voicePcm || voicePcm.length < 2 || sampleRate % SAMPLE_RATE !== 0) return voicePcm;

  const ratio = sampleRate / SAMPLE_RATE;                  // bed upsample factor
  const leadMs = Number.isFinite(opts.leadMs) ? opts.leadMs : 350;
  const tailMs = Number.isFinite(opts.tailMs) ? opts.tailMs : 450;
  const idleGain = Number.isFinite(opts.gain) ? opts.gain : AMB_IDLE_GAIN;
  const talkGain = Number.isFinite(opts.talkGain) ? opts.talkGain : AMB_TALK_GAIN;

  const voiceSamples = Math.floor(voicePcm.length / 2);
  const leadSamples = Math.floor((leadMs / 1000) * sampleRate);
  const tailSamples = Math.floor((tailMs / 1000) * sampleRate);
  const total = leadSamples + voiceSamples + tailSamples;
  const out = Buffer.allocUnsafe(total * 2);

  const bedStart = Math.floor(Math.random() * b.length);
  const fadeIn = Math.min(leadSamples, Math.floor(0.1 * sampleRate));   // 100ms
  const fadeOut = Math.min(tailSamples, Math.floor(0.15 * sampleRate)); // 150ms

  for (let i = 0; i < total; i++) {
    // nearest-neighbour upsample of the noise bed - transparent for room tone.
    const amb = b[(bedStart + Math.floor(i / ratio)) % b.length];
    let sample;
    if (i < leadSamples) {
      const fade = fadeIn > 0 ? Math.min(1, i / fadeIn) : 1;
      sample = amb * idleGain * fade;
    } else if (i < leadSamples + voiceSamples) {
      sample = voicePcm.readInt16LE((i - leadSamples) * 2) + amb * talkGain;
    } else {
      const left = total - i;
      const fade = fadeOut > 0 ? Math.min(1, left / fadeOut) : 1;
      sample = amb * idleGain * fade;
    }
    out.writeInt16LE(clamp16(sample), i * 2);
  }
  return out;
}

/** Wrap raw PCM16LE mono in a standard 44-byte WAV header (browser-playable). */
function pcm16ToWav(pcmBuf, sampleRate) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcmBuf.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);               // fmt chunk size
  header.writeUInt16LE(1, 20);                // PCM
  header.writeUInt16LE(1, 22);                // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);   // byte rate
  header.writeUInt16LE(2, 32);                // block align
  header.writeUInt16LE(16, 34);               // bits per sample
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcmBuf.length, 40);
  return Buffer.concat([header, pcmBuf]);
}

module.exports = {
  enabled,
  ensureBed,
  createCursor,
  mixPreviewPcm16,
  pcm16ToWav,
};
