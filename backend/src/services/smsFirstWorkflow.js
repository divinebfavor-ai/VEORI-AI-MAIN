/**
 * SMS First Workflow
 *
 * When an operator starts a campaign in SMS First mode:
 *   1. Sends a personalised SMS to every lead immediately
 *   2. Monitors for replies for 48 hours
 *   3. Any lead that replies gets called by Alex within 5 minutes
 *   4. Leads with no reply after 48 hours enter the existing follow-up sequence
 *
 * This file only CALLS existing functions — it does not reimplement them.
 * sendReply()        → smsService.js  (Telnyx send + DNC gate + logging)
 * initiateCall()     → vapiService.js (Vapi call initiation)
 * buildLeadQueue()   → inline (same logic as campaignManager.js)
 */

const { v4: uuidv4 }   = require('uuid');
const supabase          = require('../config/supabase');
const { sendReply }     = require('./smsService');
const vapiService       = require('./vapiService');
const phoneRotation     = require('./phoneRotation');
const queueService      = require('./queueService');
const { isWithinTcpaWindow, msUntilNextWindow, tcpaLocalHour } = require('./tcpaWindow');

// Active SMS-first sessions (in-memory, same pattern as campaignManager)
const activeSessions = new Map();

// ─── TCPA quiet-hours (8am–9pm in the LEAD's local time) ─────────────────────
// Delegates to the shared, DST-safe tcpaWindow service (Intl-based, full 50-state
// map) instead of the old fixed-UTC-offset table, which was wrong for half the
// year under daylight saving. Same call signature so existing call sites are
// unchanged: isWithinSMSHours(state) → boolean.
function isWithinSMSHours(state) {
  return isWithinTcpaWindow(state);
}

// ─── SMS templates by lead type ───────────────────────────────────────────────
function buildSMSBody(lead, operatorName) {
  const first    = lead.first_name  || 'there';
  const street   = (lead.property_address || '').split(',')[0] || 'your property';
  const city     = lead.property_city    || 'your area';
  const address  = lead.property_address || 'your property';
  const county   = lead.county           || 'your county';
  const sender   = operatorName          || 'Alex';

  const type = (
    lead.lead_type     ||
    lead.primary_tag   ||
    (lead.tags || []).find(t => SMS_TYPE_MAP[t]) ||
    'default'
  ).toLowerCase().replace(/[^a-z_]/g, '_');

  const templates = {
    tax_delinquent: `Hey ${first} I noticed the property on ${street} may have some back taxes. I buy properties as-is and can close fast. Would that help your situation at all? - ${sender}`,
    absentee_owner: `Hey ${first} I saw you own a property in ${city} but live out of state. Managing property from a distance can be tough. If you ever considered selling I would love to make it easy. Worth a quick chat? - ${sender}`,
    absentee:       `Hey ${first} I saw you own a property in ${city} but live out of state. Managing property from a distance can be tough. If you ever considered selling I would love to make it easy. Worth a quick chat? - ${sender}`,
    probate:        `Hey ${first} I understand you may have recently inherited property at ${address}. No pressure at all but if selling would simplify things I can make it very straightforward. Would that be helpful? - ${sender}`,
    inherited:      `Hey ${first} I understand you may have recently inherited property at ${address}. No pressure at all but if selling would simplify things I can make it very straightforward. Would that be helpful? - ${sender}`,
    vacant_land:    `Hey ${first} I came across your land parcel in ${county}. Holding vacant land can get expensive with taxes. If you have ever thought about selling I would love to talk. Is that something you are open to? - ${sender}`,
    rural_land:     `Hey ${first} I came across your land parcel in ${county}. Holding vacant land can get expensive with taxes. If you have ever thought about selling I would love to talk. Is that something you are open to? - ${sender}`,
    lis_pendens:    `Hey ${first} I know things can get stressful when facing foreclosure on ${street}. I buy properties fast and can help you avoid that. Would a quick conversation help? - ${sender}`,
    pre_foreclosure:`Hey ${first} I know things can get stressful when facing foreclosure on ${street}. I buy properties fast and can help you avoid that. Would a quick conversation help? - ${sender}`,
    default:        `Hey ${first} I came across your property at ${address} and wanted to reach out directly. I buy properties as-is for cash and can close on your timeline. Is that something worth a quick conversation? - ${sender}`,
  };

  return templates[type] || templates.default;
}

