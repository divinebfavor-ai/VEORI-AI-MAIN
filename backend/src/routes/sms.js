const express = require('express');
const twilio = require('twilio');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const {
  sendSMS, sendOpeningSMS, scoreReply, continueConversation, sendReply, escalateToCall, extractBuyBox,
} = require('../services/smsService');
const { getSellerContextForSMS } = require('../services/dataMotService');
const queueService = require('../services/queueService');
const { captureInboundMMS } = require('../services/mmsCaptureService');
const { logTcpa } = require('../services/tcpaLog');

const router = express.Router();

// CTIA standard opt-out keywords - exact match, case-insensitive
const OPT_OUT_KEYWORDS  = ['STOP', 'UNSUBSCRIBE', 'CANCEL', 'QUIT', 'END'];
// 'YES' is deliberately NOT an opt-in keyword: sellers and buyers answer questions
// with "yes", and treating that as a re-subscribe swallowed the reply (it was never
// scored, and a buyer's YES never reached deal assignment).
const OPT_IN_KEYWORDS   = ['START', 'UNSTOP'];

function isOptOut(text) {
  return OPT_OUT_KEYWORDS.includes((text || '').trim().toUpperCase());
}
function isOptIn(text) {
  return OPT_IN_KEYWORDS.includes((text || '').trim().toUpperCase());
}

// ─── Handle opt-out: add to DNC, log, send confirmation ──────────────────────
async function handleOptOut(from, lead, userId, toNumber) {
  // 1. Add to dnc_records.
  //
  // THIS WAS SILENTLY FAILING ON EVERY OPT-OUT. The previous call wrote
  // `added_by`, which is not a column on this table (it is `user_id`), and used
  // `onConflict: 'phone'`, which names a unique constraint that does not exist -
  // `phone` carries only a plain, non-unique index. supabase-js RETURNS an error
  // object rather than throwing, and the result was never inspected, so both
  // failures were invisible. That is why dnc_records held zero rows: no STOP
  // reply had ever actually suppressed a number.
  //
  // Now: correct column, an explicit existence check instead of a constraint
  // that isn't there, and the error is surfaced. A failure here is a compliance
  // event, so it is logged loudly - but it must not break the confirmation reply
  // the consumer is owed, so it does not throw.
  try {
    let q = supabase.from('dnc_records').select('id').eq('phone', from).limit(1);
    q = userId ? q.eq('user_id', userId) : q.is('user_id', null);
    const { data: existing } = await q;

    if (!existing || existing.length === 0) {
      const { error: dncErr } = await supabase.from('dnc_records').insert({
        phone: from,
        user_id: userId || null,
        reason: 'SMS opt-out (STOP keyword)',
        source: 'sms_stop',
      });
      if (dncErr) {
        console.error('[SMS][COMPLIANCE] FAILED to record opt-out for', from, '-', dncErr.message);
      } else {
        console.log('[SMS] Opt-out recorded in dnc_records for', from);
      }
    }
  } catch (e) {
    console.error('[SMS][COMPLIANCE] FAILED to record opt-out for', from, '-', e.message);
  }

  // 2. Mark lead as DNC
  if (lead) {
    await supabase.from('leads')
      .update({ is_on_dnc: true, status: 'dnc' })
      .eq('id', lead.id);
  }

  // 3. Log to tcpa_log via the shared writer. The previous inline insert omitted
  // phone_number and called_at_utc, which are NOT NULL, so it failed the
  // constraint on every call - and `.then(null, () => {})` swallowed it.
  await logTcpa({
    userId, lead: lead || { phone: from }, withinHours: true, dncResult: 'blocked',
    consent: 'revoked', action: 'sms_opt_out',
    note: 'Lead replied with opt-out keyword - added to DNC, all future SMS blocked',
  });

  // 4. Send required confirmation reply (CTIA mandates this)
  await sendSMS(from, 'You have been unsubscribed and will receive no further messages from us.')
    .catch(e => console.error('[SMS] Opt-out confirmation send failed:', e.message));

  console.log(`[SMS] Opt-out processed - ${from} added to DNC`);
}

