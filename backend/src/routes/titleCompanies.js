const express = require('express');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('title_companies')
      .select('*').eq('user_id', req.user.id).order('is_default', { ascending: false });
    if (error) throw error;
    const companies = (data || []).map((company) => ({
      ...company,
      name: company.name || company.company_name,
      preferred_states: company.preferred_states || company.states || [],
    }));
    res.json({ success: true, companies });
  } catch (err) { next(err); }
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const {
      company_name,
      name,
      contact_name,
      email,
      phone,
      fax,
      address,
      city,
      state,
      preferred_states,
      states,
      notes,
      preferred_communication_method,
      relationship_status,
      is_default
    } = req.body;
    const resolvedName = name || company_name;
    if (!resolvedName) return res.status(400).json({ error: 'company name required' });
    if (is_default) await supabase.from('title_companies').update({ is_default: false }).eq('user_id', req.user.id);
    const payload = {
      user_id: req.user.id,
      name: resolvedName,
      contact_name,
      email,
      phone,
      fax,
      address,
      city,
      state,
      preferred_states: preferred_states || states || [],
      notes,
      preferred_communication_method,
      relationship_status,
      is_default: !!is_default,
    };
    const { data, error } = await supabase.from('title_companies').insert(payload).select().single();
    if (error) throw error;
    res.status(201).json({ success: true, company: { ...data, name: data.name || resolvedName } });
  } catch (err) { next(err); }
});

router.put('/:id', requireAuth, async (req, res, next) => {
  try {
    const updates = { ...req.body };
    if (updates.company_name && !updates.name) updates.name = updates.company_name;
    if (updates.states && !updates.preferred_states) updates.preferred_states = updates.states;
    delete updates.company_name;
    delete updates.states;
    if (req.body.is_default) await supabase.from('title_companies').update({ is_default: false }).eq('user_id', req.user.id);
    const { data, error } = await supabase.from('title_companies').update(updates).eq('id', req.params.id).eq('user_id', req.user.id).select().single();
    if (error) throw error;
    res.json({ success: true, company: { ...data, name: data.name || updates.name } });
  } catch (err) { next(err); }
});

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    await supabase.from('title_companies').delete().eq('id', req.params.id).eq('user_id', req.user.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
