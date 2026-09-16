const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const { normalizeBuyer } = require('../utils/buyerFields');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const { state, type, max_price, limit = 100, offset = 0 } = req.query;
    // Cap page size at 500 so one request can't pull an entire buyer list.
    const safeLimit  = Math.min(Math.max(Number(limit)  || 100, 1), 500);
    const safeOffset = Math.max(Number(offset) || 0, 0);
    let q = supabase.from('buyers').select('*', { count: 'exact' }).eq('user_id', req.user.id)
      .order('created_at', { ascending: false }).range(safeOffset, safeOffset + safeLimit - 1);
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
    const { row, errors } = normalizeBuyer({ repair_tolerance: 'any', ...req.body });
    if (errors.length) return res.status(400).json({ success: false, error: errors.join('; ') });
    const record = { ...row, user_id: req.user.id, source: row.source || 'manual' };
    // One buyer per (user_id, phone): re-adding an existing buyer updates that row.
    // The id is left to the database default so an update never rewrites the key.
    const query = record.phone
      ? supabase.from('buyers').upsert(record, { onConflict: 'user_id,phone' })
      : supabase.from('buyers').insert([record]);
    const { data, error } = await query.select().single();
    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /api/buyers/bulk - CSV / list import. Flexible header mapping, phone dedup,
// chunked upsert. Rows that fail validation are skipped and reported, not guessed.
const MAX_BULK_BUYERS = 10000;
router.post('/bulk', async (req, res, next) => {
  try {
    const { buyers } = req.body;
    if (!Array.isArray(buyers) || !buyers.length) return res.status(400).json({ success: false, error: 'buyers array required' });
    if (buyers.length > MAX_BULK_BUYERS) {
      return res.status(400).json({ success: false, error: `Too many rows (${buyers.length}). Max ${MAX_BULK_BUYERS} per import.` });
    }

    const pick = (b, ...keys) => {
      for (const k of keys) {
        const val = b?.[k] ?? b?.[k?.toLowerCase?.()] ?? b?.[k?.toUpperCase?.()];
        if (val !== undefined && val !== null && String(val).trim()) return Array.isArray(val) ? val : String(val).trim();
      }
      return undefined;
    };

    const rejected = [];
    const seen = new Set();
    let duplicatesInFile = 0;
    const rows = [];
    buyers.forEach((b, i) => {
      const input = {
        name:             pick(b, 'name', 'Name', 'Full Name', 'FullName', 'buyer_name', 'Buyer Name', 'Company', 'Contact') || pick(b, 'phone', 'Phone'),
        phone:            pick(b, 'phone', 'Phone', 'phone_number', 'Phone Number', 'PhoneNumber', 'Mobile', 'Cell', 'Contact Phone') ?? '',
        email:            pick(b, 'email', 'Email', 'Email Address', 'EmailAddress') ?? '',
        buyer_type:       pick(b, 'buyer_type', 'Buyer Type', 'type', 'Type') ?? '',
        buy_box_states:   pick(b, 'buy_box_states', 'Buy Box States', 'States', 'state', 'State', 'Markets', 'Target States') ?? [],
        buy_box_types:    pick(b, 'buy_box_types', 'Buy Box Types', 'Property Types', 'property_types', 'Types', 'Asset Types') ?? [],
        property_cities:  pick(b, 'property_cities', 'Cities', 'cities', 'City', 'Target Cities', 'Buy Box Cities') ?? [],
        buy_box_zips:     pick(b, 'buy_box_zips', 'Zips', 'zips', 'Zip Codes', 'Zip', 'Target Zips') ?? [],
        max_price:        pick(b, 'max_price', 'Max Price', 'Max Purchase Price', 'MaxPrice', 'budget', 'Budget', 'Price Cap') ?? null,
        min_price:        pick(b, 'min_price', 'Min Price', 'Min Purchase Price', 'MinPrice', 'Price Floor') ?? null,
        repair_tolerance: pick(b, 'repair_tolerance', 'Repair Tolerance', 'rehab', 'Rehab') ?? 'any',
        notes:            pick(b, 'notes', 'Notes', 'note', 'Note', 'Comments') ?? '',
      };
      const { row, errors } = normalizeBuyer(input);
      if (errors.length) { rejected.push({ row: i + 1, errors }); return; }
      const key = row.phone || `name:${row.name.toLowerCase()}`;
      if (seen.has(key)) { duplicatesInFile += 1; return; }
      seen.add(key);
      rows.push({ ...row, user_id: req.user.id, source: 'import' });
    });

    let imported = 0;
    let failed = 0;
    const chunkSize = 500;
    const withPhone = rows.filter(r => r.phone);
    const withoutPhone = rows.filter(r => !r.phone);
    for (let i = 0; i < withPhone.length; i += chunkSize) {
      const chunk = withPhone.slice(i, i + chunkSize);
      const { data, error } = await supabase.from('buyers')
        .upsert(chunk, { onConflict: 'user_id,phone', ignoreDuplicates: true }).select('id');
      if (error) { failed += chunk.length; console.error('[Buyers import] upsert error:', error.message); }
      else imported += data?.length || 0;
    }
    for (let i = 0; i < withoutPhone.length; i += chunkSize) {
      const chunk = withoutPhone.slice(i, i + chunkSize);
      const { data, error } = await supabase.from('buyers').insert(chunk).select('id');
      if (error) { failed += chunk.length; console.error('[Buyers import] insert error:', error.message); }
      else imported += data?.length || 0;
    }

    res.status(201).json({
      success: true,
      imported,
      duplicates_skipped: duplicatesInFile + Math.max(0, withPhone.length + withoutPhone.length - imported - failed),
      invalid: rejected.length,
      invalid_rows: rejected.slice(0, 20),
      failed,
      total_received: buyers.length,
    });
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { row: updates, errors } = normalizeBuyer(req.body, { partial: true });
    if (errors.length) return res.status(400).json({ success: false, error: errors.join('; ') });
    if (req.body.nca_signed_at !== undefined) updates.nca_signed_at = req.body.nca_signed_at || null;
    if (!Object.keys(updates).length) return res.status(400).json({ success: false, error: 'No valid fields to update' });
    if (['buy_box_states', 'buy_box_types', 'property_cities', 'buy_box_zips', 'max_price', 'min_price'].some(k => k in updates)) {
      updates.buybox_updated_at = new Date().toISOString();
    }
    const { data, error } = await supabase.from('buyers').update(updates)
      .eq('id', req.params.id).eq('user_id', req.user.id).select().maybeSingle();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ success: false, error: 'Another buyer already has this phone number' });
      throw error;
    }
    if (!data) return res.status(404).json({ success: false, error: 'Buyer not found' });
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

