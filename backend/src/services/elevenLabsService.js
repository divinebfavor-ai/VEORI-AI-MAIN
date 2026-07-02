/**
 * ElevenLabs Service — voice catalog for the Twilio + ElevenLabs calling layer.
 *
 * Module 1 of the Vapi -> Twilio + ElevenLabs reroute. This file ONLY handles the
 * voice library (fetch from ElevenLabs, normalise, read/write veori_voice_library).
 * Text-to-speech for voicemail drops and live audio is added in later modules.
 *
 * Field shapes follow the official ElevenLabs API (GET /v1/voices):
 *   voices[]: { voice_id, name, preview_url, description, labels: { gender, accent, ... } }
 * Source: https://elevenlabs.io/docs/api-reference/voices/get
 */

const axios = require('axios');
const supabase = require('../config/supabase');

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_API_URL = process.env.ELEVENLABS_API_URL || 'https://api.elevenlabs.io/v1';

/** Lazily built axios client — only when a key is present (mirrors smsService Twilio pattern). */
function getClient() {
  if (!ELEVENLABS_API_KEY) return null;
  return axios.create({
    baseURL: ELEVENLABS_API_URL,
    headers: { 'xi-api-key': ELEVENLABS_API_KEY },
    timeout: 20000,
  });
}

/**
 * Normalise one raw ElevenLabs voice object into our library row shape.
 * Reads gender/accent/description out of the `labels` map (ElevenLabs puts them there),
 * falling back to the top-level `description` field when present.
 */
function normaliseVoice(v) {
  const labels = v.labels || {};
  return {
    voice_id:          v.voice_id,
    voice_name:        v.name || 'Unnamed',
    voice_preview_url: v.preview_url || null,
    voice_gender:      labels.gender || null,
    voice_accent:      labels.accent || null,
    // ElevenLabs uses either `description` (top level) or labels.description/descriptive.
    voice_description: v.description || labels.description || labels.descriptive || labels.use_case || null,
  };
}

/**
 * Fetch all voices straight from the ElevenLabs API (normalised).
 * Returns [] if no API key configured (so the app never crashes on a missing key).
 * @returns {Promise<Array>}
 */
async function fetchVoicesFromApi() {
  const client = getClient();
  if (!client) {
    console.warn('[ElevenLabs] ELEVENLABS_API_KEY not set — returning empty voice list');
    return [];
  }
  const { data } = await client.get('/voices');
  const voices = Array.isArray(data?.voices) ? data.voices : [];
  return voices.map(normaliseVoice).filter((v) => v.voice_id);
}

/**
 * Return the voice library that operators choose from.
 * Reads the cached veori_voice_library table first (fast, no API spend). If the
 * table is empty, falls back to a live API fetch so the picker is never blank.
 * @returns {Promise<Array>}
 */
async function getVoiceLibrary() {
  const { data, error } = await supabase
    .from('veori_voice_library')
    .select('voice_id, voice_name, voice_preview_url, voice_gender, voice_accent, voice_description, voice_rank')
    .eq('is_active', true)
    // Rank order first (lower = more human / shown first). NULLs sort last so an
    // un-ranked voice never jumps to the top; ties fall back to name for stability.
    .order('voice_rank', { ascending: true, nullsFirst: false })
    .order('voice_name', { ascending: true });

  if (error) {
    console.warn('[ElevenLabs] voice_library read failed, falling back to live API:', error.message);
    return fetchVoicesFromApi();
  }
  if (!data || data.length === 0) {
    // Library not seeded yet — pull live so the UI still shows voices.
    return fetchVoicesFromApi();
  }
  return data;
}

/**
 * Backfill preview media onto the voices ALREADY in veori_voice_library.
 *
 * NAME-PRESERVING BY DESIGN: this only writes voice_preview_url / voice_accent /
 * voice_description onto rows whose voice_id already exists in the library. It
 * NEVER touches voice_name (operators keep their custom names like Matt/Vexa) and
 * NEVER touches is_active (retired stock voices stay retired; it will not
 * resurrect them). Voices in the ElevenLabs account that aren't in the library
 * are ignored — so a full sync can't flood the picker with stock voices again.
 *
 * WHY: the library is seeded with real voice_ids but NULL preview_url. The ▶
 * Preview button needs a real clip. This reads the live ElevenLabs catalog (which
 * has the real preview_url per voice) and stamps it onto the matching rows.
 *
 * Runs on Railway (which holds ELEVENLABS_API_KEY). Returns { synced, voices }.
 */
