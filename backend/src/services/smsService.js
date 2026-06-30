/**
 * SMS Service — Twilio
 * Sends tag-matched opening texts to leads on import.
 * Scores replies via GPT-4o and auto-escalates hot leads (60+) to Vapi voice call.
 *
 * This file is the SINGLE Twilio send point for the whole app. Every other module
 * that sends SMS calls sendSMS() from here.
 */

const axios = require('axios');
const twilio = require('twilio');
const supabase = require('../config/supabase');

const TWILIO_SID   = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const SMS_FROM     = process.env.TWILIO_PHONE_NUMBER;
const MSG_SERVICE_SID = process.env.TWILIO_MESSAGING_SERVICE_SID; // A2P 10DLC registered sender (MGxxxx)

const twilioClient = (TWILIO_SID && TWILIO_TOKEN) ? twilio(TWILIO_SID, TWILIO_TOKEN) : null;

/**
 * Single Twilio send point. Returns the Twilio message SID, or null on failure.
 * @param {string} to   E.164 destination number
 * @param {string} text Message body
 * @returns {Promise<string|null>} Twilio message SID
 */
async function sendSMS(to, text, userId = null) {
  if (!twilioClient) {
    console.warn('[SMS] Twilio not configured (TWILIO_ACCOUNT_SID/AUTH_TOKEN missing) — skipping');
    return null;
  }

  // GHL-style per-operator sender routing:
  //   1. operator's OWN A2P 10DLC Messaging Service (registered local sender, needs EIN) — best
  //   2. else operator's toll-free number (toll-free verified, no EIN needed) — default
  //   3. else global Messaging Service SID, else single from-number — fallback (unchanged behavior)
  let sender = null;

  if (userId) {
    const { data: op } = await supabase
      .from('users')
      .select('a2p_messaging_service_sid')
      .eq('id', userId)
      .single();

    if (op?.a2p_messaging_service_sid) {
      sender = { messagingServiceSid: op.a2p_messaging_service_sid };
    } else {
      const { data: tf } = await supabase
        .from('phone_numbers')
        .select('number')
        .eq('user_id', userId)
        .eq('is_toll_free', true)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      if (tf?.number) sender = { from: tf.number };
    }
  }

  // Fallback chain when the operator has neither a registered service nor a toll-free number yet.
  if (!sender) {
    sender = MSG_SERVICE_SID ? { messagingServiceSid: MSG_SERVICE_SID } : { from: SMS_FROM };
  }

  const msg = await twilioClient.messages.create({ ...sender, to, body: text });
  return msg.sid;
}

/**
 * Worker send point for the heavy SMS-blast queue.
 *
 * Unlike sendSMS(), this does NOT re-run the 3-tier sender lookup — the queue
 * worker has already chosen a rotation sender (smsRotation.selectSmsNumber) and
 * passes it in via `senderOverride`, saving 1-2 Supabase queries per send at
 * blast scale. It performs the raw Twilio send and logs to sms_messages, exactly
 * like the metered paths. It does NOT gate on DNC or outreach credits — the
 * processor (smsBlastProcessor) owns those checks before calling this.
 *
 * @param {object} a
 * @param {string} a.to             E.164 destination
 * @param {string} a.body           message body
 * @param {string} [a.userId]
 * @param {string} [a.leadId]
 * @param {{kind:'mgs'|'number', value:string}} [a.senderOverride]  chosen sender
 * @returns {Promise<string|null>} Twilio message SID
 */
async function sendSMSDirect({ to, body, userId = null, leadId = null, senderOverride = null }) {
  if (!twilioClient) {
    console.warn('[SMS] Twilio not configured — sendSMSDirect skipped');
    return null;
  }
  if (!to || !body) return null;

  // Translate the rotation choice into Twilio's create() shape. If no override is
  // supplied, fall back to the same env chain sendSMS uses (keeps callers safe).
  let sender;
  if (senderOverride?.kind === 'mgs')         sender = { messagingServiceSid: senderOverride.value };
  else if (senderOverride?.kind === 'number') sender = { from: senderOverride.value };
  else sender = MSG_SERVICE_SID ? { messagingServiceSid: MSG_SERVICE_SID } : { from: SMS_FROM };

  const msg = await twilioClient.messages.create({ ...sender, to, body });
  const msgId = msg.sid;

  // Log identically to the metered paths (telnyx_message_id reused for Twilio SID).
  await supabase.from('sms_messages').insert({
    user_id:    userId,
    lead_id:    leadId,
    direction:  'outbound',
    from_number: sender.from || sender.messagingServiceSid || SMS_FROM,
    to_number:  to,
    body,
    telnyx_message_id: msgId,
    status:     'sent',
    sent_at:    new Date().toISOString(),
  }).catch(() => {});

  return msgId;
}

