const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const axios    = require('axios');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// POST /api/phones/provision — buy a number from Vapi, store in Veori
router.post('/provision', async (req, res, next) => {
  try {
    const { area_code, friendly_name } = req.body;

    // Purchase from Vapi
    const vapiKey = process.env.VAPI_API_KEY;
    if (!vapiKey) return res.status(500).json({ success: false, error: 'Vapi API key not configured' });

    // Build inbound webhook URL — Railway sets RAILWAY_PUBLIC_DOMAIN automatically
    const webhookUrl = process.env.VAPI_WEBHOOK_URL
      || (process.env.RAILWAY_PUBLIC_DOMAIN
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/vapi/webhook`
        : null);

    // ── STEP 1: Buy a real Twilio number through Vapi ───────────────────────────
    // provider: 'twilio' gives real US phone numbers (+1XXXXXXXXXX) that can
    // call any cell phone. Vapi handles Twilio billing — no separate account needed.
    if (!area_code) return res.status(400).json({ success: false, error: 'area_code is required to buy a real phone number (e.g. 704 for Charlotte NC)' });

    let vapiNumber;
    try {
      const vapiRes = await axios.post('https://api.vapi.ai/phone-number', {
        provider: 'twilio',
        areaCode: String(area_code),
        name: friendly_name || `Veori Line (${area_code})`,
        ...(webhookUrl ? { serverUrl: webhookUrl } : {}),
        ...(process.env.VAPI_WEBHOOK_SECRET ? { serverUrlSecret: process.env.VAPI_WEBHOOK_SECRET } : {}),
      }, {
        headers: { Authorization: `Bearer ${vapiKey}`, 'Content-Type': 'application/json' },
        timeout: 30000,
      });
      vapiNumber = vapiRes.data;
      console.log('[Phone] Vapi provision response:', JSON.stringify(vapiNumber));
    } catch (vapiErr) {
      const msg = vapiErr.response?.data?.message || vapiErr.response?.data?.error || vapiErr.message;
      return res.status(502).json({ success: false, error: `Vapi error: ${msg}` });
    }

    // Twilio numbers come back as real E.164 numbers e.g. +17045551234
    const resolvedNumber = vapiNumber.number || vapiNumber.phoneNumber || vapiNumber.id;

    // ── STEP 2: Assign number to this operator's Vapi assistant ─────────────────
    // Looks up operator's vapi_assistant_id from DB, falls back to env var.
    // This wires inbound callbacks to Alex for this specific operator.
    const { data: operatorData } = await supabase
      .from('users')
      .select('vapi_assistant_id')
      .eq('id', req.user.id)
      .single();

    const assistantId = operatorData?.vapi_assistant_id || process.env.VAPI_ASSISTANT_ID;

    if (assistantId) {
      await axios.patch(`https://api.vapi.ai/phone-number/${vapiNumber.id}`, {
        assistantId,
      }, {
        headers: { Authorization: `Bearer ${vapiKey}`, 'Content-Type': 'application/json' },
        timeout: 15000,
      }).catch(e => console.warn('[Phone] Failed to assign assistant to number:', e.message));
    }

    // Determine if this is the operator's first number → mark primary
    const { count: existingCount } = await supabase
      .from('phone_numbers')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.user.id)
      .is('released_at', null);
    const isFirstNumber = (existingCount || 0) === 0;

    // Save to Supabase
    const { data, error } = await supabase.from('phone_numbers').insert([{
      id: uuidv4(),
      user_id: req.user.id,
      number: resolvedNumber,
      friendly_name: friendly_name || resolvedNumber,
      area_code: area_code || vapiNumber.number?.replace(/\D/g, '').slice(1, 4) || null,
      vapi_phone_number_id: vapiNumber.id,
      health_status: 'healthy',
      is_active: true,
      daily_call_limit: 50,
      monthly_cost: 2.15,
      purchased_at: new Date().toISOString(),
      is_primary: isFirstNumber,
    }]).select().single();
    if (error) throw error;

    res.status(201).json({ success: true, data, vapi_id: vapiNumber.id, number: vapiNumber.number });
  } catch (err) { next(err); }
});

