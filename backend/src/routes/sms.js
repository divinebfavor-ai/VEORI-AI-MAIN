const express = require('express');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const {
  sendOpeningSMS, scoreReply, continueConversation, sendReply, escalateToCall,
} = require('../services/smsService');

const router = express.Router();

// CTIA standard opt-out keywords — exact match, case-insensitive
const OPT_OUT_KEYWORDS  = ['STOP', 'UNSUBSCRIBE', 'CANCEL', 'QUIT', 'END'];
const OPT_IN_KEYWORDS   = ['START', 'UNSTOP', 'YES'];

function isOptOut(text) {
  return OPT_OUT_KEYWORDS.includes((text || '').trim().toUpperCase());
}
function isOptIn(text) {
  return OPT_IN_KEYWORDS.includes((text || '').trim().toUpperCase());
}

// ─── Handle opt-out: add to DNC, log, send confirmation ──────────────────────
async function handleOptOut(from, lead, userId, toNumber) {
  // 1. Add to dnc_records (upsert — safe if already exists)
  await supabase.from('dnc_records').upsert(
    { phone: from, added_by: userId || null, reason: 'SMS opt-out (STOP keyword)' },
    { onConflict: 'phone' }
  );

  // 2. Mark lead as DNC
  if (lead) {
    await supabase.from('leads')
      .update({ is_on_dnc: true, status: 'dnc' })
      .eq('id', lead.id);
  }

  // 3. Log to tcpa_log
  await supabase.from('tcpa_log').insert({
    user_id:  userId || null,
    lead_id:  lead?.id || null,
    phone:    from,
    action:   'sms_opt_out',
    notes:    'Lead replied with opt-out keyword — added to DNC, all future SMS blocked',
    created_at: new Date().toISOString(),
  }).catch(() => {});

  // 4. Send required confirmation reply (CTIA mandates this)
  const TELNYX_KEY     = process.env.TELNYX_API_KEY;
  const TELNYX_PROFILE = process.env.TELNYX_MESSAGING_PROFILE_ID;
  if (TELNYX_KEY && toNumber) {
    await require('axios').post('https://api.telnyx.com/v2/messages', {
      from: toNumber,
      to:   from,
      text: 'You have been unsubscribed and will receive no further messages from us.',
      messaging_profile_id: TELNYX_PROFILE,
    }, {
      headers: { Authorization: `Bearer ${TELNYX_KEY}`, 'Content-Type': 'application/json' },
      timeout: 10000,
    }).catch(e => console.error('[SMS] Opt-out confirmation send failed:', e.message));
  }

  console.log(`[SMS] Opt-out processed — ${from} added to DNC`);
}

// ─── Handle opt-in: remove from DNC ─────────────────────────────────────────
async function handleOptIn(from, lead, userId) {
  await supabase.from('dnc_records').delete().eq('phone', from);

  if (lead) {
    await supabase.from('leads')
      .update({ is_on_dnc: false, status: 'new' })
      .eq('id', lead.id);
  }

  await supabase.from('tcpa_log').insert({
    user_id:  userId || null,
    lead_id:  lead?.id || null,
    phone:    from,
    action:   'sms_opt_in',
    notes:    'Lead replied START — removed from DNC',
    created_at: new Date().toISOString(),
  }).catch(() => {});

  console.log(`[SMS] Opt-in processed — ${from} removed from DNC`);
}

// POST /api/sms/webhook — Telnyx sends inbound SMS here
router.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Acknowledge immediately

  try {
    const event = req.body?.data;
    if (!event || event.event_type !== 'message.received') return;

    const msg     = event.payload;
    const from    = msg.from?.phone_number;
    const body    = msg.text?.trim();
    const toNumber = msg.to?.[0]?.phone_number;

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

    const userId = lead?.user_id || null;

    // ── STOP / OPT-OUT — handle FIRST before anything else ───────────────────
    if (isOptOut(body)) {
      await handleOptOut(from, lead, userId, toNumber);
      return; // Stop all processing — no AI, no scoring, no follow-up
    }

    // ── OPT-IN (START) — re-subscribe ────────────────────────────────────────
    if (isOptIn(body)) {
      await handleOptIn(from, lead, userId);
      return;
    }

    if (!lead) {
      console.log(`[SMS] No lead found for ${from}`);
      return;
    }

    // Log inbound message
    await supabase.from('sms_messages').insert({
      user_id:    userId,
      lead_id:    lead.id,
      direction:  'inbound',
      from_number: from,
      to_number:  toNumber,
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