// ─── Tag-matched opening messages ────────────────────────────────────────────

const OPENING_MESSAGES = {
  pre_foreclosure: (name, address) =>
    `Hey ${name}, this is Alex. I came across your property on ${address} and just wanted to reach out. I buy homes cash and can close quick if that helps your situation at all. No pressure, just wanted to put it out there.`,

  tax_delinquent: (name, address) =>
    `Hey ${name}, Alex here. I buy houses in your area and saw your property on ${address}. If you ever want to just be done with it I can make you a cash offer and close fast. Worth a quick chat?`,

  inherited: (name, address) =>
    `Hey ${name}, my name is Alex. I heard you may have inherited a property on ${address} and just wanted to reach out. If it's something you'd want to sell I buy as-is cash so you don't have to deal with repairs or showings. No rush at all.`,

  vacant: (name, address) =>
    `Hey ${name}, this is Alex. I buy properties in your area and noticed your place on ${address}. If you're open to selling I can make a fast cash offer. Real easy process. Interested?`,

  absentee_owner: (name, address) =>
    `Hey ${name}, Alex here. I'm a local buyer and I'm interested in your property on ${address}. If you'd ever think about selling I can make it simple with a cash offer on your timeline. Let me know.`,

  default: (name, address) =>
    `Hey ${name}, this is Alex. I buy houses in your area and wanted to reach out about your property on ${address}. Cash offer, no repairs, close whenever works for you. Open to talking?`,
};

function getOpeningMessage(lead) {
  const tag = (lead.primary_tag || '').toLowerCase().replace(/[^a-z_]/g, '_');
  const template = OPENING_MESSAGES[tag] || OPENING_MESSAGES.default;
  const name = lead.first_name || 'there';
  const address = lead.property_address || 'your property';
  return template(name, address);
}

// ─── D — Per-tag SMS talk-track ───────────────────────────────────────────────
//
// The VOICE brain already adapts per lead type via vapiService.buildTagIntelligenceBlock
// (tone/goal/never/angle per tag). But once an SMS conversation goes live,
// continueConversation() was generic "friendly Alex" — the per-type personality was
// only used for the OPENING template, then dropped. This restores it: a compact
// talk-track injected into the live SMS reply brain so a pre-foreclosure seller and
// an inherited-property seller are texted in distinctly different voices — same as
// the call would. Additive: unknown/missing tag → '' → identical behavior to before.
const SMS_TAG_PLAYBOOK = {
  pre_foreclosure: 'This seller may be facing foreclosure — lead with empathy and SPEED. Frame it as relief ("I can close before the auction date"). Never sound like a debt collector. Be gentle; they\'re stressed.',
  tax_delinquent:  'Owes back taxes — the angle is making the burden disappear. "I can take it off your hands and you walk away clean." Don\'t lecture about the taxes; offer the exit.',
  inherited:       'Inherited the property — likely emotional and out-of-state. No pressure, lots of patience. "No rush, whenever you\'re ready." Emphasize as-is, no cleanout, no repairs, no showings.',
  probate:         'Property in probate — be respectful and process-aware. They may not have authority to sell yet. Ask gently where they are in probate; offer to wait and make it easy when ready.',
  vacant:          'Vacant property — it\'s a liability draining them (taxes, insurance, upkeep). The angle is "stop paying to hold an empty house." Move toward a fast, clean offer.',
  absentee_owner:  'Out-of-area owner — likely a tired landlord. Lead with convenience: "I handle everything remotely, you never have to fly out." Emphasize simplicity and speed.',
  fsbo:            'Trying to sell themselves — respect that, don\'t bash agents. Position as a backup cash option with certainty. "If you want a clean cash close with no showings, I\'m here."',
  free_and_clear:  'Owns it outright — no mortgage pressure, so motivation is lifestyle/convenience, not money panic. Don\'t lowball hard; sell ease, speed, and certainty of close.',
  cash_buyer:      'This is an investor/buyer, not a distressed seller — talk numbers, spread, and ROI. Be direct and concise; they value efficiency over rapport.',
};

function buildTagPlaybookForSMS(lead) {
  const tag = (lead?.primary_tag || '').toLowerCase().replace(/[^a-z_]/g, '_');
  const track = SMS_TAG_PLAYBOOK[tag];
  if (!track) return '';
  return `\nLEAD TYPE: ${tag.replace(/_/g, ' ')} — ${track}`;
}

// ─── Send opening SMS to a lead ───────────────────────────────────────────────