const SMS_TYPE_MAP = {
  tax_delinquent:1, absentee_owner:1, absentee:1, probate:1,
  inherited:1, vacant_land:1, rural_land:1, lis_pendens:1,
  pre_foreclosure:1,
};

// ─── Build lead queue (same logic as campaignManager, not imported to avoid coupling) ─
async function buildLeadQueue(campaignId, userId, filter = {}) {
  const { data: alreadySent } = await supabase
    .from('sms_first_leads')
    .select('lead_id')
    .eq('campaign_id', campaignId);

  const sentIds = (alreadySent || []).map(r => r.lead_id);

  let q = supabase.from('leads').select('*')
    .eq('user_id', userId)
    .in('status', ['new', 'contacted'])
    .eq('is_on_dnc', false)
    .order('motivation_score', { ascending: false, nullsFirst: false })
    .limit(10000);

  if (sentIds.length > 0) q = q.not('id', 'in', `(${sentIds.join(',')})`);
  if (filter.state)        q = q.eq('property_state', filter.state);
  if (filter.min_score)    q = q.gte('motivation_score', filter.min_score);
  if (filter.source)       q = q.eq('source', filter.source);

  const { data } = await q;
  return data || [];
}

// ─── Step 2: Send SMS batch ───────────────────────────────────────────────────
// Two paths, same observable result (sms_first_leads rows monitorReplies can read):
//   • Redis present  → ENQUEUE one SMS_BLAST job per lead. The worker pool drains
//     at SMS_GLOBAL_RATE_MAX with per-number rotation + carrier-safe daily caps,
//     survives restarts, and scales to millions. Rows start 'queued' and the
//     processor flips them to 'sms_sent' on success (so monitorReplies, which reads
//     status='sms_sent', is unchanged). This is the heavy-scale path.
//   • Redis absent   → fall back to the original inline 200ms loop so a single-box /
//     no-Redis deploy still works exactly as before.
// SMS-hours compliance + buildSMSBody are applied in BOTH paths.
async function sendSMSBatch(campaignId, userId, leads, operatorName) {
  return queueService.REDIS_AVAILABLE
    ? enqueueSMSBatch(campaignId, userId, leads, operatorName)
    : inlineSMSBatch(campaignId, userId, leads, operatorName);
}

// Heavy-scale path: create a 'queued' row + enqueue a job per eligible lead.
async function enqueueSMSBatch(campaignId, userId, leads, operatorName) {
  let queued = 0;

  for (const lead of leads) {
    if (!lead.phone) continue;

    // TCPA quiet-hours: we no longer DROP off-hours leads here. Instead we enqueue
    // with a BullMQ delay so the job fires at the next 8am in the lead's local
    // time. (The smsBlastProcessor also gates send-time as a belt-and-suspenders.)
    const offHoursDelay = isWithinSMSHours(lead.property_state)
      ? 0
      : msUntilNextWindow(lead.property_state);

    const body = buildSMSBody(lead, operatorName);
    const rowId = uuidv4();

    // Create the tracking row up front in 'queued' (or 'deferred_quiet_hours' if
    // we're delaying it); the processor flips it to 'sms_sent' (or dnc_blocked /
    // deferred_no_credits) when the job actually runs.
    await supabase.from('sms_first_leads').insert({
      id:          rowId,
      campaign_id: campaignId,
      user_id:     userId,
      lead_id:     lead.id,
      sms_body:    body,
      status:      offHoursDelay > 0 ? 'deferred_quiet_hours' : 'queued',
    }).catch((e) => console.warn('[SMSFirst] queued-row insert failed:', e.message));

    let jobId = null;
    try {
      jobId = await queueService.enqueueSMS({
        leadId:         lead.id,
        campaignId,
        userId,
        to:             lead.phone,
        body,
        smsFirstLeadId: rowId,
        delay:          offHoursDelay,
      });
    } catch (e) {
      console.error(`[SMSFirst] enqueue failed for ${lead.phone}:`, e.message);
    }

    if (jobId) {
      await supabase.from('sms_first_leads')
        .update({ enqueue_job_id: String(jobId) })
        .eq('id', rowId)
        .catch(() => {});
      queued++;
    }
  }

  await supabase.from('campaigns')
    .update({ sms_first_sent: queued, sms_first_status: 'monitoring' })
    .eq('id', campaignId)
    .catch(() => {});

  console.log(`[SMSFirst] Enqueued ${queued} SMS jobs for campaign ${campaignId}`);
  return queued;
}

