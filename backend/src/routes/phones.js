if (process.env.NODE_ENV !== 'production') require('dotenv').config();
const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/phones
router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('phone_numbers').select('*').eq('user_id', req.user.id).order('health_status');
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/phones/health
router.get('/health', async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('phone_numbers').select('*').eq('user_id', req.user.id);
    if (error) throw error;
    const summary = {
      total: data.length,
      active: data.filter(p => p.health_status === 'healthy' && p.is_active).length,
      cooling: data.filter(p => p.health_status === 'cooling').length,
      resting: data.filter(p => p.health_status === 'resting').length,
      flagged: data.filter(p => p.health_status === 'flagged').length,
      numbers: data,
    };
    res.json({ success: true, data: summary });
  } catch (err) { next(err); }
});

// POST /api/phones/select — intelligent number selection
router.post('/select', async (req, res, next) => {
  try {
    const { seller_state, exclude_ids = [] } = req.body;
    const phoneRotation = require('../services/phoneRotation');
    const number = await phoneRotation.selectBestNumber(req.user.id, seller_state, exclude_ids);
    if (!number) return res.status(404).json({ success: false, error: 'No healthy numbers available' });
    res.json({ success: true, data: number });
  } catch (err) { next(err); }
});

// POST /api/phones
router.post('/', async (req, res, next) => {
  try {
    const { number, friendly_name, area_code, state, carrier, daily_call_limit = 50 } = req.body;
    if (!number) return res.status(400).json({ success: false, error: 'number required' });
    const { data, error } = await supabase.from('phone_numbers').insert([{
      id: uuidv4(), user_id: req.user.id, number, friendly_name, area_code, state, carrier, daily_call_limit
    }]).select().single();
    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /api/phones/bulk — import CSV of numbers
router.post('/bulk', async (req, res, next) => {
  try {
    const { numbers } = req.body;
    if (!Array.isArray(numbers) || !numbers.length) return res.status(400).json({ success: false, error: 'numbers array required' });
    const records = numbers.map(n => ({ id: uuidv4(), user_id: req.user.id, number: n.number, friendly_name: n.friendly_name, area_code: n.area_code, state: n.state, carrier: n.carrier, daily_call_limit: n.daily_call_limit || 50 }));
    const { data, error } = await supabase.from('phone_numbers').insert(records).select();
    if (error) throw error;
    res.status(201).json({ success: true, data, imported: data.length });
  } catch (err) { next(err); }
});

// PUT /api/phones/:id
router.put('/:id', async (req, res, next) => {
  try {
    const allowed = ['friendly_name','daily_call_limit','is_active','health_status','spam_score'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    const { data, error } = await supabase.from('phone_numbers').update(updates).eq('id', req.params.id).eq('user_id', req.user.id).select().single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// DELETE /api/phones/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const { error } = await supabase.from('phone_numbers').delete().eq('id', req.params.id).eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ success: true, message: 'Phone number deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
