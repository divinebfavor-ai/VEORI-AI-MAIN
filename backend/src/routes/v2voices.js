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

module.exports = router;
