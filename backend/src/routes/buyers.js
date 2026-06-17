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

// POST /api/buyers/bulk — CSV / list import. Flexible header mapping, phone-dedup,
// chunked insert. Mirrors leads.js /bulk so a single CSV upload can seed a buyers
// list (the buy side of the auto-disposition loop).
router.post('/bulk', async (req, res, next) => {
  try {
    const { buyers } = req.body;
    if (!Array.isArray(buyers) || !buyers.length) return res.status(400).json({ success: false, error: 'buyers array required' });

    // Normalize one CSV-ish value across the common header spellings.
    const pick = (b, ...keys) => {
      for (const k of keys) {
        const val = b[k] ?? b[k?.toLowerCase?.()] ?? b[k?.toUpperCase?.()];
        if (val !== undefined && val !== null && String(val).trim()) return String(val).trim();
      }
      return '';
    };
    // Accept either an array already, or a comma/pipe/semicolon-separated string.
    const toArray = (v) => {
      if (Array.isArray(v)) return v.map(s => String(s).trim().toUpperCase()).filter(Boolean);
      if (!v) return [];
      return String(v).split(/[,;|]/).map(s => s.trim().toUpperCase()).filter(Boolean);
    };
    const toNum = (v) => {
      if (v === undefined || v === null || v === '') return null;
      const n = Number(String(v).replace(/[$,\s]/g, ''));
      return Number.isFinite(n) ? n : null;
    };

    const mapped = buyers.map(b => ({
      id:               uuidv4(),
      user_id:          req.user.id,
      name:             pick(b, 'name', 'Name', 'Full Name', 'FullName', 'buyer_name', 'Buyer Name', 'Company', 'Contact'),
      phone:            pick(b, 'phone', 'Phone', 'phone_number', 'Phone Number', 'PhoneNumber', 'Mobile', 'Cell', 'Contact Phone'),
      email:            pick(b, 'email', 'Email', 'Email Address', 'EmailAddress') || null,
      buyer_type:       pick(b, 'buyer_type', 'Buyer Type', 'type', 'Type') || null,
      buy_box_states:   toArray(b.buy_box_states ?? pick(b, 'buy_box_states', 'Buy Box States', 'States', 'state', 'State', 'Markets')),
      buy_box_types:    toArray(b.buy_box_types  ?? pick(b, 'buy_box_types', 'Buy Box Types', 'Property Types', 'Types')),
      max_price:        toNum(b.max_price ?? pick(b, 'max_price', 'Max Price', 'Max Purchase Price', 'MaxPrice', 'budget', 'Budget')),
      repair_tolerance: pick(b, 'repair_tolerance', 'Repair Tolerance', 'rehab', 'Rehab') || 'any',
      notes:            pick(b, 'notes', 'Notes', 'note', 'Note') || null,
    }));

    // Dedup by phone within the batch (keep first); rows with no phone keep all
    // (a buyer can be email-only) but are de-duped by name to avoid obvious repeats.
    const seenPhone = new Set();
    const seenName  = new Set();
    const unique = mapped.filter(r => {
      if (r.phone) { if (seenPhone.has(r.phone)) return false; seenPhone.add(r.phone); return true; }
      if (r.name)  { const key = r.name.toLowerCase(); if (seenName.has(key)) return false; seenName.add(key); return true; }
      return false; // no phone AND no name — drop
    });

    if (!unique.length) return res.status(400).json({ success: false, error: 'No valid buyers (need a name or phone)' });

    // Skip buyers whose phone already exists for this operator (no unique constraint
    // on the table, so we filter explicitly rather than rely on upsert).
    const phones = unique.map(r => r.phone).filter(Boolean);
    let existingPhones = new Set();
    if (phones.length) {
      const { data: existing } = await supabase
        .from('buyers').select('phone').eq('user_id', req.user.id).in('phone', phones);
      existingPhones = new Set((existing || []).map(e => e.phone));
    }
    const toInsert = unique.filter(r => !r.phone || !existingPhones.has(r.phone));

    let imported = 0;
    const chunkSize = 500;
    for (let i = 0; i < toInsert.length; i += chunkSize) {
      const chunk = toInsert.slice(i, i + chunkSize);
      const { data, error } = await supabase.from('buyers').insert(chunk).select('id');
      if (!error) imported += data?.length || chunk.length;
      else console.warn('[Buyers import] insert error:', error.message);
    }

    res.status(201).json({
      success: true,
      imported,
      duplicates_skipped: unique.length - toInsert.length,
      total_received: buyers.length,
    });
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