async function sendOpeningSMS(lead, userId) {
  if (!twilioClient) {
    console.warn('[SMS] Twilio not configured — skipping');
    return null;
  }

  const phone = lead.phone;
  if (!phone) return null;

  // DNC gate — never send to opted-out numbers
  if (lead.is_on_dnc) {
    await supabase.from('tcpa_log').insert({
      user_id:  userId,
      lead_id:  lead.id,
      phone,
      action:   'sms_blocked_dnc',
      notes:    'Opening SMS blocked — lead is on DNC list',
      created_at: new Date().toISOString(),
    }).catch(() => {});
    console.warn(`[SMS] Blocked — ${phone} is on DNC`);
    return null;
  }

  // Outreach credit gate — opening SMS is metered lead outreach.
  // 1 SMS = 1 credit; monthly allocation first, then top-up. Blocked when both
  // are exhausted. Compliance/transactional SMS go through sendSMS() directly
  // and are NEVER gated here.
  const outreachCredits = require('./outreachCredits');
  const reservation = await outreachCredits.reserve(userId, 1);
  if (!reservation.allowed) {
    await supabase.from('sms_messages').insert({
      user_id:    userId,
      lead_id:    lead.id,
      direction:  'outbound',
      from_number: SMS_FROM,
      to_number:  phone,
      body:       getOpeningMessage(lead),
      status:     'blocked_no_credits',
      sent_at:    new Date().toISOString(),
    }).catch(() => {});
    console.warn(`[SMS] Opening blocked — outreach credits ${reservation.reason} (lead: ${lead.id})`);
    return null;
  }

  const body = getOpeningMessage(lead);

  try {
    const msgId = await sendSMS(phone, body, userId);

    // Log in DB (telnyx_message_id column reused to store the Twilio SID)
    await supabase.from('sms_messages').insert({
      user_id:    userId,
      lead_id:    lead.id,
      direction:  'outbound',
      from_number: SMS_FROM,
      to_number:  phone,
      body,
      telnyx_message_id: msgId,
      status:     'sent',
      sent_at:    new Date().toISOString(),
    }).catch(() => {});

    console.log(`[SMS] Opening sent to ${phone} (lead: ${lead.id})`);
    return msgId;
  } catch (err) {
    console.error('[SMS] Send failed:', err.response?.data || err.message);
    return null;
  }
}

// ─── Score an inbound SMS reply via GPT-4o ───────────────────────────────────

// sellerContext (optional) is the seller_profiles row from dataMotService —
// when present, the score is judged WITH the seller's call history behind it
// (A — unified memory). Omitted/null → identical behavior to before.
async function scoreReply(conversationHistory, newMessage, sellerContext = null, dealBlock = '') {
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) return 50;

  try {
    let contextBlock = '';
    try {
      const { buildSMSContextBlock } = require('./dataMotService');
      contextBlock = buildSMSContextBlock(sellerContext);
    } catch (_) { contextBlock = ''; }
    // Deal-state awareness: an in-flight deal means this isn't a cold reply —
    // score it knowing the seller already engaged/agreed. '' when no deal.
    if (dealBlock) contextBlock += dealBlock;

    const prompt = `You are an expert real estate acquisitions analyst. Score the seller's motivation to sell their property from 0 to 100 based on this SMS conversation.

0-40 = Not interested / hostile / just looking
40-60 = Warm / curious / might be open
60-100 = Hot / motivated / wants to sell soon
${contextBlock}

Previous messages:
${conversationHistory.map(m => `${m.role}: ${m.body}`).join('\n')}

New message from seller: "${newMessage}"

Reply with ONLY a JSON object: {"score": <0-100>, "reason": "<one sentence>", "next_action": "follow_up_7_days" | "continue_sms" | "call_now"}`;

    const res = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 100,
      response_format: { type: 'json_object' },
    }, {
      headers: { Authorization: `Bearer ${OPENAI_KEY}` },
      timeout: 10000,
    });

    const result = JSON.parse(res.data.choices[0].message.content);
    return result;
  } catch (e) {
    console.error('[SMS] Score error:', e.message);
    return { score: 50, reason: 'Unable to score', next_action: 'continue_sms' };
  }
}

// ─── Continue SMS conversation (score 40-60) ─────────────────────────────────

