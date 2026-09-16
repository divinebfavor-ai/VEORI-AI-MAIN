// ─── Post-call pipeline ──────────────────────────────────────────────────────
// Everything that should happen after a call ends, for BOTH voice engines:
//   • deal for a verbal yes / appointment (and, when enabled, the purchase contract)
//   • follow-up sequence for the outcome
//   • seller memory (data moat)
//   • appointment + AI callback at the time the seller asked for
//   • photo request for an engaged seller
//   • missed-call text, direct-mail trigger, campaign stats, number health
//
// WHY THIS EXISTS: these steps lived only in the decommissioned Vapi webhook
// (routes/vapi.js handleCallEnded). The live in-house engine (routes/v2voice.js)
// scored the call and moved the lead, then stopped - a "yes" on a real call created
// no deal, no follow-up, no callback and no memory.
//
// Exactly once per call: runPostCallActions claims the call by stamping
// calls.post_call_processed_at only where it is still NULL. A repeated Twilio
// status callback, or a retry, finds the row already claimed and does nothing.
// Every step is independent and caught: one failing never stops the rest.

const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');

const OUTCOME_TO_SEQUENCE = {
  not_interested:     'not_interested',
  callback_requested: 'callback_requested',
  offer_made:         'offer_considering',
  appointment:        'callback_requested',
  voicemail:          'not_interested',
  no_answer:          'not_interested',
};
// verbal_yes is agreement in principle, not a signed contract: the deal starts at
// negotiating. under_contract is reached when the purchase contract is signed,
// which is what starts buyer outreach (see dealStageService).
const OUTCOME_TO_DEAL_STAGE = { verbal_yes: 'negotiating', appointment: 'contacted' };
const MISSED_OUTCOMES = ['no_answer', 'not_home', 'voicemail'];
const TIME_SENSITIVE = ['appointment', 'callback_requested'];

async function claimCall(callId) {
  const { data, error } = await supabase.from('calls')
    .update({ post_call_processed_at: new Date().toISOString() })
    .eq('id', callId)
    .is('post_call_processed_at', null)
    .select('id');
  if (error) {
    console.error(`[PostCall] claim failed for call ${callId}:`, error.message);
    return false;
  }
  return Array.isArray(data) && data.length === 1;
}

async function step(name, results, fn) {
  try {
    const detail = await fn();
    results.push({ step: name, status: detail === false ? 'skipped' : 'done', detail: detail === false ? undefined : detail });
  } catch (e) {
    console.error(`[PostCall] ${name} failed:`, e.message);
    results.push({ step: name, status: 'failed', detail: e.message });
  }
}

async function isOnDnc(phone) {
  return require('./dncCheck').isOnInternalDnc(phone);
}

// ── Steps ─────────────────────────────────────────────────────────────────────

