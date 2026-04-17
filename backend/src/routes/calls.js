const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const vapiService = require('../services/vapiService');
const phoneRotation = require('../services/phoneRotation');
const campaignManager = require('../services/campaignManager');

const router = express.Router();
router.use(requireAuth);

// GET /api/calls — list with filters
router.get('/', async (req, res, next) => {
  try {
    const { lead_id, status, campaign_id, limit = 50, offset = 0, date_from, date_to } = req.query;
    let q = supabase.from('calls').select('*, leads(first_name, last_name, phone, property_address), phone_numbers(number, friendly_name)', { count: 'exact' })
      .eq('user_id', req.user.id).order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);
    if (lead_id)  q = q.eq('lead_id', lead_id);
    if (status)   q = q.eq('status', status);
    if (date_from) q = q.gte('created_at', date_from);
    if (date_to)   q = q.lte('created_at', date_to);
    const { data, error, count } = await q;
    if (error) throw error;
    res.json({ success: true, data, total: count, limit: Number(limit), offset: Number(offset) });
  } catch (err) { next(err); }
});

// GET /api/calls/live — all active calls
router.get('/live', async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('calls').select('*, leads(first_name, last_name, phone, property_address), phone_numbers(number)')
      .eq('user_id', req.user.id).in('status', ['initiated', 'ringing', 'in-progress']);
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/calls/:id
router.get('/:id', async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('calls').select('*, leads(*), phone_numbers(*)')
      .eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'Call not found' });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /api/calls/initiate — single call
router.post('/initiate', async (req, res, next) => {
  try {
    const { lead_id, phone_number_id } = req.body;
    if (!lead_id) return res.status(400).json({ success: false, error: 'lead_id required' });

    const { data: lead } = await supabase.from('leads').select('*').eq('id', lead_id).eq('user_id', req.user.id).single();
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    if (lead.is_on_dnc) return res.status(400).json({ success: false, error: 'Lead is on DNC list' });

    // Select best phone number if not specified
    const phoneNum = phone_number_id
      ? (await supabase.from('phone_numbers').select('*').eq('id', phone_number_id).single()).data
      : await phoneRotation.selectBestNumber(req.user.id, lead.property_state);

    if (!phoneNum) return res.status(400).json({ success: false, error: 'No healthy phone numbers available' });

    // Create call record
    const callId = uuidv4();
    const { data: callRecord } = await supabase.from('calls').insert([{
      id: callId, user_id: req.user.id, lead_id, phone_number_id: phoneNum.id,
      status: 'initiated', started_at: new Date().toISOString()
    }]).select().single();

    // Initiate Vapi call
    const vapiCall = await vapiService.initiateCall({ lead, phoneNumber: phoneNum, callId });

    // Update call with Vapi ID
    await supabase.from('calls').update({ vapi_call_id: vapiCall.id, status: 'ringing' }).eq('id', callId);
    await phoneRotation.recordCallStart(phoneNum.id);
    await supabase.from('leads').update({ call_count: (lead.call_count || 0) + 1, last_call_date: new Date().toISOString(), status: 'calling' }).eq('id', lead_id);

    res.json({ success: true, data: { ...callRecord, vapi_call_id: vapiCall.id } });
  } catch (err) { next(err); }
});

// POST /api/calls/campaign/start
router.post('/campaign/start', async (req, res, next) => {
  try {
    const { campaign_id } = req.body;
    if (!campaign_id) return res.status(400).json({ success: false, error: 'campaign_id required' });
    const result = await campaignManager.start(campaign_id, req.user.id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// POST /api/calls/campaign/pause
router.post('/campaign/pause', async (req, res, next) => {
  try {
    const { campaign_id } = req.body;
    await campaignManager.pause(campaign_id);
    res.json({ success: true, message: 'Campaign paused' });
  } catch (err) { next(err); }
});

// POST /api/calls/campaign/stop
router.post('/campaign/stop', async (req, res, next) => {
  try {
    const { campaign_id } = req.body;
    await campaignManager.stop(campaign_id);
    res.json({ success: true, message: 'Campaign stopped' });
  } catch (err) { next(err); }
});

// POST /api/calls/takeover — operator takes over live call
router.post('/takeover', async (req, res, next) => {
  try {
    const { call_id } = req.body;
    const { data: call } = await supabase.from('calls').select('*').eq('id', call_id).eq('user_id', req.user.id).single();
    if (!call) return res.status(404).json({ success: false, error: 'Call not found' });

    await vapiService.muteAssistant(call.vapi_call_id);
    await supabase.from('calls').update({ operator_took_over: true }).eq('id', call_id);

    // Get coaching suggestions based on latest transcript
    const coaching = call.transcript
      ? await require('../services/aiService').getCoachingSuggestions(call.transcript)
      : { suggestions: [], objection_responses: [], offer_recommendation: null };

    res.json({ success: true, message: 'Takeover active — you are live', coaching });
  } catch (err) { next(err); }
});

// POST /api/calls/return-to-ai
router.post('/return-to-ai', async (req, res, next) => {
  try {
    const { call_id } = req.body;
    const { data: call } = await supabase.from('calls').select('*').eq('id', call_id).eq('user_id', req.user.id).single();
    if (!call) return res.status(404).json({ success: false, error: 'Call not found' });
    await vapiService.unmuteAssistant(call.vapi_call_id);
    res.json({ success: true, message: 'AI back in control' });
  } catch (err) { next(err); }
});

module.exports = router;
