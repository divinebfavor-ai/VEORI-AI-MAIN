const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const campaignManager = require('../services/campaignManager');

const router = express.Router();
router.use(requireAuth);

// GET /api/campaigns
router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('campaigns').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/campaigns/:id
router.get('/:id', async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('campaigns').select('*').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'Campaign not found' });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/campaigns/:id/stats
router.get('/:id/stats', async (req, res, next) => {
  try {
    const { data: campaign } = await supabase.from('campaigns').select('*').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (!campaign) return res.status(404).json({ success: false, error: 'Campaign not found' });

    // Get calls for today
    const today = new Date().toISOString().split('T')[0];
    const { data: calls } = await supabase.from('calls').select('status, duration_seconds, motivation_score, outcome')
      .eq('user_id', req.user.id).gte('created_at', today);

    const stats = {
      campaign,
      today: {
        calls_made: calls?.length || 0,
        answered: calls?.filter(c => c.duration_seconds > 10).length || 0,
        motivated: calls?.filter(c => (c.motivation_score || 0) >= 50).length || 0,
        appointments: calls?.filter(c => c.outcome === 'appointment').length || 0,
        offers: calls?.filter(c => c.outcome === 'offer_made').length || 0,
        estimated_cost: (calls?.length || 0) * 0.25,
      },
    };
    res.json({ success: true, data: stats });
  } catch (err) { next(err); }
});

// POST /api/campaigns
router.post('/', async (req, res, next) => {
  try {
    const { name, concurrent_lines = 1, daily_limit_per_number = 50, calling_hours_start = '09:00',
      calling_hours_end = '20:00', retry_attempts = 3, call_delay_seconds = 8,
      daily_spend_limit, lead_filter = {}, phone_number_ids = [] } = req.body;

    if (!name) return res.status(400).json({ success: false, error: 'name required' });

    const { data, error } = await supabase.from('campaigns').insert([{
      id: uuidv4(), user_id: req.user.id, name, concurrent_lines, daily_limit_per_number,
      calling_hours_start, calling_hours_end, retry_attempts, call_delay_seconds,
      daily_spend_limit, lead_filter, phone_number_ids, status: 'draft'
    }]).select().single();

    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
});

// PUT /api/campaigns/:id
router.put('/:id', async (req, res, next) => {
  try {
    const allowed = ['name','concurrent_lines','daily_limit_per_number','calling_hours_start','calling_hours_end','retry_attempts','call_delay_seconds','daily_spend_limit','lead_filter','phone_number_ids'];
    const updates = { updated_at: new Date().toISOString() };
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    const { data, error } = await supabase.from('campaigns').update(updates).eq('id', req.params.id).eq('user_id', req.user.id).select().single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /api/campaigns/:id/start
router.post('/:id/start', async (req, res, next) => {
  try {
    const result = await campaignManager.start(req.params.id, req.user.id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// POST /api/campaigns/:id/pause
router.post('/:id/pause', async (req, res, next) => {
  try {
    await campaignManager.pause(req.params.id);
    res.json({ success: true, message: 'Campaign paused' });
  } catch (err) { next(err); }
});

// POST /api/campaigns/:id/stop
router.post('/:id/stop', async (req, res, next) => {
  try {
    await campaignManager.stop(req.params.id);
    res.json({ success: true, message: 'Campaign stopped' });
  } catch (err) { next(err); }
});

// DELETE /api/campaigns/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const { error } = await supabase.from('campaigns').delete().eq('id', req.params.id).eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