async function syncVoiceLibrary() {
  const voices = await fetchVoicesFromApi();
  if (voices.length === 0) {
    return { synced: 0, voices: [], note: 'No voices fetched (missing key or empty API response)' };
  }

  // Which voice_ids are already in our library? Only those get backfilled.
  const { data: existing, error: existErr } = await supabase
    .from('veori_voice_library')
    .select('voice_id');
  if (existErr) throw new Error(`voice_library read failed: ${existErr.message}`);
  const known = new Set((existing || []).map((r) => r.voice_id));

  const targets = voices.filter((v) => known.has(v.voice_id));
  if (targets.length === 0) {
    return { synced: 0, voices, note: 'No catalog voice matched an existing library row' };
  }

  // Per-voice UPDATE of preview media ONLY — never voice_name, never is_active.
  let synced = 0;
  for (const v of targets) {
    const patch = { updated_at: new Date().toISOString() };
    if (v.voice_preview_url) patch.voice_preview_url = v.voice_preview_url;
    if (v.voice_accent)      patch.voice_accent = v.voice_accent;
    if (v.voice_description) patch.voice_description = v.voice_description;

    const { error } = await supabase
      .from('veori_voice_library')
      .update(patch)
      .eq('voice_id', v.voice_id);
    if (error) throw new Error(`voice_library backfill failed for ${v.voice_id}: ${error.message}`);
    synced += 1;
  }

  return { synced, voices: targets };
}

/**
 * Resolve the ElevenLabs voice_id to use for a given operator.
 * Priority: veori_operator_voice_settings.selected_voice_id
 *        -> ELEVENLABS_VOICE_ID env
 *        -> DEFAULT_VOICE_ID (warm 'Brian', never null — avoids the robotic
 *           Polly fallback when no voice is configured).
 * Read-only helper used by the call engine in later modules.
 */
async function resolveOperatorVoiceId(operatorId) {
  if (!operatorId) return process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;

  const { data: settings } = await supabase
    .from('veori_operator_voice_settings')
    .select('selected_voice_id')
    .eq('operator_id', operatorId)
    .maybeSingle();

  if (settings?.selected_voice_id) return settings.selected_voice_id;
  return process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
}

// Default ElevenLabs model + voice settings for phone-call TTS.
// eleven_multilingual_v2 is markedly more human/expressive than the flat
// eleven_turbo_v2_5 — it removes the robotic, monotone timbre while keeping
// telephony latency acceptable. Override with ELEVENLABS_TTS_MODEL on Railway.
// voice_settings: lower stability (more natural prosody/variation), higher
// similarity_boost (stays true to the chosen voice), a touch of style (warmth /
// expressiveness instead of a dead read). use_speaker_boost lifts presence on
// the phone line. These are tunable per-deploy via ELEVENLABS_* env vars below.
const TTS_MODEL_ID = process.env.ELEVENLABS_TTS_MODEL || 'eleven_multilingual_v2';
const TTS_VOICE_SETTINGS = {
  // Natural human-conversation profile (tuned so a seller can't tell it's AI).
  // These are the ElevenLabs-recommended conversational bands, not extremes —
  // extremes are what actually GIVE AWAY a synthetic voice on a phone line:
  //   stability 0.40  — 0.38-0.45 is the conversational sweet spot. Slightly
  //                     lower than a flat read gives more natural prosody variance
  //                     (rise/fall between words) so it doesn't sound metronomic.
  //                     Too low (<0.35) starts to wobble/warble ("AI glitching");
  //                     too high (>0.6) goes flat/monotone. 0.40 = human cadence.
  //   similarity 0.85 — 0.82-0.88 is where a clone stops sounding like an
  //                     impression and sounds like the actual person. Kept.
  //   style 0.28      — a touch more expressiveness/warmth than a neutral read so
  //                     it sounds engaged, not scripted. 0.15-0.30 is the natural
  //                     band; >0.30 tips into performative/theatrical (and adds
  //                     instability on the streaming model). 0.28 = warm, not hammy.
  //   speaker_boost   — lifts presence/clarity on a compressed phone line.
  // Every value stays env-overridable so live delivery can be nudged on Railway
  // WITHOUT a code redeploy — set ELEVENLABS_TTS_* and it wins.
  stability:        process.env.ELEVENLABS_TTS_STABILITY ? parseFloat(process.env.ELEVENLABS_TTS_STABILITY) : 0.40,
  similarity_boost: process.env.ELEVENLABS_TTS_SIMILARITY ? parseFloat(process.env.ELEVENLABS_TTS_SIMILARITY) : 0.85,
  style:            process.env.ELEVENLABS_TTS_STYLE ? parseFloat(process.env.ELEVENLABS_TTS_STYLE) : 0.28,
  use_speaker_boost: true,
};

