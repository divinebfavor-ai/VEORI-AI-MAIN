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
    .select('voice_id, voice_name, voice_preview_url, voice_gender, voice_accent, voice_description')
    .eq('is_active', true)
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
 * Sync the ElevenLabs catalog into veori_voice_library (upsert on voice_id).
 * Used by scripts/syncElevenLabsVoices.js. Returns { synced, voices }.
 * This is a WRITE to the new table only — it never touches existing tables.
 */
async function syncVoiceLibrary() {
  const voices = await fetchVoicesFromApi();
  if (voices.length === 0) {
    return { synced: 0, voices: [], note: 'No voices fetched (missing key or empty API response)' };
  }

  const rows = voices.map((v) => ({ ...v, is_active: true, updated_at: new Date().toISOString() }));
  const { data, error } = await supabase
    .from('veori_voice_library')
    .upsert(rows, { onConflict: 'voice_id' })
    .select('voice_id');

  if (error) throw new Error(`voice_library upsert failed: ${error.message}`);
  return { synced: data ? data.length : rows.length, voices };
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
  // Human conversational profile (tuned to kill the "sounds so AI" monotone):
  //   stability 0.30  — lower = more natural prosody/variation (high = flat, robotic)
  //   similarity 0.85 — stays true to the chosen voice's character
  //   style 0.55      — higher = real emotional inflection (low = dead read)
  // Every value is still env-overridable so the live delivery can be nudged on
  // Railway WITHOUT a redeploy of code — set ELEVENLABS_TTS_* and it wins.
  stability:        process.env.ELEVENLABS_TTS_STABILITY ? parseFloat(process.env.ELEVENLABS_TTS_STABILITY) : 0.30,
  similarity_boost: process.env.ELEVENLABS_TTS_SIMILARITY ? parseFloat(process.env.ELEVENLABS_TTS_SIMILARITY) : 0.85,
  style:            process.env.ELEVENLABS_TTS_STYLE ? parseFloat(process.env.ELEVENLABS_TTS_STYLE) : 0.55,
  use_speaker_boost: true,
};
// Warm, natural default voice when no operator selection and no ELEVENLABS_VOICE_ID
// env is set. 'Brian' (nPczCjzI2devNBz1zQrb) is ElevenLabs' conversational,
// human-sounding male — deliberately NOT the deep, robotic stock 'Adam'
// (pNInz6obpgDQGcFmaJgB). Operators can still pick any voice from the library.
const DEFAULT_VOICE_ID = process.env.ELEVENLABS_DEFAULT_VOICE_ID || 'nPczCjzI2devNBz1zQrb';
// Supabase Storage bucket that holds the short TTS clips we hand to Twilio <Play>.
// Public bucket (created manually); clips are cheap, disposable per-turn audio.
const TTS_BUCKET = process.env.ELEVENLABS_TTS_BUCKET || 'call-tts';

/**
 * Synthesize a line of text to MP3 via the ElevenLabs REST TTS endpoint.
 * Returns a Buffer of MP3 bytes, or null if no API key / on failure (caller
 * falls back to Twilio <Say> so the call never goes silent).
 *
 * Uses the documented POST /v1/text-to-speech/{voice_id} endpoint with
 * output_format=mp3_44100_128 (Twilio <Play> plays standard MP3 fine).
 * @param {string} text       the line to speak
 * @param {string} voiceId    ElevenLabs voice_id (falls back to ELEVENLABS_VOICE_ID)
 * @returns {Promise<Buffer|null>}
 */
async function synthesizeSpeech(text, voiceId) {
  const client = getClient();
  const vId = voiceId || process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
  if (!client || !vId || !text) {
    if (!client) console.warn('[ElevenLabs] synthesizeSpeech skipped — no API key');
    return null;
  }
  try {
    const { data } = await client.post(
      `/text-to-speech/${vId}`,
      { text, model_id: TTS_MODEL_ID, voice_settings: TTS_VOICE_SETTINGS },
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
 * @returns {Promise<string|null>}  public MP3 URL, or null
 */
async function synthesizeToUrl(text, { voiceId, callSid } = {}) {
  const mp3 = await synthesizeSpeech(text, voiceId);
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

module.exports = {
  fetchVoicesFromApi,
  getVoiceLibrary,
  syncVoiceLibrary,
  resolveOperatorVoiceId,
  normaliseVoice,
  synthesizeSpeech,
  synthesizeToUrl,
};