// GET /api/phones/plan-status — beta: unlimited numbers
router.get('/plan-status', async (req, res, next) => {
  try {
    const { count } = await supabase.from('phone_numbers').select('*', { count: 'exact', head: true }).eq('user_id', req.user.id);
    res.json({ success: true, tier: 'beta', used: count || 0, limit: 999, can_provision: true });
  } catch (err) { next(err); }
});

// POST /api/phones/sync-vapi — import all numbers from Vapi account into Veori
router.post('/sync-vapi', async (req, res, next) => {
  try {
    const vapiKey = process.env.VAPI_API_KEY;
    if (!vapiKey) return res.status(500).json({ success: false, error: 'Vapi API key not configured' });

    // Fetch all numbers from Vapi
    const { data: vapiNumbers } = await axios.get('https://api.vapi.ai/phone-number', {
      headers: { Authorization: `Bearer ${vapiKey}` },
      timeout: 15000,
    });
    const numbers = Array.isArray(vapiNumbers) ? vapiNumbers : (vapiNumbers?.results || []);

    // Get already-imported Vapi IDs for this user
    const { data: existing } = await supabase.from('phone_numbers').select('vapi_phone_number_id').eq('user_id', req.user.id);
    const existingIds = new Set((existing || []).map(p => p.vapi_phone_number_id).filter(Boolean));

    const webhookUrl = process.env.VAPI_WEBHOOK_URL
      || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/vapi/webhook` : null);

    const toImport = numbers.filter(n => n.id && !existingIds.has(n.id));
    if (!toImport.length) return res.json({ success: true, imported: 0, message: 'All Vapi numbers already synced' });

    // Wire inbound webhook on each number in Vapi if not already set
    if (webhookUrl) {
      await Promise.all(toImport.map(n =>
        axios.patch(`https://api.vapi.ai/phone-number/${n.id}`, { serverUrl: webhookUrl }, {
          headers: { Authorization: `Bearer ${vapiKey}` },
          timeout: 10000,
        }).catch(() => {})
      ));
    }

    const records = toImport.map(n => ({
      id: uuidv4(),
      user_id: req.user.id,
      number: n.number,
      friendly_name: n.name || n.number,
      area_code: n.number?.replace(/\D/g, '').slice(1, 4) || null,
      vapi_phone_number_id: n.id,
      health_status: 'healthy',
      is_active: true,
      daily_call_limit: 50,
    }));

    const { data: inserted, error } = await supabase.from('phone_numbers').insert(records).select();
    if (error) throw error;

    res.json({ success: true, imported: inserted.length, numbers: inserted });
  } catch (err) { next(err); }
});

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

// POST /api/phones/:id/release — soft-delete: cancel in Vapi + mark released in DB
router.post('/:id/release', async (req, res, next) => {
  try {
    const { reason } = req.body;
    const { data: phone, error: fetchErr } = await supabase
      .from('phone_numbers')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    if (fetchErr || !phone) return res.status(404).json({ success: false, error: 'Phone number not found' });
    if (phone.released_at) return res.status(400).json({ success: false, error: 'Number already released' });

    // Delete from Vapi (best-effort — don't block on failure)
    const vapiKey = process.env.VAPI_API_KEY;
    if (phone.vapi_phone_number_id && vapiKey) {
      await axios.delete(`https://api.vapi.ai/phone-number/${phone.vapi_phone_number_id}`, {
        headers: { Authorization: `Bearer ${vapiKey}` },
        timeout: 15000,
      }).catch(e => console.warn('[Phone] Vapi release failed:', e.message));
    }

    // Soft-delete in DB
    const { data: updated, error: updateErr } = await supabase
      .from('phone_numbers')
      .update({
        is_active: false,
        released_at: new Date().toISOString(),
        release_reason: reason || 'operator_released',
        health_status: 'released',
        is_primary: false,
      })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select()
      .single();
    if (updateErr) throw updateErr;

    res.json({ success: true, message: 'Phone number released', data: updated });
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