// GET /api/buyers/:id/score - Feature 14: reliability score 0-100 + A/B/C/D tier.
// Counts this operator's closed deals with the buyer (best-effort) and scores
// proof-of-funds, NCA, buy box, and reachability. Read-only, never throws on a
// missing column - degrades to whatever fields exist on the row.
router.get('/:id/score', async (req, res, next) => {
  try {
    const { data: buyer, error } = await supabase.from('buyers')
      .select('*').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (error) throw error;
    if (!buyer) return res.status(404).json({ success: false, error: 'Buyer not found' });

    // Best-effort closed-deal count for this buyer; tolerate a missing buyer_id column.
    let closedDeals = 0;
    try {
      const { count } = await supabase.from('deals')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', req.user.id)
        .eq('buyer_id', req.params.id)
        .in('status', ['closed', 'closed_won', 'funded']);
      closedDeals = count || 0;
    } catch (_) { /* column may not exist yet - score without it */ }

    const { calculateBuyerScore } = require('../services/buyerScoreService');
    const result = calculateBuyerScore(buyer, { closedDeals });
    res.json({ success: true, data: { buyer_id: req.params.id, ...result, closed_deals: closedDeals } });
  } catch (err) { next(err); }
});

// GET /api/buyers/deal-view/:leadId - Feature 13/10: buyer-SAFE view of a lead.
// Runs the lead through contactMasking so a buyer sees the deal (market, financials,
// blurred address) but never the seller's raw phone, email, or exact street address.
// Still operator-auth-gated - this is what the operator forwards, not a public link.
router.get('/deal-view/:leadId', async (req, res, next) => {
  try {
    const { data: lead, error } = await supabase.from('leads')
      .select('*').eq('id', req.params.leadId).eq('user_id', req.user.id).single();
    if (error) throw error;
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

    const { maskLeadForBuyer } = require('../services/contactMasking');
    res.json({ success: true, data: maskLeadForBuyer(lead) });
  } catch (err) { next(err); }
});

module.exports = router;