// Fallback path (no Redis): the original synchronous send loop, unchanged.
async function inlineSMSBatch(campaignId, userId, leads, operatorName) {
  let sent = 0;

  for (const lead of leads) {
    if (!lead.phone) continue;

    // Timezone compliance — skip if outside 8am–9pm local time
    if (!isWithinSMSHours(lead.property_state)) {
      console.log(`[SMSFirst] Skipping ${lead.phone} — outside SMS hours for ${lead.property_state}`);
      continue;
    }

    const body = buildSMSBody(lead, operatorName);

    // sendReply handles DNC gate, Telnyx send, and sms_messages logging
    const msgId = await sendReply(lead.phone, body, userId, lead.id);

    if (msgId === null) {
      // Either DNC blocked or send failed — skip without logging to sms_first_leads
      console.log(`[SMSFirst] Send skipped for ${lead.phone} (DNC or send error)`);
      continue;
    }

    // Log in sms_first_leads
    await supabase.from('sms_first_leads').insert({
      id:          uuidv4(),
      campaign_id: campaignId,
      user_id:     userId,
      lead_id:     lead.id,
      sms_sent_at: new Date().toISOString(),
      sms_body:    body,
      status:      'sms_sent',
    });

    sent++;

    // Stagger sends — 200ms between each to avoid rate limits
    await new Promise(r => setTimeout(r, 200));
  }

  // Update campaign counter
  await supabase.from('campaigns')
    .update({ sms_first_sent: sent, sms_first_status: 'monitoring' })
    .eq('id', campaignId);

  console.log(`[SMSFirst] Sent ${sent} SMS for campaign ${campaignId}`);
  return sent;
}

// ─── Step 3 & 4: Monitor replies + trigger calls ─────────────────────────────
async function monitorReplies(campaignId, userId) {
  const session = activeSessions.get(campaignId);
  if (!session || session.stopped) return;

  try {
    // Find all sms_first_leads that are still waiting for a reply
    const { data: pending } = await supabase
      .from('sms_first_leads')
      .select('*, leads(phone, first_name, last_name, property_state, property_address, property_city, property_zip, motivation_score, call_count, last_call_date, id)')
      .eq('campaign_id', campaignId)
      .eq('status', 'sms_sent')
      .not('sms_sent_at', 'is', null);

    if (!pending?.length) return;

    const now     = Date.now();
    const hours48 = 48 * 60 * 60 * 1000;

    for (const row of pending) {
      const lead      = row.leads;
      if (!lead) continue;

      const sentAt    = new Date(row.sms_sent_at).getTime();
      const elapsed   = now - sentAt;

      // Check if lead has replied by looking at inbound sms_messages since sms was sent
      const { data: replies } = await supabase
        .from('sms_messages')
        .select('body, sent_at')
        .eq('lead_id', row.lead_id)
        .eq('direction', 'inbound')
        .gte('sent_at', row.sms_sent_at)
        .order('sent_at', { ascending: true })
        .limit(1);

      if (replies?.length > 0) {
        const reply = replies[0];

        // Mark as replied in sms_first_leads
        await supabase.from('sms_first_leads')
          .update({ status: 'replied', replied_at: reply.sent_at, reply_body: reply.body })
          .eq('id', row.id);

        // Update campaign reply counter
        await supabase.from('campaigns')
          .update({ sms_first_replies: (session.replyCount = (session.replyCount || 0) + 1) })
          .eq('id', campaignId);

        console.log(`[SMSFirst] Reply detected from ${lead.phone} — queueing call`);

        // Queue for call (within 5 minutes)
        session.callQueue = session.callQueue || [];
        session.callQueue.push({ row, lead });

      } else if (elapsed >= hours48) {
        // 48 hours passed, no reply — enter existing follow-up sequence
        await supabase.from('sms_first_leads')
          .update({ status: 'no_reply' })
          .eq('id', row.id);

        const followUpDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await supabase.from('follow_ups').insert({
          user_id:      userId,
          lead_id:      lead.id,
          type:         'sms',
          scheduled_at: followUpDate.toISOString(),
          status:       'pending',
          notes:        'No reply to SMS First campaign after 48 hours. Auto-scheduled 7-day follow-up.',
          created_at:   new Date().toISOString(),
        }).catch(() => {});

        console.log(`[SMSFirst] No reply after 48h for ${lead.phone} — follow-up scheduled`);
      }
    }

    // Check if all leads are in a terminal state — auto-stop monitoring
    const { data: stillPending } = await supabase
      .from('sms_first_leads')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('status', 'sms_sent');

    if ((stillPending?.count || 0) === 0) {
      await finishMonitoring(campaignId);
    }

  } catch (err) {
    console.error(`[SMSFirst] Monitor error for campaign ${campaignId}:`, err.message);
  }
}

