const express = require('express');
const twilio = require('twilio');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const {
  sendSMS, sendOpeningSMS, scoreReply, continueConversation, sendReply, escalateToCall,
} = require('../services/smsService');
const queueService = require('../services/queueService');

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
  await sendSMS(from, 'You have been unsubscribed and will receive no further messages from us.')
    .catch(e => console.error('[SMS] Opt-out confirmation send failed:', e.message));

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

// POST /api/sms/webhook — Twilio sends inbound SMS here (form-encoded)
router.post('/webhook', async (req, res) => {
  // Verify the request really came from Twilio.
  // Fails OPEN until TWILIO_AUTH_TOKEN is set, so live SMS isn't broken before config.
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (authToken) {
    const sig = req.get('X-Twilio-Signature');
    const url = `https://${req.get('host')}${req.originalUrl}`;
    const valid = twilio.validateRequest(authToken, sig, url, req.body || {});
    if (!valid) {
      console.warn('[SMS] Rejected webhook — invalid Twilio signature');
      return res.sendStatus(403);
    }
  }

  res.sendStatus(200); // Acknowledge immediately

  try {
    // Twilio posts form-encoded fields: From, Body, To, MessageSid
    const from     = req.body?.From;
    const body     = (req.body?.Body || '').trim();
    const toNumber = req.body?.To;
    const inboundMsgId = req.body?.MessageSid;

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

    // ── BUYER REPLY ROUTING ──────────────────────────────────────────────────
    // A reply from a number in the `buyers` table is a buyer responding to a deal
    // blast (the buy side of the auto-disposition loop), NOT a seller lead. Route
    // it to buyer-interest handling: a "yes" auto-assigns the buyer + fires the
    // assignment contract. STOP/START above already handled opt-out for buyers too.
    if (!lead) {
      const { data: buyer } = await supabase
        .from('buyers')
        .select('*')
        .eq('phone', from)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (buyer) {
        await handleBuyerReply(buyer, from, toNumber, inboundMsgId, body);
        return;
      }
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
      telnyx_message_id: inboundMsgId,
      status:     'received',
      sent_at:    new Date().toISOString(),
    });

    // ── Heavy AI work off the request path ───────────────────────────────────
    // The slow part (GPT scoreReply + Vapi escalation) is handed to the
    // SMS_INBOUND queue so a reply flood from a big blast can't block this
    // webhook. If Redis is unavailable we score inline (unchanged behavior).
    let enqueued = null;
    try {
      enqueued = await queueService.enqueueInboundSMS({ leadId: lead.id, userId, from, body });
    } catch (e) {
      console.warn('[SMS] inbound enqueue failed — scoring inline:', e.message);
    }
    if (!enqueued) {
      await scoreAndActInline(lead, userId, from, body);
    }

  } catch (err) {
    console.error('[SMS Webhook Error]', err.message);
  }
});

