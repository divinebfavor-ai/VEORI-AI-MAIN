/**
 * /api/v2/voices — ElevenLabs voice library + operator voice selection.
 *
 * Part of the Twilio + ElevenLabs calling layer. Mounted under the NEW /api/v2
 * prefix so it never collides with existing /api routes or the Vapi voice
 * endpoints in operatorProfile.js.
 *
 * Module 1 ships GET /voices (the library). Module 2 adds the select + operator
 * lookup endpoints to this same router.
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

module.exports = router;