async function ensureDeal({ callRec, lead, outcome }) {
  const stage = OUTCOME_TO_DEAL_STAGE[outcome];
  if (!stage || !lead) return false;
  const { data: existing, error: exErr } = await supabase.from('deals')
    .select('id').eq('lead_id', lead.id).eq('user_id', callRec.user_id).limit(1);
  if (exErr) throw new Error(exErr.message);
  if ((existing || []).length) return `deal already exists (${existing[0].id})`;

  const { data: deal, error } = await supabase.from('deals').insert({
    id:               uuidv4(),
    user_id:          callRec.user_id,
    lead_id:          lead.id,
    property_address: lead.property_address,
    property_city:    lead.property_city,
    property_state:   lead.property_state,
    property_zip:     lead.property_zip,
    seller_name:      `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || null,
    seller_phone:     lead.phone,
    seller_email:     lead.email,
    estimated_value:  lead.estimated_value,
    estimated_equity: lead.estimated_equity,
    seller_primary_tag: lead.primary_tag,
    status:           stage,
    stage_changed_at: new Date().toISOString(),
  }).select().single();
  if (error) throw new Error(error.message);

  await require('./dealActivityService').logActivity({
    userId: callRec.user_id, dealId: deal.id, leadId: lead.id, actorType: 'ai',
    activityType: 'deal_created',
    message: `Deal created from call - seller outcome: ${outcome.replace(/_/g, ' ')}`,
    metadata: { call_id: callRec.id, outcome, status: stage },
  }).catch(e => console.warn('[PostCall] deal activity log failed:', e.message));

  // Optional: send the purchase contract right after a verbal yes. Off unless the
  // operator sets CONTRACT_AUTO_AFTER_CALL=true.
  if (outcome === 'verbal_yes' && process.env.CONTRACT_AUTO_AFTER_CALL === 'true') {
    try {
      const sent = await require('./contractService').send({ ...deal, leads: lead }, 'psa', { userId: callRec.user_id });
      await require('./aiCommandLog').logAiCommand({
        userId: callRec.user_id, dealId: deal.id, leadId: lead.id, actionType: 'contract_auto_after_call',
        status: sent.status, summary: sent.deliveries.map(d => `${d.role} ${d.channel}: ${d.status}`).join('; '),
      });
    } catch (e) {
      console.error('[PostCall] auto contract failed:', e.message);
    }
  }
  return `deal ${deal.id} created at ${stage}`;
}

async function enrollSequence({ callRec, lead, outcome }) {
  const seqType = OUTCOME_TO_SEQUENCE[outcome];
  if (!seqType || !lead) return false;
  if (lead.is_on_dnc || await isOnDnc(lead.phone)) return false;
  const seq = await require('./sequenceEngine').enrollLeadInSequence(callRec.user_id, lead.id, seqType);
  return seq ? `enrolled in ${seqType}` : `enrollment in ${seqType} returned nothing`;
}

async function recordMemory({ callRec, lead, aiAnalysis }) {
  if (!lead || !aiAnalysis || !Object.keys(aiAnalysis).length) return false;
  await require('./dataMotService').recordCallIntelligence({
    call: { id: callRec.id, duration_seconds: callRec.duration_seconds, transcript: callRec.transcript },
    lead: { ...lead, user_id: callRec.user_id },
    aiAnalysis,
    operator: { id: callRec.user_id },
  });
  return 'seller memory recorded';
}

async function scheduleCallback({ callRec, lead, outcome, aiAnalysis, transcript }) {
  if (!TIME_SENSITIVE.includes(outcome) || !lead) return false;
  let parsed = null;
  if (transcript) {
    try { parsed = await require('./dualAIService').parseCallTime(transcript); }
    catch (e) { console.warn('[PostCall] parseCallTime failed, using default time:', e.message); }
  }
  const now = new Date();
  let whenIso = null;
  if (parsed?.requested_time) {
    const t = new Date(parsed.requested_time);
    if (!isNaN(t.getTime()) && t.getTime() > now.getTime() + 60 * 1000) whenIso = t.toISOString();
  }
  let usedDefault = false;
  if (!whenIso) {
    const fallback = new Date(now);
    fallback.setDate(fallback.getDate() + 1);
    fallback.setHours(10, 0, 0, 0);
    whenIso = fallback.toISOString();
    usedDefault = true;
  }
  const rawSaid = parsed?.requested_time || null;
  const conf = typeof parsed?.confidence === 'number' ? parsed.confidence : null;

  if (outcome === 'appointment') {
    const { error } = await supabase.from('appointments').insert({
      user_id:            callRec.user_id,
      lead_id:            lead.id,
      lead_name:          `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Unknown',
      lead_phone:         lead.phone || null,
      property_address:   lead.property_address || null,
      motivation_score:   aiAnalysis?.motivation_score || null,
      scheduled_at:       whenIso,
      status:             'scheduled',
      call_notes:         aiAnalysis?.ai_summary || 'Appointment set during AI call.',
      requested_time_raw: rawSaid,
      requested_timezone: parsed?.timezone || null,
      time_confidence:    conf,
      source:             'ai_call',
    });
    if (error) throw new Error(`appointment insert: ${error.message}`);
  }

  const followUpId = uuidv4();
  const { error: fuErr } = await supabase.from('follow_ups').insert({
    id:                 followUpId,
    user_id:            callRec.user_id,
    lead_id:            lead.id,
    contact_id:         lead.id,
    contact_type:       'seller',
    follow_up_type:     'call',
    next_follow_up_at:  whenIso,
    reason:             outcome === 'appointment'
                          ? 'Seller booked an appointment - AI callback at requested time.'
                          : 'Seller asked for a callback - AI callback at requested time.',
    status:             'scheduled',
    requested_time_raw: rawSaid,
    time_confidence:    conf,
  });
  if (fuErr) throw new Error(`follow_ups insert: ${fuErr.message}`);

  const jobId = await require('./queueService').scheduleVapiCall({
    followUpId, dealId: null, leadId: lead.id, runAt: whenIso, script: null,
  });
  if (jobId) await supabase.from('follow_ups').update({ bullmq_job_id: String(jobId) }).eq('id', followUpId);
  return `callback at ${whenIso}${usedDefault ? ' (seller gave no time - default next day 10:00)' : ''}${jobId ? '' : ' - queue unavailable, row left for the follow-up cron'}`;
}

