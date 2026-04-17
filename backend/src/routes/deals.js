if (process.env.NODE_ENV !== 'production') require('dotenv').config();
const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const contractService = require('../services/contractService');

const router = express.Router();
router.use(requireAuth);

// GET /api/deals
router.get('/', async (req, res, next) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;
    let q = supabase.from('deals').select('*, leads(first_name, last_name, phone)', { count: 'exact' })
      .eq('user_id', req.user.id).order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);
    if (status) q = q.eq('status', status);
    const { data, error, count } = await q;
    if (error) throw error;
    res.json({ success: true, data, total: count });
  } catch (err) { next(err); }
});

// GET /api/deals/:id
router.get('/:id', async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('deals').select('*, leads(*), buyer_campaigns(*, buyers(*))')
      .eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'Deal not found' });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /api/deals
router.post('/', async (req, res, next) => {
  try {
    const { lead_id, property_address, property_city, property_state, arv, repair_estimate, offer_price } = req.body;
    const mao = arv && repair_estimate ? (arv * 0.70) - repair_estimate : null;
    const { data, error } = await supabase.from('deals').insert([{
      id: uuidv4(), user_id: req.user.id, lead_id, property_address, property_city, property_state,
      arv, repair_estimate, mao, offer_price, status: 'new'
    }]).select().single();
    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
});

// PUT /api/deals/:id
router.put('/:id', async (req, res, next) => {
  try {
    const allowed = ['property_address','property_city','property_state','arv','repair_estimate','mao','offer_price','seller_agreed_price','buyer_price','assignment_fee','status','title_company_id','closing_date','seller_contract_url','buyer_contract_url'];
    const updates = { updated_at: new Date().toISOString() };
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    const { data, error } = await supabase.from('deals').update(updates).eq('id', req.params.id).eq('user_id', req.user.id).select().single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /api/deals/:id/generate-contract
router.post('/:id/generate-contract', async (req, res, next) => {
  try {
    const { type = 'psa' } = req.body; // psa | assignment
    const { data: deal } = await supabase.from('deals').select('*, leads(*)').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (!deal) return res.status(404).json({ success: false, error: 'Deal not found' });
    const result = await contractService.generate(deal, type);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// POST /api/deals/:id/send-contract
router.post('/:id/send-contract', async (req, res, next) => {
  try {
    const { type = 'psa', recipient_phone, recipient_email } = req.body;
    const { data: deal } = await supabase.from('deals').select('*, leads(*)').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (!deal) return res.status(404).json({ success: false, error: 'Deal not found' });
    const result = await contractService.send(deal, type, { phone: recipient_phone, email: recipient_email });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// POST /api/deals/:id/start-buyer-campaign
router.post('/:id/start-buyer-campaign', async (req, res, next) => {
  try {
    const { data: deal } = await supabase.from('deals').select('*').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (!deal) return res.status(404).json({ success: false, error: 'Deal not found' });

    // Find matching buyers
    const { data: buyers } = await supabase.from('buyers')
      .select('*').eq('user_id', req.user.id).eq('is_active', true)
      .or(`buy_box_states.cs.{"${deal.property_state}"},buy_box_states.eq.{}`)
      .lte('max_price', deal.buyer_price || deal.offer_price * 1.1);

    const campaignId = uuidv4();
    const { data: campaign } = await supabase.from('buyer_campaigns').insert([{
      id: campaignId, user_id: req.user.id, deal_id: req.params.id, status: 'active',
      buyers_called: 0, started_at: new Date().toISOString()
    }]).select().single();

    res.json({ success: true, data: { campaign, buyers_matched: buyers?.length || 0 } });
  } catch (err) { next(err); }
});

module.exports = router;
