/**
 * SMS First Workflow Routes
 *
 * POST /api/sms-first/:id/start   — start SMS first mode for a campaign
 * POST /api/sms-first/:id/stop    — stop monitoring
 * GET  /api/sms-first/:id/status  — get current SMS first stats
 * GET  /api/sms-first/:id/leads   — list leads and their reply status
 */

const router   = require('express').Router();
const { requireAuth: auth } = require('../middleware/auth');
const supabase = require('../config/supabase');
const smsFirst = require('../services/smsFirstWorkflow');

// POST /api/sms-first/:id/start
router.post('/:id/start', auth, async (req, res, next) => {
  try {
    const result = await smsFirst.start(req.params.id, req.user.id);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST /api/sms-first/:id/stop
router.post('/:id/stop', auth, async (req, res, next) => {
  try {
    await smsFirst.stop(req.params.id);
    res.json({ success: true, message: 'SMS First monitoring stopped' });
  } catch (err) { next(err); }
});

// GET /api/sms-first/:id/status
router.get('/:id/status', auth, async (req, res, next) => {
  try {
    const status = await smsFirst.getStatus(req.params.id);
    res.json({ success: true, data: status });
  } catch (err) { next(err); }
});

// GET /api/sms-first/:id/leads
router.get('/:id/leads', auth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('sms_first_leads')
      .select('*, leads(first_name, last_name, phone, property_address, property_state)')
      .eq('campaign_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (err) { next(err); }
});

module.exports = router;