async function triggerPendingCalls(campaignId, userId, campaign) {
  const session = activeSessions.get(campaignId);
  if (!session || !session.callQueue?.length) return;

  const { data: operator } = await supabase
    .from('users').select('*').eq('id', userId).single();

  while (session.callQueue.length > 0) {
    const { row, lead } = session.callQueue.shift();

    // Skip if already called
    if (row.call_triggered) continue;

    // TCPA quiet-hours: a call must be inside 8am–9pm in the LEAD's local time.
    // (DST-safe, full 50-state map via tcpaWindow — the old `new Date().getHours()`
    // used the SERVER's timezone, which is wrong for out-of-region leads.)
    if (!isWithinTcpaWindow(lead.property_state)) {
      session.callQueue.push({ row, lead });
      break;
    }

    // Additionally respect the operator's configured calling window (in the lead's
    // local time so the campaign hours mean what the operator expects per-lead).
    const localHour = tcpaLocalHour(lead.property_state);
    const [startH] = (campaign.calling_hours_start || '09:00').split(':').map(Number);
    const [endH]   = (campaign.calling_hours_end   || '20:00').split(':').map(Number);
    if (localHour < startH || localHour >= endH) {
      // Outside the operator's window — put back and check next tick
      session.callQueue.push({ row, lead });
      break;
    }

    try {
      // Federal DNC check (FTC National Registry). Fails OPEN until FTC_DNC_API_KEY
      // is configured, so this never blocks calls before the operator signs up.
      try {
        const { isOnFederalDnc } = require('./ftcDncService');
        const fed = await isOnFederalDnc(lead.phone);
        if (fed.checked && fed.onList) {
          await supabase.from('leads').update({ is_on_dnc: true, status: 'dnc' }).eq('id', lead.id);
          await supabase.from('tcpa_log').insert({
            user_id: userId,
            lead_id: lead.id,
            phone_number: lead.phone || '',
            called_at_utc: new Date().toISOString(),
            within_calling_hours: true,
            dnc_result: 'blocked',
            consent_status: 'blocked',
            local_time: 'blocked_federal_dnc: Number is on the FTC National DNC Registry — call blocked',
          }).catch(() => {});
          continue; // skip this lead's escalation call
        }
      } catch (e) {
        console.warn('[SMSFirst][TCPA] Federal DNC check skipped:', e.message);
      }

      // Derive the lead's area code for local-presence matching (305 lead → 305 number).
      const leadDigits   = String(lead.phone || '').replace(/\D/g, '');
      const leadAreaCode = leadDigits.length === 11 && leadDigits.startsWith('1')
        ? leadDigits.slice(1, 4)
        : (leadDigits.length === 10 ? leadDigits.slice(0, 3) : null);
      const phoneNum = await phoneRotation.selectBestNumber(userId, lead.property_state, [], leadAreaCode);
      if (!phoneNum) {
        console.warn('[SMSFirst] No healthy phone numbers available for call');
        session.callQueue.push({ row, lead }); // retry next tick
        break;
      }

      const callId = uuidv4();
      await supabase.from('calls').insert([{
        id:              callId,
        user_id:         userId,
        campaign_id:     campaignId,
        lead_id:         lead.id,
        phone_number_id: phoneNum.id,
        status:          'initiated',
        started_at:      new Date().toISOString(),
        triggered_by:    'sms_first_reply',
      }]);

      const vapiCall = await vapiService.initiateCall({ lead, phoneNumber: phoneNum, callId, operator: operator || {} });

      await supabase.from('calls').update({ vapi_call_id: vapiCall.id, status: 'ringing' }).eq('id', callId);

      // Mark as called in sms_first_leads
      await supabase.from('sms_first_leads')
        .update({ status: 'called', called_at: new Date().toISOString(), call_triggered: true })
        .eq('id', row.id);

      await supabase.from('leads').update({
        call_count:     (lead.call_count || 0) + 1,
        last_call_date: new Date().toISOString(),
        status:         'calling',
      }).eq('id', lead.id);

      await supabase.from('campaigns')
        .update({ sms_first_called: (session.callCount = (session.callCount || 0) + 1) })
        .eq('id', campaignId);

      await phoneRotation.recordCallStart(phoneNum.id);

      console.log(`[SMSFirst] ✅ Called ${lead.first_name} ${lead.last_name} (${lead.phone}) after SMS reply`);

    } catch (err) {
      console.error(`[SMSFirst] Call trigger failed for lead ${lead.id}:`, err.message);
    }

    // Stagger calls
    await new Promise(r => setTimeout(r, 2000));
  }
}

