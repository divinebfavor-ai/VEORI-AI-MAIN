// Vapi Webhook Handler + AI Assistant endpoint
const express  = require('express');
const supabase = require('../config/supabase');
const aiService = require('../services/aiService');
const { requireAuth, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// POST /api/vapi/webhook — Vapi sends all call events here
router.post('/webhook', async (req, res) => {
  try {
    const event = req.body;
    const { type, call } = event;

    console.log(`[Vapi Webhook] Event: ${type}`, call?.id);

    switch (type) {
      case 'call-started':
        await handleCallStarted(call);
        break;
      case 'transcript':
      case 'transcript-update':
        await handleTranscript(event);
        break;
      case 'call-ended':
        await handleCallEnded(call, event);
        break;
      case 'speech-update':
      case 'status-update':
        await handleStatusUpdate(call);
        break;
      default:
        console.log(`[Vapi] Unhandled event type: ${type}`);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[Vapi Webhook Error]', err);
    res.status(500).json({ success: false });
  }
});

async function handleCallStarted(call) {
  if (!call?.id) return;
  await supabase.from('calls').update({ status: 'in-progress', started_at: new Date().toISOString() })
    .eq('vapi_call_id', call.id);
}

async function handleTranscript(event) {
  const { call, transcript, role, transcriptType } = event;
  if (!call?.id || transcriptType !== 'final') return;

  // Append transcript line
  const { data: callRec } = await supabase.from('calls').select('transcript, lead_id, motivation_score').eq('vapi_call_id', call.id).single();
  if (!callRec) return;

  const speaker = role === 'assistant' ? 'Alex' : 'Seller';
  const newLine  = `${speaker}: ${transcript}`;
  const fullTranscript = callRec.transcript ? `${callRec.transcript}\n${newLine}` : newLine;

  // Real-time motivation scoring every 5 lines
  const lineCount = (fullTranscript.match(/\n/g) || []).length;
  let scoreUpdate = {};
  if (lineCount > 0 && lineCount % 5 === 0) {
    try {
      const analysis = await aiService.scoreMotivation(fullTranscript, callRec.lead_id);
      scoreUpdate = { motivation_score: analysis.score };
      // Update lead score too
      if (callRec.lead_id) {
        await supabase.from('leads').update({ motivation_score: analysis.score }).eq('id', callRec.lead_id);
      }
    } catch (e) { console.error('[Vapi] Score error:', e.message); }
  }

  await supabase.from('calls').update({ transcript: fullTranscript, ...scoreUpdate }).eq('vapi_call_id', call.id);
}

async function handleCallEnded(call, event) {
  if (!call?.id) return;

  const { data: callRec } = await supabase.from('calls').select('*, leads(*)').eq('vapi_call_id', call.id).single();
  if (!callRec) return;

  const duration = call.endedAt && call.startedAt
    ? Math.round((new Date(call.endedAt) - new Date(call.startedAt)) / 1000)
    : callRec.duration_seconds;

  // Run full AI analysis
  let aiAnalysis = {};
  if (callRec.transcript) {
    try {
      aiAnalysis = await aiService.analyzeCallTranscript(callRec.transcript, callRec.leads);
    } catch (e) { console.error('[Vapi] AI analysis error:', e.message); }
  }

  await supabase.from('calls').update({
    status: 'ended',
    ended_at: new Date().toISOString(),
    duration_seconds: duration,
    recording_url: call.recordingUrl || null,
    transcript: call.transcript || callRec.transcript,
    motivation_score: aiAnalysis.motivation_score,
    seller_personality: aiAnalysis.seller_personality,
    key_signals: aiAnalysis.key_signals,
    objections: aiAnalysis.objections,
    outcome: aiAnalysis.outcome,
    ai_summary: aiAnalysis.ai_summary,
    offer_made: aiAnalysis.offer_made,
  }).eq('vapi_call_id', call.id);

  // Update lead with final data
  if (callRec.lead_id && aiAnalysis.motivation_score) {
    await supabase.from('leads').update({
      motivation_score: aiAnalysis.motivation_score,
      seller_personality: aiAnalysis.seller_personality,
      status: mapOutcomeToStatus(aiAnalysis.outcome),
      last_call_date: new Date().toISOString(),
    }).eq('id', callRec.lead_id);
  }

  // Update phone number health score
  if (callRec.phone_number_id) {
    await updatePhoneHealth(callRec.phone_number_id, duration, aiAnalysis.outcome);
  }
}

async function handleStatusUpdate(call) {
  if (!call?.id) return;
  const statusMap = { queued: 'ringing', ringing: 'ringing', 'in-progress': 'in-progress' };
  if (statusMap[call.status]) {
    await supabase.from('calls').update({ status: statusMap[call.status] }).eq('vapi_call_id', call.id);
  }
}

async function updatePhoneHealth(phoneId, duration, outcome) {
  const { data: phone } = await supabase.from('phone_numbers').select('spam_score').eq('id', phoneId).single();
  if (!phone) return;
  let delta = 0;
  if (!duration || duration < 15) delta = -10; // spam hang-up
  else if (duration < 60) delta = -5;           // unanswered/voicemail
  else delta = 3;                                // answered
  if (['appointment', 'offer_made'].includes(outcome)) delta += 5;
  const newScore = Math.max(0, Math.min(100, (phone.spam_score || 100) + delta));
  const status = newScore >= 70 ? 'healthy' : newScore >= 40 ? 'cooling' : 'flagged';
  await supabase.from('phone_numbers').update({ spam_score: newScore, health_status: status, last_used: new Date().toISOString() }).eq('id', phoneId);
}

function mapOutcomeToStatus(outcome) {
  const map = {
    not_home: 'new', not_interested: 'contacted', callback_requested: 'contacted',
    appointment: 'appointment_set', offer_made: 'offer_made', verbal_yes: 'under_contract',
  };
  return map[outcome] || 'contacted';
}

// POST /api/vapi/assistant — Operator AI Assistant (authenticated)
router.post('/assistant', requireAuth, async (req, res, next) => {
  try {
    const { message, conversation_history = [] } = req.body;
    if (!message) return res.status(400).json({ success: false, error: 'message required' });

    // Check usage limit
    const { data: user } = await supabase.from('users').select('ai_messages_used, ai_messages_limit, plan').eq('id', req.user.id).single();
    if (user && user.ai_messages_used >= user.ai_messages_limit) {
      return res.status(429).json({ success: false, error: 'AI message limit reached. Upgrade your plan.', upgrade: true });
    }

    // Get operator context
    const [leadsRes, callsRes, dealsRes] = await Promise.all([
      supabase.from('leads').select('first_name, last_name, status, motivation_score, property_address').eq('user_id', req.user.id).order('motivation_score', { ascending: false }).limit(20),
      supabase.from('calls').select('outcome, motivation_score, ai_summary, created_at').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(10),
      supabase.from('deals').select('status, property_address, assignment_fee').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(10),
    ]);

    const context = {
      hot_leads: leadsRes.data?.filter(l => (l.motivation_score || 0) >= 70) || [],
      recent_calls: callsRes.data || [],
      active_deals: dealsRes.data || [],
    };

    const reply = await aiService.operatorAssistant(message, conversation_history, context);

    // Increment usage
    await supabase.from('users').update({ ai_messages_used: (user?.ai_messages_used || 0) + 1 }).eq('id', req.user.id);

    res.json({ success: true, reply, messages_remaining: (user?.ai_messages_limit || 200) - ((user?.ai_messages_used || 0) + 1) });
  } catch (err) { next(err); }
});

// POST /api/vapi/aria — Free public Aria chatbot
router.post('/aria', optionalAuth, async (req, res, next) => {
  try {
    const { message, conversation_history = [], session_id } = req.body;
    if (!message) return res.status(400).json({ success: false, error: 'message required' });

    const reply = await aiService.ariaChatbot(message, conversation_history);
    res.json({ success: true, reply });
  } catch (err) { next(err); }
});

module.exports = router;