// ── Per-line emotion → voice_settings (dynamic delivery) ─────────────────────
// The brain (voiceBrainService) prefixes each spoken line with ONE emotion tag
// like "{gentle}" / "{excited}" (see vapiService buildAlexPrompt "VOICE DELIVERY
// CUE"). We strip the tag from the words (never spoken) and use it to nudge the
// ElevenLabs voice_settings FOR THAT ONE LINE, so an empathy line is actually
// delivered soft/slow and a good-news line is delivered with a lift — instead of
// every line coming out on one flat, identical setting (the thing that reads as
// robotic even on a great clone).
//
// HOW THE KNOBS MAP TO FEELING (ElevenLabs semantics):
//   stability ↓  → MORE emotional swing / expressiveness (but too low = wobble).
//   stability ↑  → steadier, calmer, more controlled.
//   style ↑      → more expressive/animated delivery (but too high = theatrical).
//   style ↓      → plainer, more matter-of-fact.
//   similarity_boost + use_speaker_boost are kept from the base profile so the
//   voice stays the SAME person and stays present on the phone line.
//
// Each profile is a SMALL, human delta from the tuned base (stability 0.40 /
// style 0.28) — deliberately within the natural bands (stability 0.30-0.55,
// style 0.20-0.45) so no emotion tips into warble or ham. Unknown/absent tag →
// base profile (identical to today's behavior). All values clamp on apply.
const EMOTION_PROFILES = {
  // friendly default — essentially the base profile.
  warm:       { stability: 0.40, style: 0.30 },
  // soft, slow, tender — steadier + a little less animated so it lands gently.
  gentle:     { stability: 0.52, style: 0.22 },
  // caring/understanding — steady with a touch of warmth.
  empathetic: { stability: 0.50, style: 0.26 },
  // calm and reassuring — the steadiest profile so it feels safe/trustworthy.
  reassuring: { stability: 0.55, style: 0.24 },
  // genuine positive lift — lower stability + higher style = audible energy.
  excited:    { stability: 0.32, style: 0.42 },
  // sure and grounded (making the offer) — steady but with presence.
  confident:  { stability: 0.44, style: 0.34 },
  // light and interested (asking) — a little lift, not much swing.
  curious:    { stability: 0.40, style: 0.34 },
  // light/humor once rapport is real — most expressive, still bounded.
  playful:    { stability: 0.34, style: 0.44 },
  // measured and direct — plainer, controlled.
  serious:    { stability: 0.50, style: 0.20 },
};

const clamp01 = (n) => Math.max(0, Math.min(1, n));

// Extract a leading "{emotion}" tag from a line. Returns { emotion, text } where
// emotion is a lowercased known key (or null) and text is the line with the tag
// removed + trimmed. Only a KNOWN tag at the very start is honored; anything else
// is left untouched (so a stray brace in real speech never breaks the line).
function parseEmotionCue(line) {
  const raw = String(line == null ? '' : line);
  const m = raw.match(/^\s*\{\s*([a-zA-Z_]+)\s*\}\s*/);
  if (m) {
    const key = m[1].toLowerCase();
    if (Object.prototype.hasOwnProperty.call(EMOTION_PROFILES, key)) {
      return { emotion: key, text: raw.slice(m[0].length).trim() };
    }
  }
  return { emotion: null, text: raw.trim() };
}

// Resolve an emotion key to a full voice_settings object layered on the base
// profile. null/unknown → the base profile unchanged. Env-tuned base still wins
// for similarity/speaker_boost; only stability/style flex per emotion.
function voiceSettingsForEmotion(emotion) {
  const delta = emotion ? EMOTION_PROFILES[emotion] : null;
  if (!delta) return { ...TTS_VOICE_SETTINGS };
  return {
    ...TTS_VOICE_SETTINGS,
    stability: clamp01(delta.stability),
    style:     clamp01(delta.style),
  };
}
// Warm, natural default voice when no operator selection and no ELEVENLABS_VOICE_ID
// env is set. 'Brian' (nPczCjzI2devNBz1zQrb) is ElevenLabs' conversational,
// human-sounding male — deliberately NOT the deep, robotic stock 'Adam'
// (pNInz6obpgDQGcFmaJgB). Operators can still pick any voice from the library.
const DEFAULT_VOICE_ID = process.env.ELEVENLABS_DEFAULT_VOICE_ID || 'nPczCjzI2devNBz1zQrb';
// Supabase Storage bucket that holds the short TTS clips we hand to Twilio <Play>
// AND the voice-picker preview clips. Public bucket that already exists (also used
// by seed-voice-previews.js + vapiService VOICE_PREVIEW_BASE). Defaulting to
// 'call-tts' (which was never created) made synthesizeToUrl uploads fail → null →
// the ▶ preview returned 502. 'voice-previews' is the real public bucket.
const TTS_BUCKET = process.env.ELEVENLABS_TTS_BUCKET || 'voice-previews';

