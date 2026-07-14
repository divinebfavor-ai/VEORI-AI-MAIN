/**
 * SMS First Workflow
 *
 * When an operator starts a campaign in SMS First mode:
 *   1. Sends a personalised SMS to every lead immediately
 *   2. Monitors for replies for 48 hours
 *   3. Any lead that replies gets called by Alex within 5 minutes
 *   4. Leads with no reply after 48 hours enter the existing follow-up sequence
 *
 * This file only CALLS existing functions - it does not reimplement them.
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

// ─── Multi-touch blast cadence ────────────────────────────────────────────────
// The operator chooses how many times to text a NON-responder (1× / 2× / 3×).
// Touch 1 is the initial blast (Day 1). Touches 2-3 are re-sends to leads who
// still haven't replied, scheduled on the Day 1 / Day 3 / Day 7 cadence (offsets
// from the initial send). The moment a lead replies, the reply branch marks them
// 'replied' and they leave the re-blast loop, so a responder is never re-texted.
// Clamp keeps it inside the 1-3 the UI offers.
const MAX_BLAST_TOUCHES = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
// Day offset of each touch from campaign start. Day 1 / Day 3 / Day 7 by default;
// overridable via SMS_BLAST_DAY_OFFSETS="1,3,7". The gap BEFORE touch N is therefore
// OFFSETS[N-1] - OFFSETS[N-2] days (2 days before touch 2, 4 days before touch 3).
const BLAST_DAY_OFFSETS = (process.env.SMS_BLAST_DAY_OFFSETS || '1,3,7')
  .split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n >= 0);
// Required wait since the last touch before sending touch (touchCount+1). touchCount is
// 1-indexed (touches already sent); OFFSETS is 0-indexed (OFFSETS[0] = touch 1).
function blastGapMs(touchCount) {
  const cur = BLAST_DAY_OFFSETS[touchCount];       // offset of the touch we're about to send
  const prev = BLAST_DAY_OFFSETS[touchCount - 1];  // offset of the last touch sent
  if (cur == null || prev == null) return 3 * DAY_MS; // safety fallback
  return Math.max(0, cur - prev) * DAY_MS;
}
function clampBlastCount(n) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v < 1) return 1;
  return Math.min(v, MAX_BLAST_TOUCHES);
}

// ─── TCPA quiet-hours (8am–9pm in the LEAD's local time) ─────────────────────
// Delegates to the shared, DST-safe tcpaWindow service (Intl-based, full 50-state
// map) instead of the old fixed-UTC-offset table, which was wrong for half the
// year under daylight saving. Same call signature so existing call sites are
// unchanged: isWithinSMSHours(state) → boolean.
function isWithinSMSHours(state) {
  return isWithinTcpaWindow(state);
}

// ─── SMS templates by lead type ───────────────────────────────────────────────
// `customTemplate` (optional) - an operator-authored template body with {tokens}.
// When provided, it REPLACES the built-in per-tag copy: we render its placeholders
// for this lead and return that. When omitted/empty (every existing caller), behavior
// is byte-for-byte the original built-in template selection below - zero regression.
function buildSMSBody(lead, operatorName, customTemplate = null) {
  if (customTemplate && String(customTemplate).trim()) {
    try {
      const { renderTemplate } = require('./customSmsService');
      return renderTemplate(customTemplate, lead, operatorName);
    } catch (_) { /* fall through to built-in copy on any render failure */ }
  }

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

  // WHAMMY 1 - the opener text is a pure CURIOSITY QUESTION, not a pitch.
  // No "buy"/"cash"/"as-is" trigger words (those read as wholesaler spam, get
  // ignored, and poison toll-free deliverability). A short yes/no question the
  // owner can answer in one tap maximizes reply rate; once they reply, the
  // existing AI reply engine (smsInboundProcessor → scoreReply / continueConversation
  // / escalateToCall) delivers WHAMMY 2 (the actual value/pitch). So the templates
  // below carry ZERO pitch on purpose.
  //
  // COPY STRUCTURE - "tight base + warm A/B":
  //   The top-level {TIGHT | WARM} group makes spin() flip a coin per lead between
  //   a TERSE opener (lowest friction, fastest tap-to-reply) and a WARMER, slightly
  //   more human one. Because the branch is seeded by lead.id, the split is a live,
  //   even A/B test across the whole blast - half your list gets each, and the reply
  //   rates tell you which voice your market answers. Inner {a|b} groups still vary
  //   wording within each arm so a 10k send is never byte-identical (carriers bulk-
  //   filter fingerprinted blasts).
  //
  // WRONG-NUMBER TAIL ({Wrong number|My bad} if not): the single biggest reply-rate
  // lever on a cold list. People who AREN'T the owner now have a reason to write back
  // ("wrong #") - and a correction is still a reply that warms the thread / cleans the
  // list. It also reads as polite and human, not like a blast.
  const tail = `{Wrong number|My bad|No worries} if not.`;
  // NOTE on the signature: each arm names the sender EXACTLY ONCE. The TIGHT arm is
  // unsigned mid-sentence and carries the trailing "- ${sender}". The WARM arm says
  // "${sender} here" / "this is ${sender}" inline and ends at the tail - no double-sign.
  const templates = {
    tax_delinquent: `{${first}? You still own ${street}? ${tail} - ${sender}|{Hey|Hi} ${first}, ${sender} here. Quick one - is ${street} still yours? ${tail}}`,
    absentee_owner: `{${first}? Still own the place in ${city}? ${tail} - ${sender}|{Hey|Hi} ${first}, this is ${sender}. Do you still own the property in ${city}? ${tail}}`,
    absentee:       `{${first}? Still own the place in ${city}? ${tail} - ${sender}|{Hey|Hi} ${first}, this is ${sender}. Do you still own the property in ${city}? ${tail}}`,
    probate:        `{${first}? Right person to ask about ${street}? ${tail} - ${sender}|{Hi|Hey} ${first}, ${sender} here. Are you the one to ask about the property on ${street}? ${tail}}`,
    inherited:      `{${first}? Right person to ask about ${street}? ${tail} - ${sender}|{Hi|Hey} ${first}, ${sender} here. Are you the one to ask about the property on ${street}? ${tail}}`,
    vacant_land:    `{${first}? Still own that parcel in ${county}? ${tail} - ${sender}|{Hey|Hi} ${first}, this is ${sender}. Do you still own the land in ${county}? ${tail}}`,
    rural_land:     `{${first}? Still own that parcel in ${county}? ${tail} - ${sender}|{Hey|Hi} ${first}, this is ${sender}. Do you still own the land in ${county}? ${tail}}`,
    lis_pendens:    `{${first}? Still the owner at ${street}? ${tail} - ${sender}|{Hi|Hey} ${first}, ${sender} here. Are you still the owner over at ${street}? ${tail}}`,
    pre_foreclosure:`{${first}? Still the owner at ${street}? ${tail} - ${sender}|{Hi|Hey} ${first}, ${sender} here. Are you still the owner over at ${street}? ${tail}}`,
    default:        `{${first}? Is ${street} still yours? ${tail} - ${sender}|{Hey|Hi} ${first}, this is ${sender}. Is the place on ${street} still yours? ${tail}}`,
  };

  const chosen = templates[type] || templates.default;

  // Resolve spintax per-lead. Seed by lead.id so retries/resends pick the SAME
  // branch (idempotent); fall back to phone/name if id is missing - still
  // deterministic. spin() returns any string with no {a|b} group unchanged.
  try {
    const { spin } = require('./emailSpintax');
    return spin(chosen, lead.id || lead.phone || first);
  } catch (_) {
    // If the spintax helper is somehow unavailable, take the FIRST branch of each
    // group rather than ever leaking literal {a|b} braces to a recipient.
    return chosen.replace(/\{([^{}]*\|[^{}]*)\}/g, (_m, g) => g.split('|')[0]);
  }
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
async function sendSMSBatch(campaignId, userId, leads, operatorName, customBody = null) {
  return queueService.REDIS_AVAILABLE
    ? enqueueSMSBatch(campaignId, userId, leads, operatorName, customBody)
    : inlineSMSBatch(campaignId, userId, leads, operatorName, customBody);
}

