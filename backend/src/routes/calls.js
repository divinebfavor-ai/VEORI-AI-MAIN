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
    const { data, error } = await supabase.from('calls').select('*, leads(first_name, last_name, phone, property_address, motivation_score, primary_tag), phone_numbers(number)')
      .eq('user_id', req.user.id).in('status', ['initiated', 'ringing', 'in-progress']);
    if (error) throw error;
    const flat = (data || []).map(c => ({
      ...c,
      lead_name: c.leads ? `${c.leads.first_name || ''} ${c.leads.last_name || ''}`.trim() || 'Unknown Seller' : 'Unknown Seller',
      property_address: c.leads?.property_address || c.property_address || 'Address unknown',
      motivation_score: c.leads?.motivation_score ?? c.motivation_score,
      primary_tag: c.leads?.primary_tag || c.primary_tag,
    }));
    res.json({ success: true, data: flat });
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

    // Load operator profile for personalized AI
    const { data: operatorProfile } = await supabase.from('users')
      .select('ai_caller_name, ai_voice_id, ai_personality_tone, ai_intro_script, company_name, id')
      .eq('id', req.user.id).single();

    // Send SMS disclosure before calling — TCPA best practice
    // Fire-and-forget: don't block the call if SMS fails
    const { getOpeningSMS } = require('../services/leadTaggingService');
    const smsBody = getOpeningSMS(lead);
    supabase.from('conversations').insert({
      user_id:    req.user.id,
      lead_id:    lead.id,
      direction:  'outbound',
      channel:    'sms',
      body:       smsBody,
      sent_at:    new Date().toISOString(),
      status:     'sent',
    }).then(() => {
      console.log(`[Call] Pre-call SMS queued for lead ${lead.id}`);
    }).catch(e => console.warn('[Call] Pre-call SMS log failed:', e.message));

    // Initiate Vapi call with operator persona
    const vapiCall = await vapiService.initiateCall({ lead, phoneNumber: phoneNum, callId, operator: operatorProfile || {} });

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

// PUT /api/calls/:id — update outcome, notes, score after manual call
router.put('/:id', async (req, res, next) => {
  try {
    const allowed = ['outcome', 'notes', 'motivation_score', 'status', 'ai_summary'];
    const updates = {};
    for (const k of allowed) { if (req.body[k] !== undefined) updates[k] = req.body[k]; }
    updates.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('calls').update(updates)
      .eq('id', req.params.id).eq('user_id', req.user.id).select().single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/calls/:id/listen — get Vapi listen URL for live monitoring
router.get('/:id/listen', async (req, res, next) => {
  try {
    const { data: call } = await supabase.from('calls')
      .select('vapi_call_id, status')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    if (!call) return res.status(404).json({ success: false, error: 'Call not found' });
    if (!call.vapi_call_id) return res.status(400).json({ success: false, error: 'No Vapi call ID' });

    const listenUrl = await vapiService.getListenUrl(call.vapi_call_id);
    if (!listenUrl) return res.status(404).json({ success: false, error: 'Listen URL not available yet — call may still be connecting' });

    res.json({ success: true, listen_url: listenUrl });
  } catch (err) { next(err); }
});

// POST /api/calls/:id/listen-join — proxy WebRTC SDP offer to Vapi (avoids browser CORS)
router.post('/:id/listen-join', async (req, res, next) => {
  try {
    const { sdp } = req.body;
    if (!sdp) return res.status(400).json({ success: false, error: 'SDP offer required' });

    const { data: call } = await supabase.from('calls')
      .select('vapi_call_id')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    if (!call?.vapi_call_id) return res.status(404).json({ success: false, error: 'Call not found or no Vapi ID' });

    const listenUrl = await vapiService.getListenUrl(call.vapi_call_id);
    if (!listenUrl) return res.status(404).json({ success: false, error: 'Listen URL not available yet' });

    // Proxy SDP exchange to Vapi on behalf of browser (no CORS issues)
    const axios = require('axios');
    const response = await axios.post(listenUrl, sdp, {
      headers: { 'Content-Type': 'application/sdp' },
      responseType: 'text',
      timeout: 10000,
    });

    res.set('Content-Type', 'application/sdp');
    res.send(response.data);
  } catch (err) {
    if (err.response) {
      return res.status(err.response.status).json({ success: false, error: `Vapi listen failed: ${err.response.status}` });
    }
    next(err);
  }
});

// POST /api/calls/:id/end — manually end a live call
router.post('/:id/end', async (req, res, next) => {
  try {
    const { data: call } = await supabase.from('calls').select('vapi_call_id')
      .eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (call?.vapi_call_id) {
      vapiService.endCall?.(call.vapi_call_id).catch(() => {});
    }
    await supabase.from('calls').update({ status: 'ended', ended_at: new Date().toISOString() })
      .eq('id', req.params.id).eq('user_id', req.user.id);
    res.json({ success: true });
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