/**
 * Synthesize a line of text to MP3 via the ElevenLabs REST TTS endpoint.
 * Returns a Buffer of MP3 bytes, or null if no API key / on failure (caller
 * falls back to Twilio <Say> so the call never goes silent).
 *
 * Uses the documented POST /v1/text-to-speech/{voice_id} endpoint with
 * output_format=mp3_44100_128 (Twilio <Play> plays standard MP3 fine).
 * @param {string} text       the line to speak
 * @param {string} voiceId    ElevenLabs voice_id (falls back to ELEVENLABS_VOICE_ID)
 * @param {object} [voiceSettings]  optional per-line voice_settings override
 *                 (e.g. from voiceSettingsForEmotion). Omit → tuned base profile.
 * @returns {Promise<Buffer|null>}
 */
async function synthesizeSpeech(text, voiceId, voiceSettings) {
  const client = getClient();
  const vId = voiceId || process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
  if (!client || !vId || !text) {
    if (!client) console.warn('[ElevenLabs] synthesizeSpeech skipped — no API key');
    return null;
  }
  try {
    const settings = voiceSettings || TTS_VOICE_SETTINGS;
    const { data } = await client.post(
      `/text-to-speech/${vId}`,
      { text, model_id: TTS_MODEL_ID, voice_settings: settings },
      { params: { output_format: 'mp3_44100_128' }, responseType: 'arraybuffer' },
    );
    return Buffer.from(data);
  } catch (err) {
    const detail = err.response?.data ? Buffer.from(err.response.data).toString('utf8').slice(0, 200) : err.message;
    console.warn('[ElevenLabs] synthesizeSpeech failed:', detail);
    return null;
  }
}

/**
 * Synthesize text and upload the MP3 to Supabase Storage, returning a public URL
 * Twilio <Play> can fetch. Returns null on any failure so the caller falls back
 * to Twilio <Say> (the call is never left silent).
 *
 * @param {string} text             line to speak
 * @param {object} [opts]
 * @param {string} [opts.voiceId]   ElevenLabs voice_id
 * @param {string} [opts.callSid]   used to namespace the storage path
 * @param {string} [opts.emotion]   optional emotion key (see EMOTION_PROFILES) →
 *                                  dynamic per-line voice_settings. Unknown/absent
 *                                  → base TTS_VOICE_SETTINGS (identical to before).
 * @param {object} [opts.voiceSettings] optional explicit voice_settings override
 *                                  (takes precedence over emotion). Backward-compatible.
 * @returns {Promise<string|null>}  public MP3 URL, or null
 */
async function synthesizeToUrl(text, { voiceId, callSid, emotion, voiceSettings } = {}) {
  const settings = voiceSettings || voiceSettingsForEmotion(emotion);
  const mp3 = await synthesizeSpeech(text, voiceId, settings);
  if (!mp3) return null;
  try {
    const path = `${callSid || 'tts'}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`;
    const { error: uploadErr } = await supabase.storage
      .from(TTS_BUCKET)
      .upload(path, mp3, { contentType: 'audio/mpeg', upsert: true });
    if (uploadErr) throw uploadErr;
    const { data: pub } = supabase.storage.from(TTS_BUCKET).getPublicUrl(path);
    return pub?.publicUrl || null;
  } catch (err) {
    console.warn('[ElevenLabs] synthesizeToUrl upload failed:', err.message);
    return null;
  }
}

// ── v2 "stream" engine: WebSocket streaming TTS (ulaw_8000) ──────────────────
// ADDITIVE. Used ONLY by the new mediaStreamServer.js streaming pipeline. The
// existing REST synthesizeSpeech/synthesizeToUrl above are untouched and still
// power the turn-based (elevenlabs) engine. This is inert unless VOICE_ENGINE=stream.
//
// We open ElevenLabs' input-streaming WebSocket and request output_format=ulaw_8000
// so the audio Twilio Media Streams needs is produced natively — no transcoding,
// only re-chunking into Twilio's 160-byte / 20ms frames (done by the caller).
//
// ElevenLabs WS reference:
//   https://elevenlabs.io/docs/api-reference/websockets
// Protocol: first message = BOS with voice_settings (+ xi-api-key), then one or
// more text messages, then an EOS message ({ text: '' }). Server streams back
// { audio: <base64>, isFinal } frames until it closes/flushes.
const WebSocket = require('ws');

