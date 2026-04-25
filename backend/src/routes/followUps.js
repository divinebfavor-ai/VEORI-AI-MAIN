const express = require('express');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const { logActivity } = require('../services/dealActivityService');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const { deal_id, status, limit = 100 } = req.query;
    let query = supabase
      .from('follow_ups')
      .select('*')
      .eq('user_id', req.user.id)
      .order('next_follow_up_at', { ascending: true })
      .limit(Number(limit));

    if (deal_id) query = query.eq('deal_id', deal_id);
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;
    res.json({ success: true, follow_ups: data || [] });
  } catch (err) { next(err); }
});

router.post('/create_follow_up', async (req, res, next) => {
  try {
    const {
      deal_id,
      contact_id = null,
      contact_type = 'seller',
      follow_up_type = 'text',
      next_follow_up_at,
      reason,
    } = req.body;

    if (!deal_id || !next_follow_up_at || !reason) {
      return res.status(400).json({ success: false, error: 'deal_id, next_follow_up_at, and reason are required' });
    }

    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .select('id, lead_id')
      .eq('id', deal_id)
      .eq('user_id', req.user.id)
      .single();
    if (dealError) throw dealError;
    if (!deal) return res.status(404).json({ success: false, error: 'Deal not found' });

    const payload = {
      id: uuidv4(),
      user_id: req.user.id,
      deal_id,
      contact_id,
      contact_type,
      follow_up_type,
      next_follow_up_at,
      reason,
      status: 'scheduled',
    };

    const { data, error } = await supabase
      .from('follow_ups')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;

    await logActivity({
      userId: req.user.id,
      dealId: deal_id,
      leadId: deal.lead_id,
      activityType: 'follow_up_scheduled',
      message: `${follow_up_type.replace(/_/g, ' ')} follow-up scheduled`,
      metadata: { next_follow_up_at, contact_type, follow_up_type, reason },
    });

    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const updates = { ...req.body, updated_at: new Date().toISOString() };
    const { data, error } = await supabase
      .from('follow_ups')
      .update(updates)
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

module.exports = router;