async function finishMonitoring(campaignId) {
  const session = activeSessions.get(campaignId);
  if (session) {
    session.stopped = true;
    if (session.monitorInterval) clearInterval(session.monitorInterval);
    if (session.callInterval)    clearInterval(session.callInterval);
    activeSessions.delete(campaignId);
  }
  await supabase.from('campaigns')
    .update({ sms_first_status: 'completed', status: 'completed', updated_at: new Date().toISOString() })
    .eq('id', campaignId);
  console.log(`[SMSFirst] Campaign ${campaignId} monitoring complete`);
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function start(campaignId, userId) {
  const { data: campaign } = await supabase
    .from('campaigns').select('*').eq('id', campaignId).eq('user_id', userId).single();

  if (!campaign) throw new Error('Campaign not found');
  if (activeSessions.has(campaignId)) throw new Error('SMS First already running for this campaign');

  const { data: operator } = await supabase
    .from('users').select('ai_caller_name, full_name').eq('id', userId).single();
  const operatorName = operator?.ai_caller_name || operator?.full_name || 'Alex';

  await supabase.from('campaigns').update({
    sms_first_mode:   true,
    sms_first_status: 'sending',
    status:           'active',
    updated_at:       new Date().toISOString(),
  }).eq('id', campaignId);

  const leads = await buildLeadQueue(campaignId, userId, campaign.lead_filter || {});

  if (leads.length === 0) {
    await supabase.from('campaigns').update({ status: 'completed', sms_first_status: 'completed' }).eq('id', campaignId);
    throw new Error('No eligible leads found for this campaign');
  }

  const session = {
    campaignId,
    userId,
    campaign,
    operatorName,
    replyCount:       0,
    callCount:        0,
    callQueue:        [],
    stopped:          false,
    monitorInterval:  null,
    callInterval:     null,
  };
  activeSessions.set(campaignId, session);

  // Send SMS batch (async — don't block the API response)
  sendSMSBatch(campaignId, userId, leads, operatorName).catch(err =>
    console.error('[SMSFirst] SMS batch error:', err.message)
  );

  // Monitor replies every 2 minutes
  session.monitorInterval = setInterval(() => monitorReplies(campaignId, userId), 2 * 60 * 1000);

  // Trigger pending calls every 60 seconds
  session.callInterval = setInterval(() => triggerPendingCalls(campaignId, userId, campaign), 60 * 1000);

  console.log(`[SMSFirst] Started for campaign ${campaignId} — ${leads.length} leads`);
  return { status: 'started', total_leads: leads.length, operator_name: operatorName };
}

async function stop(campaignId) {
  await finishMonitoring(campaignId);
}

async function getStatus(campaignId) {
  const { data } = await supabase
    .from('campaigns')
    .select('sms_first_status, sms_first_sent, sms_first_replies, sms_first_called')
    .eq('id', campaignId)
    .single();
  return data;
}

module.exports = { start, stop, getStatus, activeSessions };
