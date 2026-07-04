/**
 * Missed Calls Routes
 *
 * GET  /api/missed-calls          - list missed calls for this operator
 * GET  /api/missed-calls/settings - get missed call text-back settings
 * PUT  /api/missed-calls/settings - update settings
 */

const express  = require('express');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/missed-calls - paginated list of missed calls
router.get('/', async (req, res, next) => {
  try {
    const { limit = 50, offset = 0 } = req.query;

    const { data, error, count } = await supabase
      .from('missed_calls')
      .select('*, leads(first_name, last_name, property_address, motivation_score)', { count: 'exact' })
      .eq('operator_id', req.user.id)
      .order('called_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) throw error;
    res.json({ success: true, data: data || [], total: count || 0 });
  } catch (err) { next(err); }
});

// GET /api/missed-calls/settings
router.get('/settings', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('missed_call_textback_enabled, missed_call_message, missed_call_delay_seconds')
      .eq('id', req.user.id)
      .single();

    if (error) throw error;

    res.json({
      success: true,
      settings: {
        enabled:        data?.missed_call_textback_enabled ?? true,
        message:        data?.missed_call_message ?? 'Hi, I just missed your call. I am interested in your property and would love to connect. What is the best time to reach you? - [Operator Name]',
        delay_seconds:  data?.missed_call_delay_seconds ?? 60,
      },
    });
  } catch (err) { next(err); }
});

// PUT /api/missed-calls/settings
router.put('/settings', async (req, res, next) => {
  try {
    const { enabled, message, delay_seconds } = req.body;

    const updates = {};

    if (typeof enabled === 'boolean') {
      updates.missed_call_textback_enabled = enabled;
    }

    if (typeof message === 'string' && message.trim().length > 0) {
      if (message.trim().length > 500) {
        return res.status(400).json({ success: false, error: 'Message must be 500 characters or less' });
      }
      updates.missed_call_message = message.trim();
    }

    if (typeof delay_seconds === 'number') {
      if (delay_seconds < 0 || delay_seconds > 300) {
        return res.status(400).json({ success: false, error: 'Delay must be between 0 and 300 seconds' });
      }
      updates.missed_call_delay_seconds = delay_seconds;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: 'No valid fields to update' });
    }

    const { error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', req.user.id);

    if (error) throw error;

    res.json({ success: true, message: 'Settings saved' });
  } catch (err) { next(err); }
});

module.exports = router;
