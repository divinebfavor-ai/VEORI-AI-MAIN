const express  = require('express');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const { extractDealTerms, parseCallTime, extractConversationInsights } = require('../services/dualAIService');
const { scheduleVapiCall, scheduleFollowUp } = require('../services/queueService');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();
router.use(requireAuth);

// POST /api/conversations/send-sms
router.post('/send-sms', async (req, res, next) => {
  try {
    const { deal_id, contact_id, contact_type, message } = req.body;
    if (!contact_id || !message) return res.status(400).json({ success: false, error: 'contact_id and message required' });

    // Get contact phone
    const table = contact_type === 'buyer' ? 'buyers' : 'sellers';
    const idCol  = contact_type === 'buyer' ? 'buyer_id' : 'seller_id';
    const { data: contact } = await supabase.from(table).select('phone, name').eq(idCol, contact_id).single();

    if (!contact?.phone) return res.status(400).json({ success: false, error: 'Contact has no phone number' });

    // AI disclosure prefix on all outbound SMS
    const aiPrefix = 'This is an automated message from Veori AI. ';
    const fullMessage = message.startsWith('This is') ? message : aiPrefix + message;

    // Send via Vapi SMS
    const axios = require('axios');
    await axios.post('https://api.vapi.ai/message', {
      to: contact.phone,
      message: fullMessage,
    }, {
      headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` },
    }).catch(err => console.error('[SMS] Send error:', err.response?.data || err.message));

    // Store message
    const { data: msg } = await supabase.from('conversations').insert({
      deal_id: deal_id || null,
      contact_id,
      contact_type: contact_type || 'seller',
      sender: 'ai',
      content: fullMessage,
      operator_id: req.user.id,
    }).select().single();

    // Log action
    await supabase.from('ai_command_log').insert({
      deal_id: deal_id || null,
      contact_id,
      contact_name: contact.name,
      action_type: 'sms_sent',
      message_sent: fullMessage.substring(0, 300),
      outcome: 'sent',
      operator_id: req.user.id,
    });

    // Check if contact is requesting a call
    const terms = await extractDealTerms(fullMessage).catch(() => null);
    if (terms?.requested_call && terms?.call_requested_time) {
      const callTime = await parseCallTime(terms.call_requested_time).catch(() => null);
      if (callTime?.requested_time) {
        const followUpId = uuidv4();
        await supabase.from('follow_ups').insert({
          followup_id: followUpId,
          deal_id: deal_id || null,
          contact_id,
          contact_type: contact_type || 'seller',
          next_follow_up_at: callTime.requested_time,
          follow_up_type: 'voice_call',
          status: 'pending',
          message_template: 'scheduled_callback',
        });

        const { data: operator } = await supabase.from('users').select('ai_caller_name').eq('id', req.user.id).single();
        const script = `Hi ${contact.name?.split(' ')[0] || 'there'}, this is ${operator?.ai_caller_name || 'Alex'}, an AI assistant from Veori. You asked me to call you at this time. Are you ready to move forward?`;

        const jobId = await scheduleVapiCall({
          followUpId,
          deal_id,
          leadId: contact_id,
          runAt: callTime.requested_time,
          script,
        });

        await supabase.from('follow_ups').update({ bullmq_job_id: jobId }).eq('followup_id', followUpId);
      }
    }

    res.json({ success: true, message: msg });
  } catch (err) { next(err); }
});

// POST /api/conversations/handle-reply — process inbound reply from contact
router.post('/handle-reply', async (req, res, next) => {
  try {
    const { deal_id, contact_id, contact_type, message, from_phone } = req.body;

    // Store the inbound message
    await supabase.from('conversations').insert({
      deal_id: deal_id || null,
      contact_id: contact_id || null,
      contact_type: contact_type || 'seller',
      sender: 'contact',
      content: message,
      operator_id: req.user.id,
    });

    // Extract deal terms from the message
    const terms = await extractDealTerms(message).catch(() => null);

    let updates = {};
    if (terms?.offer_price) updates.offer_price = terms.offer_price;
    if (terms?.closing_date) updates.closing_date = terms.closing_date;

    if (deal_id && Object.keys(updates).length > 0) {
      await supabase.from('deals').update(updates).eq('deal_id', deal_id);
    }

    // Handle call request
    if (terms?.requested_call && terms?.call_requested_time) {
      const callTime = await parseCallTime(terms.call_requested_time).catch(() => null);
      if (callTime?.requested_time && callTime.confidence > 60) {
        const followUpId = uuidv4();
        await supabase.from('follow_ups').insert({
          followup_id: followUpId,
          deal_id: deal_id || null,
          contact_id,
          contact_type: contact_type || 'seller',
          next_follow_up_at: callTime.requested_time,
          follow_up_type: 'voice_call',
          status: 'pending',
          message_template: 'contact_requested_call',
        });

        const jobId = await scheduleVapiCall({
          followUpId,
          deal_id,
          leadId: contact_id,
          runAt: callTime.requested_time,
          script: `Hi, this is Alex, an AI assistant from Veori. You asked us to call you at this time. Are you ready to discuss your property?`,
        });

        await supabase.from('follow_ups').update({ bullmq_job_id: jobId }).eq('followup_id', followUpId);
      }
    }

    await supabase.from('ai_command_log').insert({
      deal_id: deal_id || null,
      contact_id,
      action_type: 'inbound_reply_received',
      message_sent: message.substring(0, 300),
      outcome: terms?.next_action || 'reply_logged',
      operator_id: req.user.id,
    });

    res.json({ success: true, extracted_terms: terms });
  } catch (err) { next(err); }
});

// POST /api/conversations/schedule-call — schedule a Vapi call at a specific time
router.post('/schedule-call', async (req, res, next) => {
  try {
    const { deal_id, contact_id, contact_type, run_at, script } = req.body;
    if (!contact_id || !run_at) return res.status(400).json({ success: false, error: 'contact_id and run_at required' });

    const followUpId = uuidv4();
    await supabase.from('follow_ups').insert({
      followup_id: followUpId,
      deal_id: deal_id || null,
      contact_id,
      contact_type: contact_type || 'seller',
      next_follow_up_at: run_at,
      follow_up_type: 'voice_call',
      status: 'pending',
      message_template: 'scheduled_call',
    });

    const jobId = await scheduleVapiCall({ followUpId, deal_id, leadId: contact_id, runAt: run_at, script });
    await supabase.from('follow_ups').update({ bullmq_job_id: jobId }).eq('followup_id', followUpId);

    res.json({ success: true, followup_id: followUpId, scheduled_at: run_at });
  } catch (err) { next(err); }
});

// GET /api/conversations/:deal_id — get all messages for a deal
router.get('/:deal_id', async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('conversations')
      .select('*')
      .eq('deal_id', req.params.deal_id)
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json({ success: true, messages: data || [] });
  } catch (err) { next(err); }
});

module.exports = router;