async function continueConversation(lead, sellerMessage, conversationHistory, sellerContext = null, dealBlock = '') {
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) return null;

  try {
    let contextBlock = '';
    try {
      const { buildSMSContextBlock } = require('./dataMotService');
      contextBlock = buildSMSContextBlock(sellerContext);
    } catch (_) { contextBlock = ''; }
    // Deal-state awareness: continue the text knowing where the deal stands so
    // Alex advances it instead of re-asking settled questions. '' when no deal.
    if (dealBlock) contextBlock += dealBlock;

    // D — per-tag talk-track: text this seller in the SAME voice the call would use
    // for their lead type (empty string for unknown/missing tag → unchanged behavior).
    const tagPlaybook = buildTagPlaybookForSMS(lead);

    const res = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are Alex, a friendly local real estate investor texting a potential seller. Keep replies SHORT (1-2 sentences max), conversational, and focused on understanding their situation. Never pressure. Ask one question at a time. Goal: understand their timeline, motivation, and asking price.${tagPlaybook}${contextBlock ? '\n' + contextBlock : ''}`
        },
        ...conversationHistory.map(m => ({ role: m.role === 'outbound' ? 'assistant' : 'user', content: m.body })),
        { role: 'user', content: sellerMessage }
      ],
      temperature: 0.7,
      max_tokens: 100,
    }, {
      headers: { Authorization: `Bearer ${OPENAI_KEY}` },
      timeout: 10000,
    });

    return res.data.choices[0].message.content.trim();
  } catch (e) {
    console.error('[SMS] Continue conversation error:', e.message);
    return null;
  }
}

// ─── Send a reply SMS ─────────────────────────────────────────────────────────

async function sendReply(toPhone, body, userId, leadId) {
  try {
    // DNC gate — check before every outbound SMS
    const { data: dncCheck } = await supabase
      .from('dnc_records')
      .select('id')
      .eq('phone', toPhone)
      .maybeSingle();

    if (dncCheck) {
      await supabase.from('tcpa_log').insert({
        user_id:  userId,
        lead_id:  leadId,
        phone:    toPhone,
        action:   'sms_blocked_dnc',
        notes:    'Reply SMS blocked — phone is on DNC list',
        created_at: new Date().toISOString(),
      }).catch(() => {});
      console.warn(`[SMS] Reply blocked — ${toPhone} is on DNC`);
      return null;
    }

    // Outreach credit gate — AI outreach replies are metered lead outreach.
    const outreachCredits = require('./outreachCredits');
    const reservation = await outreachCredits.reserve(userId, 1);
    if (!reservation.allowed) {
      await supabase.from('sms_messages').insert({
        user_id:    userId,
        lead_id:    leadId,
        direction:  'outbound',
        from_number: SMS_FROM,
        to_number:  toPhone,
        body,
        status:     'blocked_no_credits',
        sent_at:    new Date().toISOString(),
      }).catch(() => {});
      console.warn(`[SMS] Reply blocked — outreach credits ${reservation.reason} (lead: ${leadId})`);
      return null;
    }

    const msgId = await sendSMS(toPhone, body, userId);

    await supabase.from('sms_messages').insert({
      user_id:    userId,
      lead_id:    leadId,
      direction:  'outbound',
      from_number: SMS_FROM,
      to_number:  toPhone,
      body,
      telnyx_message_id: msgId,
      status:     'sent',
      sent_at:    new Date().toISOString(),
    }).catch(() => {});

    return msgId;
  } catch (err) {
    console.error('[SMS] Reply failed:', err.response?.data || err.message);
    return null;
  }
}

// ─── Escalate to Vapi voice call ──────────────────────────────────────────────

async function escalateToCall(lead, userId) {
  try {
    const vapiService  = require('./vapiService');
    const phoneRotation = require('./phoneRotation');

    // Derive the lead's area code for local-presence matching (305 lead → 305 number).
    // Mirrors smsFirstWorkflow.js so a hot-reply call keeps the same local-presence edge.
    const leadDigits   = String(lead.phone || '').replace(/\D/g, '');
    const leadAreaCode = leadDigits.length === 11 && leadDigits.startsWith('1')
      ? leadDigits.slice(1, 4)
      : (leadDigits.length === 10 ? leadDigits.slice(0, 3) : null);

    // selectBestNumber handles geo/area-code tiers, cooldown/daily-cap health,
    // and excludes toll-free (calls go on LOCAL numbers only).
    const phoneNumber = await phoneRotation.selectBestNumber(
      userId,
      lead.property_state || null,
      [],
      leadAreaCode,
    );
    if (!phoneNumber) {
      console.warn('[SMS] No healthy local phone number for escalation');
      return;
    }

    const { data: operator } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    // Create call record
    const { data: callRec } = await supabase.from('calls').insert({
      user_id:        userId,
      lead_id:        lead.id,
      phone_number:   lead.phone,
      phone_number_id: phoneNumber.id,
      status:         'queued',
      direction:      'outbound',
      triggered_by:   'sms_escalation',
      created_at:     new Date().toISOString(),
    }).select().single();

    await vapiService.initiateCall({
      lead,
      phoneNumber,
      callId: callRec.id,
      operator: operator || {},
    });

    // Apply cooldown + increment daily/weekly counters so this number rotates correctly.
    await phoneRotation.recordCallStart(phoneNumber.id);

    console.log(`[SMS] Escalated to call — lead ${lead.id} scored hot (number ${phoneNumber.phone_number || phoneNumber.id})`);
  } catch (err) {
    console.error('[SMS] Escalation failed:', err.message);
  }
}

// ─── Buy-box capture from a buyer's reply ────────────────────────────────────
// The user's directive: a buyer's profile (their "crash/card barrier") must live
// INSIDE the system — reviewed, not just logged. When a buyer texts back, this
// reads their reply and returns the buy-box facts they actually stated so the
// caller can MERGE them onto the buyers row.
//
// AI-first (locked decision): GPT-4o-mini, same model/timeout/json pattern as
// scoreReply — cheap, bounded, one call. Regex fallback runs when there's no
// OPENAI_KEY or the call fails, so capture still works with zero AI. Neither path
// TEXTS the buyer — this is a silent reader; the reply/assignment flow is separate.
//
// Returns ONLY fields the buyer expressed (others null/empty) so the merge never
// clobbers a known value with a guess.

const US_STATES = new Set(['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC']);

function regexBuyBox(body) {
  const text = String(body || '');
  const upper = text.toUpperCase();

  // States: standalone 2-letter US codes.
  const states = [];
  for (const m of upper.matchAll(/\b([A-Z]{2})\b/g)) {
    if (US_STATES.has(m[1]) && !states.includes(m[1])) states.push(m[1]);
  }

  // Prices: $ amounts, with optional k/m suffix.
  const prices = [];
  for (const m of text.matchAll(/\$?\s?(\d[\d,]*(?:\.\d+)?)\s*([kKmM])?/g)) {
    let n = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(n)) continue;
    const suf = (m[2] || '').toLowerCase();
    if (suf === 'k') n *= 1000;
    else if (suf === 'm') n *= 1000000;
    if (n >= 1000) prices.push(n); // ignore tiny numbers (counts, etc.)
  }
  let min_price = null, max_price = null;
  if (prices.length === 1) max_price = prices[0];
  else if (prices.length >= 2) { min_price = Math.min(...prices); max_price = Math.max(...prices); }

  const cash_only = /\bcash\b/i.test(text) ? true : null;
  const proof_of_funds = /\b(pof|proof of funds)\b/i.test(text) ? true : null;

  return { states, cities: [], min_price, max_price, types: [], cash_only, proof_of_funds };
}

async function extractBuyBox(body, buyer = null) {
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!body || !String(body).trim()) return null;

  // No AI key → regex-only.
  if (!OPENAI_KEY) return regexBuyBox(body);

  try {
    const prompt = `You read a cash buyer's text reply and extract ONLY the buy-box facts they explicitly stated. Do NOT guess or infer beyond what's written.

Buyer reply: "${String(body).slice(0, 800)}"

Reply with ONLY a JSON object. Use null / empty arrays for anything the buyer did NOT state:
{"states": ["TX"], "cities": ["Dallas"], "min_price": <number|null>, "max_price": <number|null>, "types": ["single_family"], "cash_only": <true|false|null>, "proof_of_funds": <true|false|null>}`;

    const res = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 150,
      response_format: { type: 'json_object' },
    }, {
      headers: { Authorization: `Bearer ${OPENAI_KEY}` },
      timeout: 10000,
    });

    const r = JSON.parse(res.data.choices[0].message.content) || {};
    const arr = (v) => Array.isArray(v) ? v.map(s => String(s).trim()).filter(Boolean) : [];
    const num = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
    const bool = (v) => (v === true || v === false ? v : null);
    return {
      states:          arr(r.states).map(s => s.toUpperCase()),
      cities:          arr(r.cities),
      min_price:       num(r.min_price),
      max_price:       num(r.max_price),
      types:           arr(r.types).map(t => t.toLowerCase()),
      cash_only:       bool(r.cash_only),
      proof_of_funds:  bool(r.proof_of_funds),
    };
  } catch (e) {
    console.warn('[SMS] extractBuyBox AI failed — regex fallback:', e.message);
    return regexBuyBox(body);
  }
}

module.exports = { sendSMS, sendSMSDirect, sendOpeningSMS, scoreReply, continueConversation, sendReply, escalateToCall, extractBuyBox };
