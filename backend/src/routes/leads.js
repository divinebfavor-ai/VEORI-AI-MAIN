if (process.env.NODE_ENV !== 'production') require('dotenv').config();
const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const aiService = require('../services/aiService');

const router = express.Router();
router.use(requireAuth);

// GET /api/leads — list with all filters
router.get('/', async (req, res, next) => {
  try {
    const { campaign_id, status, score_min, score_max, state, source, limit = 50, offset = 0, search, date_from } = req.query;

    let q = supabase.from('leads').select('*', { count: 'exact' })
      .eq('user_id', req.user.id)
      .order('motivation_score', { ascending: false, nullsFirst: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (status)    q = q.eq('status', status);
    if (state)     q = q.eq('property_state', state);
    if (source)    q = q.eq('source', source);
    if (score_min) q = q.gte('motivation_score', Number(score_min));
    if (score_max) q = q.lte('motivation_score', Number(score_max));
    if (date_from) q = q.gte('created_at', date_from);
    if (search) {
      q = q.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,phone.ilike.%${search}%,property_address.ilike.%${search}%`);
    }

    const { data, error, count } = await q;
    if (error) throw error;
    res.json({ success: true, data, total: count, limit: Number(limit), offset: Number(offset) });
  } catch (err) { next(err); }
});

// GET /api/leads/:id — full lead with call history
router.get('/:id', async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('leads').select('*, calls(*), deals(*)')
      .eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'Lead not found' });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /api/leads — create single
router.post('/', async (req, res, next) => {
  try {
    const { first_name, last_name, phone, email, property_address, property_city, property_state, property_zip, property_type, estimated_value, estimated_equity, source, notes, tags } = req.body;
    if (!phone) return res.status(400).json({ success: false, error: 'phone required' });

    // DNC check
    const { data: dnc } = await supabase.from('dnc_records').select('id').eq('phone', phone).single();
    const is_on_dnc = !!dnc;

    const { data, error } = await supabase.from('leads').insert([{
      id: uuidv4(), user_id: req.user.id, first_name, last_name, phone, email,
      property_address, property_city, property_state, property_zip, property_type,
      estimated_value, estimated_equity, source, notes, tags, is_on_dnc, status: is_on_dnc ? 'dnc' : 'new'
    }]).select().single();

    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /api/leads/bulk — CSV import up to 10,000
router.post('/bulk', async (req, res, next) => {
  try {
    const { leads } = req.body;
    if (!Array.isArray(leads) || !leads.length) return res.status(400).json({ success: false, error: 'leads array required' });

    // Get all DNC numbers
    const phones = leads.map(l => l.phone).filter(Boolean);
    const { data: dncData } = await supabase.from('dnc_records').select('phone').in('phone', phones);
    const dncSet = new Set((dncData || []).map(d => d.phone));

    const records = leads.map(l => ({
      id: uuidv4(),
      user_id: req.user.id,
      first_name:       l.first_name || l['First Name'] || l.firstname || '',
      last_name:        l.last_name  || l['Last Name']  || l.lastname  || '',
      phone:            l.phone      || l['Phone']      || '',
      email:            l.email      || l['Email']      || null,
      property_address: l.property_address || l['Property Address'] || l.address || '',
      property_city:    l.property_city    || l['City']    || '',
      property_state:   l.property_state   || l['State']   || '',
      property_zip:     l.property_zip     || l['Zip']     || '',
      property_type:    l.property_type    || l['Type']    || '',
      estimated_value:  parseNum(l.estimated_value  || l['Estimated Value']  || l['AVM']),
      estimated_equity: parseNum(l.estimated_equity || l['Estimated Equity'] || l['Equity']),
      source: l.source || l['Source'] || 'csv_import',
      is_on_dnc: dncSet.has(l.phone),
      status: dncSet.has(l.phone) ? 'dnc' : 'new',
    })).filter(r => r.phone);

    // Deduplicate by phone within batch
    const seen = new Set();
    const unique = records.filter(r => { if (seen.has(r.phone)) return false; seen.add(r.phone); return true; });

    let imported = 0;
    let duplicates = 0;
    const chunkSize = 500;
    for (let i = 0; i < unique.length; i += chunkSize) {
      const chunk = unique.slice(i, i + chunkSize);
      const { data, error } = await supabase.from('leads').insert(chunk).select('id').onConflict?.('phone,user_id') || await supabase.from('leads').insert(chunk).select('id');
      if (!error) imported += data?.length || chunk.length;
      else duplicates += chunk.length;
    }

    res.status(201).json({
      success: true,
      imported,
      dnc_flagged: unique.filter(r => r.is_on_dnc).length,
      duplicates_skipped: duplicates,
      total_received: leads.length,
    });
  } catch (err) { next(err); }
});

// PUT /api/leads/:id
router.put('/:id', async (req, res, next) => {
  try {
    const allowed = ['first_name','last_name','email','phone','property_address','property_city','property_state','property_zip','property_type','estimated_value','estimated_equity','estimated_arv','source','status','motivation_score','notes','tags'];
    const updates = { updated_at: new Date().toISOString() };
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    const { data, error } = await supabase.from('leads').update(updates).eq('id', req.params.id).eq('user_id', req.user.id).select().single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// DELETE /api/leads/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const { error } = await supabase.from('leads').delete().eq('id', req.params.id).eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { next(err); }
});

// GET /api/leads/:id/research — AI property analysis
router.get('/:id/research', async (req, res, next) => {
  try {
    const { data: lead } = await supabase.from('leads').select('*').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    const analysis = await aiService.analyzePropertyOffer({ address: lead.property_address, city: lead.property_city, state: lead.property_state, estimatedValue: lead.estimated_value });
    if (analysis) {
      await supabase.from('leads').update({ estimated_arv: analysis.estimated_arv }).eq('id', req.params.id);
    }
    res.json({ success: true, data: analysis });
  } catch (err) { next(err); }
});

// POST /api/leads/:id/dnc
router.post('/:id/dnc', async (req, res, next) => {
  try {
    const { data: lead } = await supabase.from('leads').select('phone').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    await supabase.from('dnc_records').upsert([{ id: uuidv4(), phone: lead.phone, added_by: req.user.id, reason: req.body.reason || 'manual' }]);
    await supabase.from('leads').update({ is_on_dnc: true, status: 'dnc' }).eq('id', req.params.id);
    res.json({ success: true, message: 'Added to DNC' });
  } catch (err) { next(err); }
});

function parseNum(v) { const n = parseFloat(String(v || '').replace(/[^0-9.]/g, '')); return isNaN(n) ? null : n; }

module.exports = router;