// Low-latency streaming model + telephony output format (env-overridable).
const STREAM_MODEL_ID = process.env.ELEVENLABS_STREAM_MODEL || 'eleven_flash_v2_5';
const STREAM_OUTPUT_FORMAT = process.env.ELEVENLABS_STREAM_FORMAT || 'ulaw_8000';

/**
 * Stream a line of text to ulaw_8000 audio over the ElevenLabs WebSocket.
 *
 * Yields base64 mu-law audio chunks via onChunk(base64) as they arrive so the
 * caller can push them to Twilio immediately (low latency). Resolves when the
 * stream is fully flushed. Abortable mid-flight (barge-in) via an AbortSignal.
 *
 * Returns false (never throws) if no API key / no voice / on socket failure, so
 * the caller can fall back gracefully (e.g. Twilio <Say>) and never leave dead air.
 *
 * @param {string}   text
 * @param {object}   opts
 * @param {string}   opts.voiceId          ElevenLabs voice_id (required)
 * @param {function} opts.onChunk          (base64Ulaw) => void — per audio frame
 * @param {AbortSignal} [opts.signal]      abort to stop mid-utterance (barge-in)
 * @returns {Promise<boolean>}             true if audio streamed, false on failure/abort
 */
function streamTts(text, { voiceId, onChunk, signal } = {}) {
  return new Promise((resolve) => {
    const vId = voiceId || process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
    if (!ELEVENLABS_API_KEY || !vId || !text) {
      if (!ELEVENLABS_API_KEY) console.warn('[ElevenLabs] streamTts skipped — no API key');
      return resolve(false);
    }
    if (signal?.aborted) return resolve(false);

    let settled = false;
    let producedAudio = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      try { if (ws.readyState === WebSocket.OPEN) ws.close(); } catch (_) { /* noop */ }
      resolve(val);
    };

    const wsUrl =
      `${ELEVENLABS_API_URL.replace(/^http/i, 'ws')}` +
      `/text-to-speech/${vId}/stream-input` +
      `?model_id=${encodeURIComponent(STREAM_MODEL_ID)}` +
      `&output_format=${encodeURIComponent(STREAM_OUTPUT_FORMAT)}`;

    let ws;
    try {
      ws = new WebSocket(wsUrl, { headers: { 'xi-api-key': ELEVENLABS_API_KEY } });
    } catch (err) {
      console.warn('[ElevenLabs] streamTts socket construct failed:', err.message);
      return resolve(false);
    }

    // Barge-in: abort the socket the instant the caller signals an interruption.
    const onAbort = () => {
      try { if (ws.readyState === WebSocket.OPEN) ws.close(); } catch (_) { /* noop */ }
      finish(producedAudio);
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    ws.on('open', () => {
      try {
        // BOS: voice_settings + auth. Reuse the same tuned profile as REST TTS.
        ws.send(JSON.stringify({
          text: ' ',
          voice_settings: TTS_VOICE_SETTINGS,
          xi_api_key: ELEVENLABS_API_KEY,
        }));
        // The actual line to speak.
        ws.send(JSON.stringify({ text: `${text} `, try_trigger_generation: true }));
        // EOS — flush and finish.
        ws.send(JSON.stringify({ text: '' }));
      } catch (err) {
        console.warn('[ElevenLabs] streamTts send failed:', err.message);
        finish(producedAudio);
      }
    });

    ws.on('message', (raw) => {
      if (signal?.aborted) return;
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (_) {
        return; // ignore non-JSON control frames
      }
      if (msg.audio) {
        producedAudio = true;
        try {
          if (typeof onChunk === 'function') onChunk(msg.audio);
        } catch (err) {
          console.warn('[ElevenLabs] streamTts onChunk threw:', err.message);
        }
      }
      if (msg.isFinal) finish(producedAudio);
    });

    ws.on('close', () => finish(producedAudio));
    ws.on('error', (err) => {
      console.warn('[ElevenLabs] streamTts socket error:', err.message);
      finish(producedAudio);
    });
  });
}

module.exports = {
  fetchVoicesFromApi,
  getVoiceLibrary,
  syncVoiceLibrary,
  resolveOperatorVoiceId,
  normaliseVoice,
  synthesizeSpeech,
  synthesizeToUrl,
  streamTts,
  parseEmotionCue,
  voiceSettingsForEmotion,
};
