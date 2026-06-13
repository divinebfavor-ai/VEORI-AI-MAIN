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
 *        -> users.ai_voice_id (existing column)
 *        -> ELEVENLABS_VOICE_ID env
 *        -> null (caller decides default).
 * Read-only helper used by the call engine in later modules.
 */
async function resolveOperatorVoiceId(operatorId) {
  if (!operatorId) return process.env.ELEVENLABS_VOICE_ID || null;

  const { data: settings } = await supabase
    .from('veori_operator_voice_settings')
    .select('selected_voice_id')
    .eq('operator_id', operatorId)
    .maybeSingle();

  if (settings?.selected_voice_id) return settings.selected_voice_id;
  return process.env.ELEVENLABS_VOICE_ID || null;
}

module.exports = {
  fetchVoicesFromApi,
  getVoiceLibrary,
  syncVoiceLibrary,
  resolveOperatorVoiceId,
  normaliseVoice,
};