// ─── Handle opt-in: remove from DNC ─────────────────────────────────────────
async function handleOptIn(from, lead, userId) {
  // SCOPED. This was `delete().eq('phone', from)` with no operator scope, so one
  // person replying START to ONE operator deleted that number from EVERY
  // operator's suppression list - including operators who had never contacted
  // them and whose STOP request was still in force. That silently converted a
  // valid opt-out into permission to text again, which is the exact failure the
  // TCPA penalises.
  //
  // Consent is per-sender: a consumer opting back in to one business says nothing
  // about any other. So we clear only THIS operator's suppression, and only when
  // we know which operator the message was for. Rows with a NULL user_id are
  // treated as platform-wide suppressions and are never cleared here.
  if (!userId) {
    console.warn(`[SMS] opt-in from ${from} with no resolvable operator - suppression left in place`);
  } else {
    await supabase.from('dnc_records').delete().eq('phone', from).eq('user_id', userId);
  }

  if (lead) {
    await supabase.from('leads')
      .update({ is_on_dnc: false, status: 'new' })
      .eq('id', lead.id);
  }

  await logTcpa({
    userId, lead: lead || { phone: from }, withinHours: true, dncResult: 'pass',
    consent: 'opted_in', action: 'sms_opt_in',
    note: userId
      ? 'Lead replied START - suppression cleared for this operator only'
      : 'Lead replied START - no operator resolved, suppression left in place',
  });

  console.log(`[SMS] Opt-in processed - ${from}`);
}

// POST /api/sms/webhook - Twilio sends inbound SMS here (form-encoded)
router.post('/webhook', async (req, res) => {
  // Verify the request really came from Twilio. Fails CLOSED in production: an
  // unverified inbound SMS is a forged seller reply, which this pipeline will
  // score, act on and escalate to a real outbound dial. Non-production still
  // passes through so local development is not blocked.
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (authToken) {
    const sig = req.get('X-Twilio-Signature');
    const url = `https://${req.get('host')}${req.originalUrl}`;
    const valid = twilio.validateRequest(authToken, sig, url, req.body || {});
    if (!valid) {
      console.warn('[SMS] Rejected webhook - invalid Twilio signature');
      return res.sendStatus(403);
    }
  } else if (process.env.NODE_ENV === 'production') {
    console.error('[SMS] REJECTED webhook - TWILIO_AUTH_TOKEN is not set in production; cannot verify signature');
    return res.sendStatus(503);
  }

  res.sendStatus(200); // Acknowledge immediately

  try {
    // Twilio posts form-encoded fields: From, Body, To, MessageSid.
    // MMS additionally posts NumMedia + MediaUrl{N} + MediaContentType{N}.
    const from     = req.body?.From;
    const body     = (req.body?.Body || '').trim();
    const toNumber = req.body?.To;
    const inboundMsgId = req.body?.MessageSid;
    const hasMedia = (parseInt(req.body?.NumMedia, 10) || 0) > 0;

    // A photo-only MMS has media but no body text - we still want to capture the
    // photos, so only bail early when there is BOTH no body AND no media.
    if (!from || (!body && !hasMedia)) return;

    console.log(`[SMS] Inbound from ${from}: ${body || '(no text)'}${hasMedia ? ' [+media]' : ''}`);

    // Find lead by phone number
    const { data: lead } = await supabase
      .from('leads')
      .select('*, users(id)')
      .eq('phone', from)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const userId = lead?.user_id || null;

    // ── MMS PHOTO CAPTURE (Stage 3a) ─────────────────────────────────────────
    // Seller texted picture(s) of the property → store them on the lead chart.
    // Best-effort and non-blocking; runs only when this is a real seller lead.
    if (hasMedia && lead) {
      await captureInboundMMS({ body: req.body, lead }).catch(e =>
        console.warn('[SMS] MMS capture failed (non-fatal):', e.message));
    }

    // A photo-only MMS (no body text) has nothing to opt-out/score - stop here
    // now that the photos are saved.
    if (!body) return;

    // ── STOP / OPT-OUT - handle FIRST before anything else ───────────────────
    if (isOptOut(body)) {
      await handleOptOut(from, lead, userId, toNumber);
      return; // Stop all processing - no AI, no scoring, no follow-up
    }

    // ── OPT-IN (START) - re-subscribe ────────────────────────────────────────
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
      const handled = await handleBuyerReply(from, toNumber, inboundMsgId, body);
      if (handled) return;
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
      enqueued = await queueService.enqueueInboundSMS({ leadId: lead.id, userId, from, body, inboundMsgId });
    } catch (e) {
      console.warn('[SMS] inbound enqueue failed - scoring inline:', e.message);
    }
    if (!enqueued) {
      await scoreAndActInline(lead, userId, from, body, inboundMsgId);
    }

  } catch (err) {
    console.error('[SMS Webhook Error]', err.message);
  }
});