// Heavy-scale path: create a 'queued' row + enqueue a job per eligible lead.
async function enqueueSMSBatch(campaignId, userId, leads, operatorName, customBody = null) {
  let queued = 0;

  for (const lead of leads) {
    if (!lead.phone) continue;

    // TCPA quiet-hours: we no longer DROP off-hours leads here. Instead we enqueue
    // with a BullMQ delay so the job fires at the next 8am in the lead's local
    // time. (The smsBlastProcessor also gates send-time as a belt-and-suspenders.)
    const offHoursDelay = isWithinSMSHours(lead.property_state)
      ? 0
      : msUntilNextWindow(lead.property_state);

    const body = buildSMSBody(lead, operatorName, customBody);
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
      touch_count: 1,                         // 1st of up-to-3 blast touches (2026-06-30 col; tolerated if absent)
    }).catch(() => supabase.from('sms_first_leads').insert({
      // Retry without the cadence column if the migration hasn't run yet.
      id:          rowId,
      campaign_id: campaignId,
      user_id:     userId,
      lead_id:     lead.id,
      sms_body:    body,
      status:      offHoursDelay > 0 ? 'deferred_quiet_hours' : 'queued',
    }).then(null, (e) => console.warn('[SMSFirst] queued-row insert failed:', e.message)));

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
        .then(null, () => {});
      queued++;
    }
  }

  await supabase.from('campaigns')
    .update({ sms_first_sent: queued, sms_first_status: 'monitoring' })
    .eq('id', campaignId)
    .then(null, () => {});

  console.log(`[SMSFirst] Enqueued ${queued} SMS jobs for campaign ${campaignId}`);
  return queued;
}

