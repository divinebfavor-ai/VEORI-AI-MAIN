const express = require('express');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const { getStateCompliance, getContractDisclosure, STATE_COMPLIANCE } = require('../data/stateCompliance');
const router = express.Router();

// GET /api/compliance/states — get all state compliance rules
router.get('/states', requireAuth, async (_req, res) => {
  res.json({ success: true, states: STATE_COMPLIANCE });
});

// GET /api/compliance/state/:code
router.get('/state/:code', requireAuth, async (req, res) => {
  const compliance = getStateCompliance(req.params.code);
  res.json({ success: true, compliance });
});

// GET /api/compliance/disclosure/:stateCode
router.get('/disclosure/:stateCode', requireAuth, async (req, res) => {
  const disclosure = getContractDisclosure(req.params.stateCode);
  res.json({ success: true, disclosure });
});

// GET /api/compliance/tcpa-log
router.get('/tcpa-log', requireAuth, async (req, res, next) => {
  try {
    const { limit = 100, offset = 0 } = req.query;
    const { data, error } = await supabase.from('tcpa_log')
      .select('*, leads(first_name, last_name)')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);
    if (error) throw error;
    res.json({ success: true, logs: data || [] });
  } catch (err) { next(err); }
});

module.exports = router;
