/**
 * /api/v2/voices — ElevenLabs voice library + operator voice selection.
 *
 * Part of the Twilio + ElevenLabs calling layer. Mounted under the NEW /api/v2
 * prefix so it never collides with existing /api routes or the Vapi voice
 * endpoints in operatorProfile.js.
 *
 * Module 1 ships GET /voices (the library).
 * Module 2 adds the per-operator selection endpoints (read + save) to this same
 * router. Selection is stored in veori_operator_voice_settings (new table) and
 * falls back to the existing users.ai_voice_id / users.ai_caller_name columns
 * when no v2 row exists yet — so an operator who never opens the new picker
 * still has a sensible voice/name.
 */

const express = require('express');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const elevenLabs = require('../services/elevenLabsService');

const router = express.Router();

// GET /api/v2/voices — all active voices operators can choose from.
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const voices = await elevenLabs.getVoiceLibrary();
    res.json({ success: true, count: voices.length, voices });
  } catch (err) { next(err); }
});

// GET /api/v2/voices/selection — the current operator's saved voice + caller name.
// Reads the v2 table first; if there's no row yet, falls back to the existing
// users.ai_voice_id / users.ai_caller_name so the picker shows a sensible default.
router.get('/selection', requireAuth, async (req, res, next) => {
  try {
    const operatorId = req.user.id;

    const { data: v2, error: v2Err } = await supabase
      .from('veori_operator_voice_settings')
      .select('selected_voice_id, ai_caller_name')
      .eq('operator_id', operatorId)
      .maybeSingle();
    if (v2Err) throw v2Err;

    if (v2 && v2.selected_voice_id) {
      return res.json({
        success: true,
        source: 'v2',
        selected_voice_id: v2.selected_voice_id,
        ai_caller_name: v2.ai_caller_name || 'Sarah',
      });
    }

    // No v2 selection yet — fall back to the operator's existing column values.
    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('ai_voice_id, ai_caller_name')
      .eq('id', operatorId)
      .maybeSingle();
    if (userErr) throw userErr;

    res.json({
      success: true,
      source: 'fallback',
      selected_voice_id: user?.ai_voice_id || null,
      ai_caller_name: user?.ai_caller_name || 'Sarah',
    });
  } catch (err) { next(err); }
});

// POST /api/v2/voices/selection — save the operator's chosen voice + caller name.
// Body: { selected_voice_id: string, ai_caller_name?: string }.
// Validates the voice_id exists in veori_voice_library before saving so an
// operator can't pin a dead/removed voice. Upserts on operator_id (one row each).
router.post('/selection', requireAuth, async (req, res, next) => {
  try {
    const operatorId = req.user.id;
    const selectedVoiceId = String(req.body.selected_voice_id || '').trim();
    const callerNameRaw = req.body.ai_caller_name;

    if (!selectedVoiceId) {
      return res.status(400).json({ success: false, error: 'selected_voice_id is required' });
    }

    // Validate the voice exists + is active in the library.
    const { data: voice, error: voiceErr } = await supabase
      .from('veori_voice_library')
      .select('voice_id')
      .eq('voice_id', selectedVoiceId)
      .eq('is_active', true)
      .maybeSingle();
    if (voiceErr) throw voiceErr;
    if (!voice) {
      return res.status(404).json({ success: false, error: 'voice_id not found in active voice library' });
    }

    // Normalise the caller name (optional). Empty/missing → DB default 'Sarah'.
    const aiCallerName = typeof callerNameRaw === 'string' && callerNameRaw.trim()
      ? callerNameRaw.trim().slice(0, 100)
      : undefined;

    const row = {
      operator_id: operatorId,
      selected_voice_id: selectedVoiceId,
      updated_at: new Date().toISOString(),
    };
    if (aiCallerName !== undefined) row.ai_caller_name = aiCallerName;

    const { data, error } = await supabase
      .from('veori_operator_voice_settings')
      .upsert(row, { onConflict: 'operator_id' })
      .select('selected_voice_id, ai_caller_name')
      .single();
    if (error) throw error;

    res.json({
      success: true,
      selected_voice_id: data.selected_voice_id,
      ai_caller_name: data.ai_caller_name,
    });
  } catch (err) { next(err); }
});

