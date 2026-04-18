const express = require('express');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const { enrollLeadInSequence, SEQUENCE_DEFINITIONS } = require('../services/sequenceEngine');
const router = express.Router();

// GET /api/sequences — list active sequences for user
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('sequences')
      .select('*, leads(first_name, last_name, property_address)')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    res.json({ success: true, sequences: data || [] });
  } catch (err) { next(err); }
});

// POST /api/sequences/enroll
router.post('/enroll', requireAuth, async (req, res, next) => {
  try {
    const { lead_id, sequence_type } = req.body;
    if (!lead_id || !sequence_type) return res.status(400).json({ error: 'lead_id and sequence_type required' });
    if (!SEQUENCE_DEFINITIONS[sequence_type]) return res.status(400).json({ error: `Unknown sequence type: ${sequence_type}` });
    const seq = await enrollLeadInSequence(req.user.id, lead_id, sequence_type);
    res.status(201).json({ success: true, sequence: seq });
  } catch (err) { next(err); }
});

// DELETE /api/sequences/:id — cancel a sequence
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    await supabase.from('sequences').update({ status: 'cancelled' }).eq('id', req.params.id).eq('user_id', req.user.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
