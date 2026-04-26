const express  = require('express');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/notifications
router.get('/', async (req, res, next) => {
  try {
    const { limit = 30, offset = 0 } = req.query;
    const { data, error, count } = await supabase.from('notifications')
      .select('*', { count: 'exact' })
      .eq('operator_id', req.user.id)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);
    if (error) throw error;
    res.json({ success: true, notifications: data || [], total: count });
  } catch (err) { next(err); }
});

// GET /api/notifications/unread-count
router.get('/unread-count', async (req, res, next) => {
  try {
    const { count, error } = await supabase.from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('operator_id', req.user.id)
      .eq('is_read', false);
    if (error) throw error;
    res.json({ success: true, count: count || 0 });
  } catch (err) { next(err); }
});

// PUT /api/notifications/read-all
router.put('/read-all', async (req, res, next) => {
  try {
    const { error } = await supabase.from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('operator_id', req.user.id)
      .eq('is_read', false);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { next(err); }
});

// PUT /api/notifications/:id/read
router.put('/:id/read', async (req, res, next) => {
  try {
    const { error } = await supabase.from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('notification_id', req.params.id)
      .eq('operator_id', req.user.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST /api/notifications — create a notification (internal use)
router.post('/', async (req, res, next) => {
  try {
    const { type, title, message, deal_id, link } = req.body;
    if (!type || !title || !message) return res.status(400).json({ success: false, error: 'type, title, message required' });

    const { data, error } = await supabase.from('notifications').insert({
      operator_id: req.user.id,
      type,
      title,
      message,
      deal_id: deal_id || null,
      link: link || null,
      is_read: false,
    }).select().single();
    if (error) throw error;

    res.status(201).json({ success: true, notification: data });
  } catch (err) { next(err); }
});

module.exports = router;