// Inline reply scoring + action (Redis-down fallback). Mirrors smsInboundProcessor.
async function scoreAndActInline(lead, userId, from, body) {
  try {
    const { data: history } = await supabase
      .from('sms_messages')
      .select('direction, body, sent_at')
      .eq('lead_id', lead.id)
      .order('sent_at', { ascending: true })
      .limit(20);

    const formattedHistory = (history || []).map(m => ({ role: m.direction, body: m.body }));

    const scoring = await scoreReply(formattedHistory, body);
    const score = typeof scoring === 'number' ? scoring : scoring.score;
    const nextAction = scoring.next_action || (score >= 60 ? 'call_now' : score >= 40 ? 'continue_sms' : 'follow_up_7_days');

    console.log(`[SMS] Score: ${score} — action: ${nextAction}`);

    await supabase.from('leads').update({ motivation_score: score }).eq('id', lead.id);

    if (nextAction === 'call_now' || score >= 60) {
      await sendReply(from, `Thanks for getting back to me! Let me give you a quick call right now to discuss further.`, userId, lead.id);
      await escalateToCall(lead, userId);

    } else if (nextAction === 'continue_sms' || (score >= 40 && score < 60)) {
      const reply = await continueConversation(lead, body, formattedHistory);
      if (reply) await sendReply(from, reply, userId, lead.id);

    } else {
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
    console.error('[SMS] inline scoreAndAct error:', err.message);
  }
}

// ─── Buyer reply handling (buy side of the auto-disposition loop) ─────────────
// A buyer replied to a deal blast. Log it, detect interest, and on a clear "yes"
// auto-assign the buyer to their best-fit under_contract deal and fire the
// assignment contract. Conservative: a "yes" only acts on a deal whose buy box
// actually fits this buyer, and only when the deal has no buyer assigned yet.
const BUYER_YES = /\b(yes|yep|yeah|interested|i'?m in|send it|send the contract|let'?s do it|deal|sounds good)\b/i;
const BUYER_NO  = /\b(no|not interested|pass|nope|remove me|too high|nah)\b/i;

async function handleBuyerReply(buyer, from, toNumber, inboundMsgId, body) {
  const userId = buyer.user_id;
  try {
    // 1. Log the inbound message (buyer_id, no lead_id).
    await supabase.from('sms_messages').insert({
      user_id:     userId,
      buyer_id:    buyer.id,
      direction:   'inbound',
      from_number: from,
      to_number:   toNumber,
      body,
      telnyx_message_id: inboundMsgId,
      status:      'received',
      sent_at:     new Date().toISOString(),
    }).catch(() => {});

    const interested = BUYER_YES.test(body) && !BUYER_NO.test(body);
    console.log(`[SMS] Buyer reply from ${buyer.name || from} — interested=${interested}`);

    if (!interested) return; // a "no"/neutral reply just gets logged

    // 2. Find this buyer's best-fit deal that's under_contract and unassigned.
    const buyerDispo = require('../services/buyerDispoService');
    const { data: openDeals } = await supabase
      .from('deals')
      .select('*, leads(*)')
      .eq('user_id', userId)
      .eq('status', 'under_contract')
      .is('buyer_id', null)
      .order('updated_at', { ascending: false })
      .limit(50);

    const fit = (openDeals || []).find(d => {
      const states = (buyer.buy_box_states || []).map(s => String(s).trim().toUpperCase());
      const stateOk = states.length === 0 || states.includes((d.property_state || '').trim().toUpperCase());
      const ask = buyerDispo.dealAskPrice(d);
      const priceOk = buyer.max_price == null || ask == null || Number(buyer.max_price) * 1.15 >= ask;
      return stateOk && priceOk;
    }) || (openDeals || [])[0];

    if (!fit) {
      console.log(`[SMS] Buyer ${buyer.id} said yes but no open under_contract deal to assign`);
      return;
    }

    // 3. Assign the buyer (guard against a race — only if still unassigned).
    const { data: claimed } = await supabase
      .from('deals')
      .update({ buyer_id: buyer.id, updated_at: new Date().toISOString() })
      .eq('id', fit.id)
      .eq('user_id', userId)
      .is('buyer_id', null)
      .select('id')
      .maybeSingle();
    if (!claimed) {
      console.log(`[SMS] Deal ${fit.id} already assigned — skipping buyer ${buyer.id}`);
      return;
    }

    await supabase.from('ai_command_log').insert({
      deal_id:     fit.id,
      action_type: 'buyer_assigned_auto',
      message_sent: `Buyer ${buyer.name || from} replied YES — auto-assigned to deal`,
      outcome:     'success',
      operator_id: userId,
    }).catch(() => {});

    // 4. Generate + send the assignment contract. `send` builds the signing
    //    package; deal must carry the joined buyer/lead for generateAssignment.
    try {
      const contractService = require('../services/contractService');
      const dealForContract = { ...fit, buyers: buyer, leads: fit.leads || {} };
      const result = await contractService.send(dealForContract, 'assignment', {
        phone: buyer.phone, email: buyer.email, userId,
      });
      await supabase.from('deals')
        .update({ contract_status: 'assignment_sent', updated_at: new Date().toISOString() })
        .eq('id', fit.id).catch(() => {});
      await supabase.from('ai_command_log').insert({
        deal_id:     fit.id,
        action_type: 'assignment_contract_sent',
        message_sent: `Assignment contract sent to ${buyer.name || from} (${result?.signing_url || 'link created'})`,
        outcome:     'success',
        operator_id: userId,
      }).catch(() => {});
      // Send the buyer the signing link via SMS.
      if (result?.signing_url) {
        await sendReply(from, `Great — here's the assignment contract to sign: ${result.signing_url}`, userId, null)
          .catch(() => {});
      }
      console.log(`[SMS] Assignment contract auto-sent for deal ${fit.id} → buyer ${buyer.id}`);
    } catch (e) {
      console.error('[SMS] Assignment contract auto-send failed:', e.message);
    }
  } catch (err) {
    console.error('[SMS] handleBuyerReply error:', err.message);
  }
}

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

// GET /api/sms/inbox — all SMS conversations grouped by lead, newest first
router.get('/inbox', requireAuth, async (req, res, next) => {
  try {
    // Fetch the most recent message per lead for this user (last 300 messages)
    const { data: messages, error: msgError } = await supabase
      .from('sms_messages')
      .select('lead_id, direction, body, sent_at, is_read')
      .eq('user_id', req.user.id)
      .order('sent_at', { ascending: false })
      .limit(300);

    if (msgError) throw msgError;

    if (!messages || messages.length === 0) {
      return res.json({ success: true, data: [] });
    }

    // Group: build per-lead summary (last message, unread count)
    const leadMap = {};
    for (const msg of messages) {
      if (!msg.lead_id) continue;
      if (!leadMap[msg.lead_id]) {
        leadMap[msg.lead_id] = {
          lead_id:         msg.lead_id,
          last_message:    msg.body,
          last_message_at: msg.sent_at,
          last_direction:  msg.direction,
          unread_count:    0,
        };
      }
      if (msg.direction === 'inbound' && !msg.is_read) {
        leadMap[msg.lead_id].unread_count += 1;
      }
    }

    // Fetch lead details for all found lead IDs
    const leadIds = Object.keys(leadMap);
    if (leadIds.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const { data: leadsData, error: leadsError } = await supabase
      .from('leads')
      .select('id, first_name, last_name, phone, motivation_score, property_address, status, pipeline_stage')
      .eq('user_id', req.user.id)
      .in('id', leadIds);

    if (leadsError) throw leadsError;

    // Merge lead details into summaries
    const leadsById = {};
    for (const lead of (leadsData || [])) {
      leadsById[lead.id] = lead;
    }

    const conversations = leadIds
      .map(id => ({ ...leadMap[id], lead: leadsById[id] || null }))
      .filter(c => c.lead !== null)
      .sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at));

    res.json({ success: true, data: conversations });
  } catch (err) { next(err); }
});

// POST /api/sms/read/:leadId — mark all inbound messages for a lead as read
router.post('/read/:leadId', requireAuth, async (req, res, next) => {
  try {
    const { error } = await supabase
      .from('sms_messages')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('lead_id', req.params.leadId)
      .eq('user_id', req.user.id)
      .eq('direction', 'inbound')
      .eq('is_read', false);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
