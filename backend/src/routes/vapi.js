// Vapi Webhook Handler + AI Assistant endpoint
const express  = require('express');
const supabase = require('../config/supabase');
const aiService = require('../services/aiService');
const vapiService = require('../services/vapiService');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { enrollLeadInSequence } = require('../services/sequenceEngine');

const router = express.Router();

// POST /api/vapi/webhook — Vapi sends all call events here
router.post('/webhook', async (req, res) => {
  try {
    const event = req.body;
    const { type, call } = event;

    console.log(`[Vapi Webhook] Event: ${type}`, call?.id);

    switch (type) {
      // Inbound call — Vapi asks what assistant to use
      case 'assistant-request':
        return res.json(await handleAssistantRequest(event));

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

  const now = new Date();
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

  const outcome = aiAnalysis.outcome || callRec.outcome;

  await supabase.from('calls').update({
    status: 'ended',
    ended_at: now.toISOString(),
    duration_seconds: duration,
    recording_url: call.recordingUrl || null,
    transcript: call.transcript || callRec.transcript,
    motivation_score: aiAnalysis.motivation_score,
    seller_personality: aiAnalysis.seller_personality,
    key_signals: aiAnalysis.key_signals,
    objections: aiAnalysis.objections,
    outcome,
    ai_summary: aiAnalysis.ai_summary,
    offer_made: aiAnalysis.offer_made,
  }).eq('vapi_call_id', call.id);

  // Update lead with final data
  if (callRec.lead_id && aiAnalysis.motivation_score) {
    await supabase.from('leads').update({
      motivation_score: aiAnalysis.motivation_score,
      seller_personality: aiAnalysis.seller_personality,
      status: mapOutcomeToStatus(outcome),
      last_call_date: now.toISOString(),
      last_call_outcome: outcome,
    }).eq('id', callRec.lead_id);
  }

  // Log TCPA audit record
  if (callRec.user_id) {
    await supabase.from('tcpa_log').insert({
      user_id: callRec.user_id,
      lead_id: callRec.lead_id || null,
      call_id: callRec.id,
      phone_number: callRec.phone_number || callRec.leads?.phone || '',
      called_at_utc: now.toISOString(),
      local_time: callRec.local_time_of_call || null,
      timezone: null,
      within_calling_hours: callRec.was_within_calling_hours ?? null,
      dnc_checked_at: callRec.dnc_checked ? now.toISOString() : null,
      dnc_result: callRec.dnc_check_result || null,
      attempt_number: callRec.attempt_number || 1,
      days_since_last_attempt: callRec.days_since_last_attempt || null,
      consent_status: callRec.consent_status || 'unknown',
    }).catch(e => console.error('[Vapi] TCPA log error:', e.message));
  }

  // Auto-create deal when seller says verbal_yes or sets appointment
  if (['verbal_yes', 'appointment'].includes(outcome) && callRec.lead_id && callRec.user_id) {
    try {
      const { data: lead } = await supabase.from('leads').select('*').eq('id', callRec.lead_id).single();
      // Only create if no deal exists yet for this lead
      const { count: existingDeals } = await supabase.from('deals')
        .select('*', { count: 'exact', head: true })
        .eq('lead_id', callRec.lead_id);
      if ((existingDeals || 0) === 0 && lead) {
        await supabase.from('deals').insert({
          user_id:          callRec.user_id,
          lead_id:          callRec.lead_id,
          property_address: lead.property_address,
          property_city:    lead.property_city,
          property_state:   lead.property_state,
          property_zip:     lead.property_zip,
          seller_name:      `${lead.first_name || ''} ${lead.last_name || ''}`.trim(),
          seller_phone:     lead.phone,
          seller_email:     lead.email,
          status:           outcome === 'verbal_yes' ? 'under_contract' : 'lead',
          estimated_value:  lead.estimated_value,
          estimated_equity: lead.estimated_equity,
          seller_primary_tag: lead.primary_tag,
          created_at:       new Date().toISOString(),
        });
        console.log(`[Vapi] Auto-created deal for lead ${callRec.lead_id} — outcome: ${outcome}`);
      }
    } catch (e) {
      console.error('[Vapi] Auto-deal creation failed:', e.message);
    }
  }

  // Enroll lead in follow-up sequence based on outcome
  const outcomeToSequence = {
    not_interested:     'not_interested',
    callback_requested: 'callback_requested',
    offer_made:         'offer_considering',
    appointment:        'callback_requested',
    voicemail:          'not_interested',
    no_answer:          'not_interested',
  };
  const seqType = outcomeToSequence[outcome];
  if (seqType && callRec.lead_id && callRec.user_id) {
    enrollLeadInSequence(callRec.user_id, callRec.lead_id, seqType)
      .catch(e => console.error('[Vapi] Sequence enroll failed:', e.message));
  }

  // Auto direct mail trigger: if 3+ no-answers, send postcard automatically
  if (['not_home', 'voicemail'].includes(outcome) && callRec.lead_id && callRec.user_id) {
    const { checkAutoMailTrigger, sendPostcard } = require('../services/directMailService');
    checkAutoMailTrigger(callRec.lead_id, callRec.user_id).then(async (shouldMail) => {
      if (!shouldMail) return;
      const { data: lead } = await supabase.from('leads').select('*').eq('id', callRec.lead_id).single();
      const { data: operator } = await supabase.from('users').select('ai_caller_name, company_name, business_phone, id').eq('id', callRec.user_id).single();
      if (lead && !lead.direct_mail_sent) {
        sendPostcard({ lead, operator: operator || {}, templateKey: 'no_answer' }).then(() => {
          supabase.from('leads').update({ direct_mail_sent: true }).eq('id', callRec.lead_id).catch(() => {});
        }).catch(e => console.error('[AutoMail] Failed:', e.message));
      }
    }).catch(() => {});
  }

  // Update campaign stats after call ends
  if (callRec.campaign_id) {
    const statsUpdate = { leads_called: supabase.rpc ? undefined : undefined };
    // Increment leads_called and optionally leads_answered
    await supabase.rpc('increment_campaign_stats', {
      p_campaign_id: callRec.campaign_id,
      p_answered: duration && duration > 15 ? 1 : 0,
      p_offer_made: outcome === 'offer_made' ? 1 : 0,
    }).catch(() => {
      // Fallback if RPC not available: manual increment
      supabase.from('campaigns').select('leads_called, leads_answered, offers_made').eq('id', callRec.campaign_id).single()
        .then(({ data: camp }) => {
          if (!camp) return;
          supabase.from('campaigns').update({
            leads_called:   (camp.leads_called   || 0) + 1,
            leads_answered: (camp.leads_answered || 0) + (duration && duration > 15 ? 1 : 0),
            offers_made:    (camp.offers_made    || 0) + (outcome === 'offer_made' ? 1 : 0),
            updated_at:     now.toISOString(),
          }).eq('id', callRec.campaign_id).catch(e => console.error('[Vapi] Campaign stats error:', e.message));
        });
    });
  }

  // Update phone number health score
  if (callRec.phone_number_id) {
    await updatePhoneHealth(callRec.phone_number_id, duration, outcome);
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

// ─── Inbound call handler ─────────────────────────────────────────────────────
// When a seller calls in, Vapi sends an assistant-request event.
// We look up the caller, log the inbound call, and return the assistant config.
async function handleAssistantRequest(event) {
  const { call } = event;
  const callerPhone = call?.customer?.number;

  // Default to first active user (single-tenant) or look up by phone number
  let operator = {};
  try {
    // Try to match inbound Vapi number → user
    if (call?.phoneNumber?.id) {
      const { data: phone } = await supabase.from('phone_numbers')
        .select('user_id, users(ai_caller_name, ai_voice_id, ai_personality_tone, company_name, id)')
        .eq('vapi_phone_id', call.phoneNumber.id)
        .single();
      if (phone?.users) operator = phone.users;
    }

    // Look up existing lead by phone number
    let existingLead = null;
    if (callerPhone && operator.id) {
      const { data: lead } = await supabase.from('leads')
        .select('id, first_name, last_name, property_address, motivation_score')
        .eq('phone', callerPhone).eq('user_id', operator.id).single();
      existingLead = lead;
    }

    // Create inbound call record
    if (operator.id) {
      const { data: callRec } = await supabase.from('calls').insert({
        user_id: operator.id,
        lead_id: existingLead?.id || null,
        status: 'ringing',
        direction: 'inbound',
        started_at: new Date().toISOString(),
      }).select().single();

      // Tag Vapi call with our DB id via metadata
      console.log(`[Vapi Inbound] ${callerPhone} → known lead: ${existingLead?.first_name || 'Unknown'}`);
    }
  } catch (e) {
    console.error('[Vapi assistant-request error]', e.message);
  }

  // Return assistant config for this inbound call
  const assistantConfig = await vapiService.buildInboundAssistantConfig({ callerPhone, operator });
  return { assistant: assistantConfig };
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