async function requestPhotos({ callRec, lead, outcome, aiAnalysis }) {
  const motivated = ['verbal_yes', 'appointment', 'offer_made'].includes(outcome) || (aiAnalysis?.motivation_score >= 75);
  if (!motivated || !lead || lead.has_photos) return false;
  const { count } = await supabase.from('photo_upload_tokens')
    .select('id', { count: 'exact', head: true })
    .eq('lead_id', lead.id)
    .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString());
  if ((count || 0) > 0) return false;

  const token = require('crypto').randomBytes(32).toString('hex');
  const base = process.env.FRONTEND_URL || process.env.APP_URL;
  if (!base) throw new Error('FRONTEND_URL not set - cannot build upload link');
  const url = `${base}/upload/${token}`;
  const name = lead.first_name || 'there';
  const address = [lead.property_address, lead.property_city, lead.property_state].filter(Boolean).join(', ') || 'your property';

  // Text only when the compliance gate allows it (DNC + quiet hours); else email.
  let channel = null;
  if (lead.phone) {
    const { complianceGate } = require('../agents/complianceGate');
    const gate = await complianceGate({ type: 'send_sms', lead }, { skipFederalDnc: true });
    if (gate.allowed) channel = 'sms';
  }
  if (!channel && lead.email) channel = 'email';
  if (!channel) return false;

  const { error: tokErr } = await supabase.from('photo_upload_tokens').insert({
    token, lead_id: lead.id, user_id: callRec.user_id,
    expires_at: new Date(Date.now() + 7 * 86400000).toISOString(), sent_via: channel,
  });
  if (tokErr) throw new Error(tokErr.message);

  if (channel === 'sms') {
    const sid = await require('./smsService').sendSMS(lead.phone,
      `Hi ${name}, thanks for speaking with us about ${address}. Tap to send us a few photos (takes 2 min): ${url} - link expires in 7 days.`,
      callRec.user_id);
    if (!sid) throw new Error('text provider did not accept the photo request');
    return 'photo request texted';
  }
  const r = await require('./emailService').sendEmail({
    userId: callRec.user_id, leadId: lead.id, to: lead.email,
    subject: `Photos of ${lead.property_address || 'your property'}`,
    body: `Hi ${name},\n\nThanks for speaking with us about ${address}. Please send a few photos using this link (takes 2 minutes):\n\n${url}\n\nThe link expires in 7 days.`,
    emailType: 'photo_request',
  });
  return r?.simulated ? 'photo request email simulated (no email provider)' : 'photo request emailed';
}

async function missedCallText({ callRec, lead, outcome }) {
  if (!MISSED_OUTCOMES.includes(outcome)) return false;
  await require('./missedCallService').handleMissedCall(
    { ...callRec, outcome, phone_number: lead?.phone || null }, lead);
  return 'missed-call text evaluated';
}

