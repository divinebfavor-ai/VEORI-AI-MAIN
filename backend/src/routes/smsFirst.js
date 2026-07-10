/**
 * SMS First Workflow Routes
 *
 * POST /api/sms-first/:id/start   - start SMS first mode for a campaign
 * POST /api/sms-first/:id/stop    - stop monitoring
 * GET  /api/sms-first/:id/status  - get current SMS first stats
 * GET  /api/sms-first/:id/leads   - list leads and their reply status
 */

const router   = require('express').Router();
const { requireAuth: auth } = require('../middleware/auth');
const supabase = require('../config/supabase');
const smsFirst = require('../services/smsFirstWorkflow');

// POST /api/sms-first/:id/start
router.post('/:id/start', auth, async (req, res, next) => {
  try {
    const result = await smsFirst.start(req.params.id, req.user.id, {
      blastCount: req.body?.blast_count,   // 1× / 2× / 3× non-responder cadence (optional; defaults to 1×)
      templateId: req.body?.template_id,   // saved sms_templates row to blast with (optional; falls back to campaign col, then built-in copy)
      customBody: req.body?.custom_body,   // raw operator copy for this blast (optional; takes precedence over templateId)
    });
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
    // Ownership check: verify the campaign belongs to the caller before listing its
    // leads (service role bypasses RLS - prevents cross-tenant lead exposure).
    const { data: campaign, error: campErr } = await supabase
      .from('campaigns').select('user_id').eq('id', req.params.id).single();
    if (campErr && campErr.code !== 'PGRST116') throw campErr;
    if (!campaign || campaign.user_id !== req.user.id) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

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