// Inline reply scoring + action (Redis-down fallback). Mirrors smsInboundProcessor.
async function scoreAndActInline(lead, userId, from, body, inboundMsgId) {
  try {
    // Same idempotency claim the queued processor uses: atomically flip this
    // inbound row 'received' → 'scored'. A Twilio webhook re-delivery updates 0
    // rows and bails, so the inline path also never double-scores / double-calls.
    if (inboundMsgId) {
      const { data: claimed } = await supabase
        .from('sms_messages')
        .update({ status: 'scored' })
        .eq('telnyx_message_id', inboundMsgId)
        .eq('direction', 'inbound')
        .eq('status', 'received')
        .select('id');
      if (!claimed || claimed.length === 0) {
        console.log(`[SMS] ${inboundMsgId} already scored - skipping inline (redelivery)`);
        return;
      }
    }

    const { data: history } = await supabase
      .from('sms_messages')
      .select('direction, body, sent_at')
      .eq('lead_id', lead.id)
      .order('sent_at', { ascending: true })
      .limit(20);

    const formattedHistory = (history || []).map(m => ({ role: m.direction, body: m.body }));

    // A - unified memory: same seller profile the voice brain uses (non-blocking).
    const sellerContext = await getSellerContextForSMS(lead.id);

    // Judgment-based next action (continue_sms | escalate_call | close_out) with the PMI
    // score kept as a background sanity check + full decision logging. Replaces the old
    // fixed score-threshold escalation.
    const escalationJudge = require('../services/smsEscalationJudge');
    const decision = await escalationJudge.decideAndExecute({
      lead, userId, from, body, history: formattedHistory, sellerContext, inboundMsgId,
    });
    console.log(`[SMS] Decision: ${decision.action}${decision.needs_human_review ? ' (flagged for human review)' : ''} - pmi ${decision.pmi_score}`);
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

// Merge AI/regex-extracted buy-box facts onto the buyers row. RULE: only FILL or
// APPEND - never overwrite a known value with a null/empty guess. Arrays union
// (dedup); scalars fill only when currently empty. Always stamps recency so the
// matcher can prioritize fresh buyers. Schema cols come from
// 2026-06-19_buyer_buybox_enrich.sql; degrades silently until that migration runs.
async function captureBuyerBuyBox(buyer, body) {
  const box = await extractBuyBox(body, buyer);
  if (!box) return;

  const updates = {};
  const unionArr = (existing, incoming) => {
    const have = (existing || []).map(s => String(s).trim());
    const add  = (incoming || []).map(s => String(s).trim()).filter(Boolean);
    const merged = Array.from(new Set([...have, ...add]));
    return merged.length > have.length ? merged : null; // null = nothing new to write
  };

  const states = unionArr(buyer.buy_box_states, box.states);
  if (states) updates.buy_box_states = states;
  const types = unionArr(buyer.buy_box_types, box.types);
  if (types) updates.buy_box_types = types;
  const cities = unionArr(buyer.property_cities, box.cities);
  if (cities) updates.property_cities = cities;

  if (buyer.max_price == null && box.max_price != null) updates.max_price = box.max_price;
  if (buyer.min_price == null && box.min_price != null) updates.min_price = box.min_price;
  if (buyer.cash_only == null && box.cash_only != null) updates.cash_only = box.cash_only;
  if (buyer.proof_of_funds == null && box.proof_of_funds != null) updates.proof_of_funds = box.proof_of_funds;

  // Always record contact recency; only stamp buybox_updated_at if we actually learned
  // something new about the buy box.
  const now = new Date().toISOString();
  updates.last_contact_at = now;
  if (Object.keys(updates).length > 1) updates.buybox_updated_at = now;

  const { error } = await supabase
    .from('buyers')
    .update(updates)
    .eq('id', buyer.id)
    .eq('user_id', buyer.user_id);
  if (error) {
    // Missing-column = migration not run yet; degrade silently. Other errors logged.
    if (!/column .* does not exist/i.test(error.message)) {
      console.warn('[SMS] buy-box merge update error:', error.message);
    }
    return;
  }
  if (Object.keys(updates).length > 1) {
    console.log(`[SMS] Buy-box captured for buyer ${buyer.id}: ${Object.keys(updates).filter(k => k !== 'last_contact_at').join(', ')}`);
  }
}

// Returns true when `from` belongs to a buyer (the reply was handled here).
async function handleBuyerReply(from, toNumber, inboundMsgId, body) {
  const buyerDispo = require('../services/buyerDispoService');
  const { buyers, offers } = await buyerDispo.findPendingOffers(from);
  if (!buyers.length) return false;

  try {
    const choice = buyerDispo.pickOfferForReply(offers, body);
    // Attribute the message to the buyer row behind the most relevant open offer.
    const primaryOffer = choice.offer || offers[0] || null;
    const buyer = (primaryOffer && buyers.find(b => b.id === primaryOffer.buyer_id)) || buyers[0];
    const userId = primaryOffer?.user_id || buyer.user_id;
    const now = new Date().toISOString();

    // 1. Save the inbound message on the buyer.
    const { error: logErr } = await supabase.from('sms_messages').insert({
      user_id: userId, buyer_id: buyer.id, direction: 'inbound', from_number: from, to_number: toNumber,
      body, telnyx_message_id: inboundMsgId, status: 'received', sent_at: now,
    });
    if (logErr) console.error('[SMS] buyer reply log failed:', logErr.message);
    if (primaryOffer?.campaign_id) {
      await supabase.rpc('increment_buyer_campaign', { p_campaign_id: primaryOffer.campaign_id, p_replies: 1 })
        .then(({ error }) => { if (error) console.warn('[SMS] reply counter failed:', error.message); });
    }

    // 1b. Learn buy-box facts from every reply ("too high at 250k" teaches the ceiling).
    try { await captureBuyerBuyBox(buyer, body); }
    catch (e) { console.warn('[SMS] buy-box capture failed (non-fatal):', e.message); }

    const saidNo = BUYER_NO.test(body);
    const interested = BUYER_YES.test(body) && !saidNo;
    console.log(`[SMS] Buyer reply from buyer ${buyer.id} - interested=${interested} offers=${offers.length} pick=${choice.kind}`);

    if (!interested) {
      if (saidNo && choice.kind === 'single') {
        const o = choice.offer;
        await supabase.from('buyer_deal_offers')
          .update({ status: 'passed', replied_at: now, reply_body: String(body).slice(0, 1000), updated_at: now })
          .eq('id', o.id);
        try {
          await require('../services/dataMotService').recordBuyerDealOutcome({
            buyerId: o.buyer_id, dealId: o.deal_id, userId: o.user_id, outcome: 'passed',
            reason: String(body).slice(0, 120), offeredPrice: buyerDispo.dealAskPrice(o.deals),
            arv: o.deals.arv || null, propertyState: o.deals.property_state || null,
          });
        } catch (_) { /* history is non-critical */ }
      }
      return true;
    }

    if (choice.kind === 'none') {
      console.log(`[SMS] Buyer ${buyer.id} said yes but has no open offer - nothing assigned`);
      return true;
    }

    if (choice.kind === 'ambiguous') {
      // Several open deals and the buyer didn't say which: ask, never guess.
      const ids = choice.options.map(o => o.id);
      await supabase.from('buyer_deal_offers')
        .update({ status: 'interested', replied_at: now, reply_body: String(body).slice(0, 1000), updated_at: now })
        .in('id', ids).in('status', ['queued', 'sent']);
      const list = choice.options.map((o, i) => `${i + 1}) ${[o.deals.property_address, o.deals.property_city].filter(Boolean).join(', ')}`).join('\n');
      await sendReply(from, `Glad you're interested! I have a few deals out - which one? Reply with the street address:\n${list}`, userId, null)
        .catch(e => console.warn('[SMS] which-deal reply failed:', e.message));
      return true;
    }

    const offer = choice.offer;
    const fit = offer.deals;

    // 2. Assign - only if the deal is still unassigned (race-safe).
    const { data: claimed } = await supabase.from('deals')
      .update({ buyer_id: offer.buyer_id, updated_at: now })
      .eq('id', fit.id).eq('user_id', offer.user_id).is('buyer_id', null)
      .select('id').maybeSingle();
    if (!claimed) {
      await supabase.from('buyer_deal_offers').update({ status: 'not_selected', replied_at: now, reply_body: String(body).slice(0, 1000), updated_at: now }).eq('id', offer.id);
      await sendReply(from, 'Thanks for jumping on it - that one was just taken. I\'ll send you the next deal that fits.', offer.user_id, null)
        .catch(e => console.warn('[SMS] deal-taken reply failed:', e.message));
      return true;
    }
    await supabase.from('buyer_deal_offers')
      .update({ status: 'assigned', replied_at: now, reply_body: String(body).slice(0, 1000), updated_at: now })
      .eq('id', offer.id);
    await supabase.from('buyer_deal_offers')
      .update({ status: 'not_selected', updated_at: now })
      .eq('deal_id', fit.id).neq('id', offer.id).in('status', ['queued', 'sent', 'interested']);
    if (offer.campaign_id) {
      await supabase.from('buyer_campaigns').update({ assigned_buyer_id: offer.buyer_id }).eq('id', offer.campaign_id);
      await supabase.rpc('increment_buyer_campaign', { p_campaign_id: offer.campaign_id, p_interested: 1 })
        .then(({ error }) => { if (error) console.warn('[SMS] interested counter failed:', error.message); });
    }
    const assignedBuyer = buyers.find(b => b.id === offer.buyer_id) || buyer;
    const ownerId = offer.user_id;

    await require('../services/aiCommandLog').logAiCommand({
      userId: ownerId, dealId: fit.id, leadId: fit.lead_id || null, actionType: 'buyer_assigned_auto',
      summary: `Buyer ${assignedBuyer.name || 'buyer'} replied YES - assigned to ${fit.property_address || 'deal'}`,
    });
    try {
      await require('../services/dealActivityService').logActivity({
        userId: ownerId, dealId: fit.id, leadId: fit.lead_id || null, actorType: 'buyer',
        activityType: 'buyer_assigned', message: `Property assigned to buyer ${assignedBuyer.name || from}`,
        metadata: { buyer_id: assignedBuyer.id, buyer_name: assignedBuyer.name || null, via: 'sms_reply_yes', offer_id: offer.id },
      });
    } catch (e) { console.warn('[SMS] buyer-assigned activity log failed (non-fatal):', e.message); }

    // Buyer history: interested, not "won" - the buyer has not closed yet.
    try {
      await require('../services/dataMotService').recordBuyerDealOutcome({
        buyerId: assignedBuyer.id, dealId: fit.id, userId: ownerId, outcome: 'interested',
        offeredPrice: buyerDispo.dealAskPrice(fit), arv: fit.arv || null, propertyState: fit.property_state || null,
      });
    } catch (_) { /* history is non-critical */ }

    // 3. Assignment contract - emailed by contractService; texted here.
    try {
      const contractService = require('../services/contractService');
      const result = await contractService.send({ ...fit, buyers: assignedBuyer, leads: fit.leads || {} }, 'assignment', {
        userId: ownerId, sms: false,
      });
      await supabase.from('deals')
        .update({ contract_status: result.status === 'sent' ? 'assignment_sent' : 'assignment_created', updated_at: new Date().toISOString() })
        .eq('id', fit.id);
      await require('../services/aiCommandLog').logAiCommand({
        userId: ownerId, dealId: fit.id, actionType: 'assignment_contract_sent', status: result.status,
        summary: `Assignment contract for ${assignedBuyer.name || 'buyer'}: ${result.deliveries.map(d => `${d.role} ${d.channel} ${d.status}`).join('; ')}`,
      });
      await require('../services/dealActivityService').logActivity({
        userId: ownerId, dealId: fit.id, leadId: fit.lead_id || null, actorType: 'system',
        activityType: 'assignment_contract_sent', message: `Assignment contract sent to buyer ${assignedBuyer.name || from}`,
        metadata: { buyer_id: assignedBuyer.id, contract_id: result.contract_id, deliveries: result.deliveries },
      }).catch(() => {});
      if (result.signing_url) {
        await sendReply(from, `Great - here's the assignment contract to sign: ${result.signing_url}`, ownerId, null)
          .catch(e => console.warn('[SMS] contract link reply failed:', e.message));
      }
    } catch (e) {
      console.error('[SMS] Assignment contract auto-send failed:', e.message);
    }

    // 4. Earnest money request - amount from the deal, else the operator's default.
    //    With neither set, nothing is invented: the step is logged as skipped.
    try {
      const { data: op } = await supabase.from('users').select('*').eq('id', ownerId).maybeSingle();
      const raw = fit.emd_amount ?? op?.earnest_money_default;
      const emdAmount = raw != null && Number(raw) > 0 ? Number(raw) : null;
      if (!emdAmount) {
        await require('../services/aiCommandLog').logAiCommand({
          userId: ownerId, dealId: fit.id, actionType: 'emd_request', status: 'skipped',
          summary: 'No earnest money amount on the deal or in settings - deposit not requested',
        });
      } else {
        await supabase.from('deals').update({
          emd_status: 'requested', emd_amount: emdAmount, emd_requested_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }).eq('id', fit.id).eq('user_id', ownerId);
        await require('../services/dealActivityService').logActivity({
          userId: ownerId, dealId: fit.id, leadId: fit.lead_id || null, actorType: 'system', activityType: 'emd_requested',
          message: `Earnest money deposit requested ($${emdAmount.toLocaleString()}) from buyer ${assignedBuyer.name || from}`,
          metadata: { buyer_id: assignedBuyer.id, emd_amount: emdAmount },
        }).catch(() => {});
        await sendReply(from, `To lock this in, the next step is a $${emdAmount.toLocaleString()} earnest money deposit. I'll send the wiring details shortly.`, ownerId, null)
          .catch(e => console.warn('[SMS] EMD reply failed:', e.message));
      }
    } catch (e) {
      console.warn('[SMS] EMD request failed (non-fatal):', e.message);
    }
    return true;
  } catch (err) {
    console.error('[SMS] handleBuyerReply error:', err.message);
    return true;
  }
}

// POST /api/sms/send - manual send (authenticated)
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

// GET /api/sms/conversation/:leadId - load SMS history for a lead
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

// GET /api/sms/inbox - all SMS conversations grouped by lead, newest first
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

// POST /api/sms/read/:leadId - mark all inbound messages for a lead as read
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

// POST /api/sms/status - Twilio delivery-status callback for OUTBOUND messages.
// Twilio posts here as a message moves through queued -> sent -> delivered (or
// undelivered/failed). We update sms_messages.status by the Twilio SID so the record
// reflects REAL carrier delivery, not just "handed to Twilio". No auth (Twilio webhook);
// validated by X-Twilio-Signature when TWILIO_AUTH_TOKEN is set.
router.post('/status', async (req, res) => {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (authToken) {
    const sig = req.get('X-Twilio-Signature');
    const url = `https://${req.get('host')}${req.originalUrl}`;
    if (!twilio.validateRequest(authToken, sig, url, req.body || {})) {
      console.warn('[SMS] Rejected status callback - invalid Twilio signature');
      return res.sendStatus(403);
    }
  }
  res.sendStatus(200); // ack immediately

  try {
    const sid    = req.body?.MessageSid || req.body?.SmsSid;
    const status = req.body?.MessageStatus || req.body?.SmsStatus;
    if (!sid || !status) return;
    // telnyx_message_id is the column the sender stores the Twilio SID in (legacy name).
    await supabase.from('sms_messages').update({ status }).eq('telnyx_message_id', sid);
    console.log(`[SMS] delivery status ${sid} -> ${status}`);
  } catch (e) {
    console.error('[SMS] status callback error:', e.message);
  }
});

module.exports = router;