async function directMail({ callRec, lead, outcome }) {
  if (!['not_home', 'voicemail'].includes(outcome) || !lead || lead.direct_mail_sent) return false;
  const { checkAutoMailTrigger, sendPostcard } = require('./directMailService');
  if (!await checkAutoMailTrigger(lead.id, callRec.user_id)) return false;
  const { data: operator } = await supabase.from('users')
    .select('id, ai_caller_name, company_name, business_phone').eq('id', callRec.user_id).maybeSingle();
  await sendPostcard({ lead, operator: operator || {}, templateKey: 'no_answer' });
  await supabase.from('leads').update({ direct_mail_sent: true }).eq('id', lead.id);
  return 'postcard sent';
}

async function campaignStats({ callRec, outcome }) {
  if (!callRec.campaign_id) return false;
  const answered = callRec.duration_seconds && callRec.duration_seconds > 15 ? 1 : 0;
  const { error } = await supabase.rpc('increment_campaign_stats', {
    p_campaign_id: callRec.campaign_id, p_answered: answered, p_offer_made: outcome === 'offer_made' ? 1 : 0,
  });
  if (error) throw new Error(error.message);
  return 'campaign stats updated';
}

async function phoneHealth({ callRec, outcome }) {
  if (!callRec.phone_number_id) return false;
  const { data: phone } = await supabase.from('phone_numbers').select('spam_score').eq('id', callRec.phone_number_id).maybeSingle();
  if (!phone) return false;
  const d = callRec.duration_seconds;
  let delta = !d || d < 15 ? -10 : d < 60 ? -5 : 3;
  if (['appointment', 'offer_made'].includes(outcome)) delta += 5;
  const score = Math.max(0, Math.min(100, (phone.spam_score ?? 100) + delta));
  const health = score >= 70 ? 'healthy' : score >= 40 ? 'cooling' : 'flagged';
  const { error } = await supabase.from('phone_numbers')
    .update({ spam_score: score, health_status: health, last_used: new Date().toISOString() })
    .eq('id', callRec.phone_number_id);
  if (error) throw new Error(error.message);
  return `number health ${score}`;
}

/**
 * Run every post-call step once for a finished call.
 *
 * @param {object} p
 * @param {object} p.callRec     calls row (with user_id, lead_id, id; duration/transcript if known)
 * @param {string} p.outcome     final outcome
 * @param {object} [p.aiAnalysis] analyzeCallTranscript result ({} when there was no conversation)
 * @returns {Promise<{ ran: boolean, results: Array }>}
 */
async function runPostCallActions({ callRec, outcome, aiAnalysis = {} }) {
  if (!callRec?.id || !callRec.user_id) return { ran: false, results: [] };
  if (!await claimCall(callRec.id)) return { ran: false, results: [] };

  let lead = callRec.leads || null;
  if (callRec.lead_id) {
    const { data } = await supabase.from('leads').select('*').eq('id', callRec.lead_id).maybeSingle();
    lead = data || lead;
  }
  const ctx = { callRec, lead, outcome, aiAnalysis, transcript: callRec.transcript || null };
  const results = [];

  await step('deal', results, () => ensureDeal(ctx));
  await step('sequence', results, () => enrollSequence(ctx));
  await step('memory', results, () => recordMemory(ctx));
  await step('callback', results, () => scheduleCallback(ctx));
  await step('photos', results, () => requestPhotos(ctx));
  await step('missed_call_text', results, () => missedCallText(ctx));
  await step('direct_mail', results, () => directMail(ctx));
  await step('campaign_stats', results, () => campaignStats(ctx));
  await step('phone_health', results, () => phoneHealth(ctx));

  const done = results.filter(r => r.status !== 'skipped');
  if (done.length) {
    await require('./aiCommandLog').logAiCommand({
      userId: callRec.user_id, leadId: lead?.id || null, actionType: 'post_call_actions',
      status: results.some(r => r.status === 'failed') ? 'partial' : 'success',
      summary: `Call ${outcome}: ` + done.map(r => `${r.step} ${r.status}${r.detail ? ` (${r.detail})` : ''}`).join('; '),
    });
  }
  return { ran: true, results };
}

module.exports = { runPostCallActions, OUTCOME_TO_SEQUENCE, OUTCOME_TO_DEAL_STAGE };