// Fallback path (no Redis): the original synchronous send loop, unchanged.
async function inlineSMSBatch(campaignId, userId, leads, operatorName, customBody = null) {
  let sent = 0;

  for (const lead of leads) {
    if (!lead.phone) continue;

    // Timezone compliance - skip if outside 8am–9pm local time
    if (!isWithinSMSHours(lead.property_state)) {
      console.log(`[SMSFirst] Skipping ${lead.phone} - outside SMS hours for ${lead.property_state}`);
      continue;
    }

    const body = buildSMSBody(lead, operatorName, customBody);

    // sendReply handles DNC gate, Telnyx send, and sms_messages logging
    const msgId = await sendReply(lead.phone, body, userId, lead.id);

    if (msgId === null) {
      // Either DNC blocked or send failed - skip without logging to sms_first_leads
      console.log(`[SMSFirst] Send skipped for ${lead.phone} (DNC or send error)`);
      continue;
    }

    // Log in sms_first_leads
    const nowIso = new Date().toISOString();
    await supabase.from('sms_first_leads').insert({
      id:            uuidv4(),
      campaign_id:   campaignId,
      user_id:       userId,
      lead_id:       lead.id,
      sms_sent_at:   nowIso,
      sms_body:      body,
      status:        'sms_sent',
      touch_count:   1,                       // 1st of up-to-3 blast touches (2026-06-30 col)
      last_touch_at: nowIso,
    }).then(null, () => supabase.from('sms_first_leads').insert({
      // Retry without cadence columns if the migration hasn't run yet.
      id:          uuidv4(),
      campaign_id: campaignId,
      user_id:     userId,
      lead_id:     lead.id,
      sms_sent_at: nowIso,
      sms_body:    body,
      status:      'sms_sent',
    }));

    sent++;

    // Stagger sends - 200ms between each to avoid rate limits
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

        // Reply auto-stop: cancel any still-pending SMS follow-up for this lead so a
        // lead who replied is never re-touched as a "no reply" (a prior tick may have
        // queued the 48h/7-day row before this reply landed). Idempotent no-op when clean.
        await supabase.from('follow_ups')
          .update({ status: 'cancelled', notes: 'Auto-cancelled - lead replied via SMS.' })
          .eq('lead_id', row.lead_id)
          .eq('type', 'sms')
          .eq('status', 'pending')
          .then(null, () => {});

        // Update campaign reply counter
        await supabase.from('campaigns')
          .update({ sms_first_replies: (session.replyCount = (session.replyCount || 0) + 1) })
          .eq('id', campaignId);

        console.log(`[SMSFirst] Reply detected from ${lead.phone} - queueing call`);

        // Queue for call (within 5 minutes)
        session.callQueue = session.callQueue || [];
        session.callQueue.push({ row, lead });

      } else {
        // ── No reply yet - multi-touch blast cadence ──────────────────────────
        // Operator chose 1× / 2× / 3× touches for non-responders. Touch 1 was the
        // initial blast (Day 1); touches 2-3 fire on the Day 3 / Day 7 cadence
        // (per-touch gap from blastGapMs: 2 days before touch 2, 4 before touch 3).
        // We only re-blast a lead who STILL hasn't replied (this branch == no reply
        // found above), so a responder is never re-texted. When the lead has had
        // all their touches and still no reply, fall through to the original
        // 48h→7-day follow-up so existing behavior is preserved for the last touch.
        const blastCount   = session.blastCount || 1;
        const touchCount   = row.touch_count || 1;     // null pre-migration → treat as 1
        const lastTouchAt  = row.last_touch_at ? new Date(row.last_touch_at).getTime() : sentAt;
        const sinceTouch   = now - lastTouchAt;

        if (touchCount < blastCount && sinceTouch >= blastGapMs(touchCount)) {
          // Re-send the opener as the next touch. Reuse buildSMSBody so the copy is
          // identical to the initial blast (custom template included); sendReply
          // applies the DNC gate + logs to sms_messages exactly like the first send.
          const body  = buildSMSBody(lead, session.operatorName, session.customBody);

          // Respect TCPA quiet-hours - if it's off-hours in the lead's state, skip
          // this tick and try again on the next 2-min poll (no touch consumed).
          if (!isWithinSMSHours(lead.property_state)) continue;

          const msgId = await sendReply(lead.phone, body, userId, lead.id);
          if (msgId === null) continue;  // DNC/send error - don't consume a touch

          const touchNowIso = new Date().toISOString();
          await supabase.from('sms_first_leads')
            .update({ touch_count: touchCount + 1, last_touch_at: touchNowIso, sms_sent_at: touchNowIso })
            .eq('id', row.id)
            .then(null, () => {
              // Pre-migration: cadence cols absent - just refresh sms_sent_at so the
              // 48h fallback below still measures from the latest send.
              return supabase.from('sms_first_leads')
                .update({ sms_sent_at: touchNowIso })
                .eq('id', row.id);
            });

          console.log(`[SMSFirst] Re-blast touch ${touchCount + 1}/${blastCount} sent to ${lead.phone}`);

        } else if (elapsed >= hours48) {
          // Final touch reached (or 1× cadence) and 48h passed with no reply -
          // enter the original follow-up sequence, unchanged.
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
            notes:        'No reply to SMS First campaign after all blast touches. Auto-scheduled 7-day follow-up.',
            created_at:   new Date().toISOString(),
          }).then(null, () => {});

          console.log(`[SMSFirst] No reply after ${blastCount} touch(es) for ${lead.phone} - follow-up scheduled`);
        }
      }
    }

    // Check if all leads are in a terminal state - auto-stop monitoring
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
    // (DST-safe, full 50-state map via tcpaWindow - the old `new Date().getHours()`
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
      // Outside the operator's window - put back and check next tick
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
            local_time: 'blocked_federal_dnc: Number is on the FTC National DNC Registry - call blocked',
          }).then(null, () => {});
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

