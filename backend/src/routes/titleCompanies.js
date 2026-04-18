const express = require('express');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('title_companies')
      .select('*').eq('user_id', req.user.id).order('is_default', { ascending: false });
    if (error) throw error;
    res.json({ success: true, companies: data || [] });
  } catch (err) { next(err); }
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { company_name, contact_name, email, phone, fax, address, states, notes, is_default } = req.body;
    if (!company_name) return res.status(400).json({ error: 'company_name required' });
    if (is_default) await supabase.from('title_companies').update({ is_default: false }).eq('user_id', req.user.id);
    const { data, error } = await supabase.from('title_companies').insert({ user_id: req.user.id, company_name, contact_name, email, phone, fax, address, states, notes, is_default: !!is_default }).select().single();
    if (error) throw error;
    res.status(201).json({ success: true, company: data });
  } catch (err) { next(err); }
});

router.put('/:id', requireAuth, async (req, res, next) => {
  try {
    if (req.body.is_default) await supabase.from('title_companies').update({ is_default: false }).eq('user_id', req.user.id);
    const { data, error } = await supabase.from('title_companies').update(req.body).eq('id', req.params.id).eq('user_id', req.user.id).select().single();
    if (error) throw error;
    res.json({ success: true, company: data });
  } catch (err) { next(err); }
});

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    await supabase.from('title_companies').delete().eq('id', req.params.id).eq('user_id', req.user.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
