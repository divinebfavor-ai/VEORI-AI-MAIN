if (process.env.NODE_ENV !== 'production') require('dotenv').config();
const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const { state, type, max_price, limit = 100, offset = 0 } = req.query;
    let q = supabase.from('buyers').select('*', { count: 'exact' }).eq('user_id', req.user.id)
      .order('created_at', { ascending: false }).range(Number(offset), Number(offset) + Number(limit) - 1);
    if (state) q = q.contains('buy_box_states', [state]);
    if (type)  q = q.contains('buy_box_types', [type]);
    if (max_price) q = q.gte('max_price', Number(max_price));
    const { data, error, count } = await q;
    if (error) throw error;
    res.json({ success: true, data, total: count });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('buyers').select('*').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'Buyer not found' });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, phone, email, buy_box_states = [], buy_box_types = [], max_price, repair_tolerance = 'any', notes } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'name required' });
    const { data, error } = await supabase.from('buyers').insert([{
      id: uuidv4(), user_id: req.user.id, name, phone, email, buy_box_states, buy_box_types, max_price, repair_tolerance, notes
    }]).select().single();
    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
});

router.post('/bulk', async (req, res, next) => {
  try {
    const { buyers } = req.body;
    if (!Array.isArray(buyers) || !buyers.length) return res.status(400).json({ success: false, error: 'buyers array required' });
    const records = buyers.map(b => ({ id: uuidv4(), user_id: req.user.id, name: b.name, phone: b.phone, email: b.email, buy_box_states: b.buy_box_states || [], buy_box_types: b.buy_box_types || [], max_price: b.max_price, repair_tolerance: b.repair_tolerance || 'any', notes: b.notes }));
    const { data, error } = await supabase.from('buyers').insert(records).select();
    if (error) throw error;
    res.status(201).json({ success: true, data, imported: data.length });
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const allowed = ['name','phone','email','buy_box_states','buy_box_types','max_price','repair_tolerance','is_active','notes'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    const { data, error } = await supabase.from('buyers').update(updates).eq('id', req.params.id).eq('user_id', req.user.id).select().single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { error } = await supabase.from('buyers').delete().eq('id', req.params.id).eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ success: true, message: 'Buyer deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