// POST /api/v2/voices/sync — one-time / on-demand seed of veori_voice_library
// from the live ElevenLabs catalog. Runs on Railway (which holds the key), so no
// local key or standalone script is needed. Gated by SYNC_ADMIN_TOKEN (set on
// Railway) on TOP of requireAuth: the caller must send X-Sync-Token matching the
// env value. If SYNC_ADMIN_TOKEN is unset the route is disabled (503) rather than
// left open — fail closed, never expose a catalog write to any logged-in operator.
router.post('/sync', requireAuth, async (req, res, next) => {
  try {
    const expected = process.env.SYNC_ADMIN_TOKEN;
    if (!expected) {
      return res.status(503).json({ success: false, error: 'sync disabled — SYNC_ADMIN_TOKEN not configured' });
    }
    const provided = req.headers['x-sync-token'];
    if (!provided || provided !== expected) {
      return res.status(403).json({ success: false, error: 'invalid or missing X-Sync-Token' });
    }

    const result = await elevenLabs.syncVoiceLibrary();
    res.json({
      success: true,
      synced: result.synced,
      note: result.note || undefined,
      sample: (result.voices || []).slice(0, 20).map((v) => ({ voice_id: v.voice_id, voice_name: v.voice_name })),
    });
  } catch (err) { next(err); }
});

// POST /api/v2/voices/:voiceId/preview — generate (once, then cache) a real
// preview clip for a voice using the SAME tuned TTS profile the live call uses,
// so what an operator hears in the picker IS what a seller hears on the phone.
//
// WHY (not ElevenLabs' generic preview_url): the operator's cloned voices had no
// preview_url, and even when present, ElevenLabs' stock preview is a neutral read
// on default settings — it does NOT reflect our stability/similarity/style tuning
// or model (eleven_multilingual_v2). This synthesizes a short sample with
// synthesizeToUrl() (Railway holds the key), uploads to Supabase Storage, caches
// the public URL onto veori_voice_library.voice_preview_url, and returns it. On a
// second call it returns the cached URL without re-spending TTS credits.
//
// Gated by plain requireAuth (any logged-in operator can preview) — it only reads
// the catalog + writes a preview URL, never changes names/selection/active state.
const PREVIEW_SAMPLE_TEXT = process.env.ELEVENLABS_PREVIEW_TEXT
  || "Hi, this is a quick sample of how I'll sound on your calls. Thanks for taking a moment — I really appreciate it.";

router.post('/:voiceId/preview', requireAuth, async (req, res, next) => {
  try {
    const voiceId = String(req.params.voiceId || '').trim();
    if (!voiceId) {
      return res.status(400).json({ success: false, error: 'voiceId is required' });
    }

    // Voice must exist + be active in the library (can't preview a dead voice).
    const { data: voice, error: voiceErr } = await supabase
      .from('veori_voice_library')
      .select('voice_id, voice_preview_url')
      .eq('voice_id', voiceId)
      .eq('is_active', true)
      .maybeSingle();
    if (voiceErr) throw voiceErr;
    if (!voice) {
      return res.status(404).json({ success: false, error: 'voice_id not found in active voice library' });
    }

    // Return the cached clip unless the caller forces a regenerate (?force=1).
    const force = req.query.force === '1' || req.body?.force === true;
    if (voice.voice_preview_url && !force) {
      return res.json({ success: true, cached: true, voice_id: voiceId, voice_preview_url: voice.voice_preview_url });
    }

    // Generate the sample with the live-call tuning, upload, get a public URL.
    const url = await elevenLabs.synthesizeToUrl(PREVIEW_SAMPLE_TEXT, {
      voiceId,
      callSid: `preview-${voiceId}`,
    });
    if (!url) {
      // Missing key or TTS failure — never 500 the picker; report cleanly.
      return res.status(502).json({ success: false, error: 'preview generation failed (check ELEVENLABS_API_KEY / voice belongs to that account)' });
    }

    // Cache the URL so future previews are instant + free. Never touches
    // voice_name / is_active — preview media only.
    const { error: updErr } = await supabase
      .from('veori_voice_library')
      .update({ voice_preview_url: url, updated_at: new Date().toISOString() })
      .eq('voice_id', voiceId);
    if (updErr) throw updErr;

    res.json({ success: true, cached: false, voice_id: voiceId, voice_preview_url: url });
  } catch (err) { next(err); }
});

module.exports = router;
