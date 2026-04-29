const express = require('express');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const {
  sendOpeningSMS, scoreReply, continueConversation, sendReply, escalateToCall,
} = require('../services/smsService');

const router = express.Router();

// POST /api/sms/webhook — Telnyx sends inbound SMS here
router.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Acknowledge immediately

  try {
    const event = req.body?.data;
    if (!event || event.event_type !== 'message.received') return;

    const msg   = event.payload;
    const from  = msg.from?.phone_number;
    const body  = msg.text?.trim();

    if (!from || !body) return;

    console.log(`[SMS] Inbound from ${from}: ${body}`);

    // Find lead by phone number
    const { data: lead } = await supabase
      .from('leads')
      .select('*, users(id)')
      .eq('phone', from)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!lead) {
      console.log(`[SMS] No lead found for ${from}`);
      return;
    }

    const userId = lead.user_id;

    // Log inbound message
    await supabase.from('sms_messages').insert({
      user_id:    userId,
      lead_id:    lead.id,
      direction:  'inbound',
      from_number: from,
      to_number:  msg.to?.[0]?.phone_number,
      body,
      telnyx_message_id: msg.id,
      status:     'received',
      sent_at:    new Date().toISOString(),
    });

    // Load conversation history
    const { data: history } = await supabase
      .from('sms_messages')
      .select('direction, body, sent_at')
      .eq('lead_id', lead.id)
      .order('sent_at', { ascending: true })
      .limit(20);

    const formattedHistory = (history || []).map(m => ({ role: m.direction, body: m.body }));

    // Score the reply
    const scoring = await scoreReply(formattedHistory, body);
    const score = typeof scoring === 'number' ? scoring : scoring.score;
    const nextAction = scoring.next_action || (score >= 60 ? 'call_now' : score >= 40 ? 'continue_sms' : 'follow_up_7_days');

    console.log(`[SMS] Score: ${score} — action: ${nextAction}`);

    // Update lead motivation score
    await supabase.from('leads').update({ motivation_score: score }).eq('id', lead.id);

    if (nextAction === 'call_now' || score >= 60) {
      // Hot lead — send a heads-up text then escalate to Vapi call
      await sendReply(from, `Thanks for getting back to me! Let me give you a quick call right now to discuss further.`, userId, lead.id);
      await escalateToCall(lead, userId);

    } else if (nextAction === 'continue_sms' || (score >= 40 && score < 60)) {
      // Warm lead — continue SMS conversation
      const reply = await continueConversation(lead, body, formattedHistory);
      if (reply) await sendReply(from, reply, userId, lead.id);

    } else {
      // Cold lead — schedule follow-up in 7 days
      const followUpDate = new Date();
      followUpDate.setDate(followUpDate.getDate() + 7);

      await supabase.from('follow_ups').insert({
        user_id:     userId,
        lead_id:     lead.id,
        type:        'sms',
        scheduled_at: followUpDate.toISOString(),
        notes:       `Lead replied via SMS but scored low (${score}). Auto-scheduled 7-day follow-up.`,
        status:      'pending',
        created_at:  new Date().toISOString(),
      });

      console.log(`[SMS] Cold lead — follow-up scheduled for ${followUpDate.toDateString()}`);
    }

  } catch (err) {
    console.error('[SMS Webhook Error]', err.message);
  }
});

// POST /api/sms/send — manual send (authenticated)
router.post('/send', requireAuth, async (req, res, next) => {
  try {
    const { lead_id, message } = req.body;
    if (!lead_id || !message) return res.status(400).json({ success: false, error: 'lead_id and message required' });

    const { data: lead } = await supabase.from('leads').select('*').eq('id', lead_id).eq('user_id', req.user.id).single();
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

    const msgId = await sendReply(lead.phone, message, req.user.id, lead_id);
    res.json({ success: true, message_id: msgId });
  } catch (err) { next(err); }
});

// GET /api/sms/conversation/:leadId — load SMS history for a lead
router.get('/conversation/:leadId', requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('sms_messages')
      .select('*')
      .eq('lead_id', req.params.leadId)
      .eq('user_id', req.user.id)
      .order('sent_at', { ascending: true });
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

module.exports = router;