async function start(campaignId, userId, options = {}) {
  const { data: campaign } = await supabase
    .from('campaigns').select('*').eq('id', campaignId).eq('user_id', userId).single();

  if (!campaign) throw new Error('Campaign not found');
  if (activeSessions.has(campaignId)) throw new Error('SMS First already running for this campaign');

  const { data: operator } = await supabase
    .from('users').select('ai_caller_name, full_name').eq('id', userId).single();
  const operatorName = operator?.ai_caller_name || operator?.full_name || 'Alex';

  // How many total touches a non-responder gets (1× / 2× / 3×). Operator-chosen,
  // falls back to any value already persisted on the campaign, then 1 (= today's
  // single-blast behavior). Clamped to 1-3.
  const blastCount = clampBlastCount(
    options.blastCount ?? campaign.sms_blast_count ?? 1,
  );

  // Optional operator-authored custom SMS copy for THIS blast. Resolution order:
  //   1. options.customBody - raw text passed straight in by the caller, or
  //   2. options.templateId / campaign.custom_sms_template_id - a saved, already-
  //      moderated sms_templates row owned by this operator.
  // Null = no custom template → every send path falls back to the built-in per-tag
  // copy (byte-for-byte today's behavior). The body is rendered per-lead at send
  // time via buildSMSBody's customTemplate arg, so {tokens} personalize per lead.
  let customBody = options.customBody || null;
  if (!customBody) {
    const templateId = options.templateId || campaign.custom_sms_template_id || null;
    if (templateId) {
      const { data: tpl } = await supabase
        .from('sms_templates')
        .select('body, is_active, moderation_status')
        .eq('id', templateId)
        .eq('user_id', userId)            // operator can only use their OWN templates
        .single();
      // Only use a template that is this operator's, active, and guard-approved.
      if (tpl && tpl.is_active !== false && tpl.moderation_status !== 'rejected') {
        customBody = tpl.body || null;
      } else {
        console.warn(`[SMSFirst] template ${templateId} not usable (missing/inactive/rejected) - using built-in copy`);
      }
    }
  }

  await supabase.from('campaigns').update({
    sms_first_mode:   true,
    sms_first_status: 'sending',
    sms_blast_count:  blastCount,   // Phase: 2026-06-30 column (additive; tolerated if absent pre-migration)
    status:           'active',
    updated_at:       new Date().toISOString(),
  }).eq('id', campaignId).then(null, () => {
    // If sms_blast_count column doesn't exist yet (migration not run), retry
    // without it so the campaign still starts - cadence then defaults to 1×.
    return supabase.from('campaigns').update({
      sms_first_mode:   true,
      sms_first_status: 'sending',
      status:           'active',
      updated_at:       new Date().toISOString(),
    }).eq('id', campaignId);
  });

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
    blastCount,                 // 1× / 2× / 3× - total touches a non-responder gets
    customBody,                 // operator custom SMS copy for this blast (null = built-in)
    replyCount:       0,
    callCount:        0,
    callQueue:        [],
    stopped:          false,
    monitorInterval:  null,
    callInterval:     null,
  };
  activeSessions.set(campaignId, session);

  // Send SMS batch (async - don't block the API response)
  sendSMSBatch(campaignId, userId, leads, operatorName, customBody).catch(err =>
    console.error('[SMSFirst] SMS batch error:', err.message)
  );

  // Monitor replies every 2 minutes
  session.monitorInterval = setInterval(() => monitorReplies(campaignId, userId), 2 * 60 * 1000);

  // Trigger pending calls every 60 seconds
  session.callInterval = setInterval(() => triggerPendingCalls(campaignId, userId, campaign), 60 * 1000);

  console.log(`[SMSFirst] Started for campaign ${campaignId} - ${leads.length} leads`);
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
