// ─── Campaign Manager - Concurrent Dialer Engine ──────────────────────────────
const supabase = require('../config/supabase');
const vapiService = require('./vapiService');
const phoneRotation = require('./phoneRotation');
const { v4: uuidv4 } = require('uuid');
const { isWithinTcpaWindow } = require('./tcpaWindow');

// In-memory active campaigns (in production use Redis)
const activeCampaigns = new Map();

const MAX_CONSECUTIVE_FAILURES = 3; // Stop immediately after 3 straight dial rejections

async function start(campaignId, userId) {
  const { data: campaign, error } = await supabase.from('campaigns').select('*').eq('id', campaignId).eq('user_id', userId).single();
  if (error || !campaign) throw new Error('Campaign not found');
  if (['active', 'running'].includes(campaign.status)) throw new Error('Campaign already running');

  // Load operator profile so Alex uses the right voice/name/settings
  const { data: operator } = await supabase.from('users').select('*').eq('id', userId).single();

  // AI provisioning: Starting a campaign IS the trigger to buy numbers. Before the
  // first dial, size the LOCAL calling fleet to this operator's callable-lead volume
  // + geography (plan-capped, per-operator paced) and buy only the shortfall via the
  // uncapped Twilio→Vapi path. Awaited so the first calls go out on real geo-matched
  // numbers. Idempotent (re-start won't re-buy) and never throws - a provisioning
  // failure must never block the campaign; the dialer runs on whatever numbers exist.
  try {
    const { ensureCallingCapacity } = require('./numberProvisioning');
    const provisionResult = await ensureCallingCapacity(userId);
    console.log(`[Campaign ${campaignId}] Pre-dial provisioning:`, provisionResult);
  } catch (provErr) {
    console.error(`[Campaign ${campaignId}] Pre-dial provisioning error (starting anyway):`, provErr.message);
  }

  await supabase.from('campaigns').update({ status: 'active', error_message: null, updated_at: new Date().toISOString() }).eq('id', campaignId);

  const leads = await buildLeadQueue(campaignId, userId, campaign.lead_filter || {});
  await supabase.from('campaigns').update({ total_leads: leads.length }).eq('id', campaignId);

  if (leads.length === 0) {
    await supabase.from('campaigns').update({ status: 'completed', updated_at: new Date().toISOString() }).eq('id', campaignId);
    throw new Error('No eligible leads found for this campaign');
  }

  const session = {
    campaignId,
    userId,
    campaign,
    operator: operator || {},
    leadQueue:          leads,
    activeCalls:        new Map(),
    paused:             false,
    stopped:            false,
    consecutiveFailures: 0,
    interval:           null,
  };
  activeCampaigns.set(campaignId, session);

  const tickMs = Math.max((campaign.call_delay_seconds || 8), 5) * 1000;
  session.interval = setInterval(() => dialerTick(campaignId), tickMs);

  // First tick immediately
  await dialerTick(campaignId);

  return { status: 'started', total_leads: leads.length, concurrent_lines: campaign.concurrent_lines };
}

async function dialerTick(campaignId) {
  const session = activeCampaigns.get(campaignId);
  if (!session || session.stopped || session.paused) return;

  const { campaign, leadQueue, activeCalls, userId, operator } = session;

  if (!isWithinCallingHours(campaign)) {
    console.log(`[Campaign ${campaignId}] Outside calling hours - skipping tick`);
    return;
  }

  // Monthly dial-limit enforcement - pause the campaign when the operator has
  // used their plan's monthly dials. Resets on the 1st of each new month.
  const cap = await checkMonthlyCap(userId);
  if (cap.reached) {
    console.log(`[Campaign ${campaignId}] Monthly dial limit reached (${cap.used}/${cap.limit})`);
    await pauseWithError(campaignId, `Monthly dial limit reached (${cap.limit.toLocaleString()} dials). Upgrade your plan for more.`);
    return;
  }

  if (campaign.daily_spend_limit) {
    const todayCost = (campaign.leads_called || 0) * 0.25;
    if (todayCost >= campaign.daily_spend_limit) {
      console.log(`[Campaign ${campaignId}] Daily spend limit reached`);
      await pauseWithError(campaignId, 'Daily spend limit reached');
      return;
    }
  }

  const slotsAvailable = (campaign.concurrent_lines || 1) - activeCalls.size;
  if (slotsAvailable <= 0 || leadQueue.length === 0) {
    // Auto-stop only when queue is empty AND all active calls finished
    if (leadQueue.length === 0 && activeCalls.size === 0) await stop(campaignId);
    return;
  }

  for (let i = 0; i < slotsAvailable; i++) {
    if (leadQueue.length === 0) break;

    // Check consecutive failure threshold before trying another call
    if (session.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      console.error(`[Campaign ${campaignId}] ${MAX_CONSECUTIVE_FAILURES} consecutive dial failures - pausing to protect leads`);
      await pauseWithError(campaignId, session.lastVapiError || 'Multiple calls were rejected in a row. Check your Twilio account and phone number configuration.');
      return;
    }

    const lead = leadQueue.shift();
    if (!lead) continue;

    try {
      // DNC check (local suppression list)
      const { data: dnc } = await supabase.from('dnc_records').select('id').eq('phone', lead.phone).single();
      if (dnc) {
        await supabase.from('leads').update({ is_on_dnc: true, status: 'dnc' }).eq('id', lead.id);
        session.consecutiveFailures = 0; // DNC skip is not a Vapi failure
        continue;
      }

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
            within_calling_hours: false,
            dnc_result: 'blocked',
            consent_status: 'blocked',
            local_time: 'blocked_federal_dnc: Number is on the FTC National DNC Registry - call blocked',
          }).then(null, () => {});
          session.consecutiveFailures = 0; // DNC skip is not a Vapi failure
          continue;
        }
      } catch (e) {
        console.warn('[Campaign][TCPA] Federal DNC check skipped:', e.message);
      }

      // TCPA quiet-hours - per-lead, in the LEAD's local time (DST-safe). The
      // campaign-level isWithinCallingHours gate above is a coarse "run this tick?"
      // check on the server clock; THIS is the legally-meaningful per-lead floor,
      // so an out-of-region lead is never dialed before 8am / after 9pm its local
      // time even if the campaign window happens to be open on the server.
      if (!isWithinTcpaWindow(lead.property_state)) {
        console.log(`[Campaign ${campaignId}] ${lead.phone} outside 8am–9pm local (${lead.property_state || 'Eastern'}) - requeueing`);
        leadQueue.push(lead);           // back of the queue; retried on a later tick
        session.consecutiveFailures = 0; // a quiet-hours skip is not a Vapi failure
        continue;
      }

      // Phone number selection
      const inUseIds = Array.from(activeCalls.values()).map(c => c.phoneNumberId).filter(Boolean);
      // Derive the lead's area code for local-presence matching (305 lead → 305 number).
      const leadDigits   = String(lead.phone || '').replace(/\D/g, '');
      const leadAreaCode = leadDigits.length === 11 && leadDigits.startsWith('1')
        ? leadDigits.slice(1, 4)
        : (leadDigits.length === 10 ? leadDigits.slice(0, 3) : null);
      const phoneNum = await phoneRotation.selectBestNumber(userId, lead.property_state, inUseIds, leadAreaCode);
      if (!phoneNum) {
        // Distinguish "all numbers momentarily busy/cooling" (transient - wait for
        // next tick) from "operator owns zero callable numbers" (permanent - the
        // pre-dial buy found/bought nothing, so the campaign would silently never
        // call). Only surface the hard-stop when there are no active calls to wait on.
        if (activeCalls.size === 0) {
          const { count: liveLocal } = await supabase
            .from('phone_numbers')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('is_active', true)
            .eq('is_toll_free', false)
            .is('released_at', null);
          if (!liveLocal) {
            leadQueue.unshift(lead);
            await pauseWithError(campaignId, 'No calling numbers available. Auto-provisioning could not buy a local number (check Twilio setup or plan). Add a number in Settings, then resume.');
            return;
          }
        }
        console.log('[Campaign] No healthy numbers available - waiting for next tick');
        leadQueue.unshift(lead); // put lead back, try again next tick
        break;
      }

      // Create call record - campaign_id required for webhook stats to update
      const callId = uuidv4();
      await supabase.from('calls').insert([{
        id: callId,
        user_id: userId,
        campaign_id: campaignId,
        lead_id: lead.id,
        phone_number_id: phoneNum.id,
        status: 'initiated',
        started_at: new Date().toISOString(),
      }]);

      // Stagger concurrent calls
      if (i > 0) await new Promise(r => setTimeout(r, 1500));

      // Initiate Vapi call - pass operator so Alex uses right voice/settings.
      // campaign.use_case (if set) overrides the operator's default use case for
      // this campaign only; otherwise the operator default applies.
      let vapiCall;
      try {
        vapiCall = await vapiService.initiateCall({ lead, phoneNumber: phoneNum, callId, operator, useCaseOverride: campaign.use_case || null, campaign });
      } catch (vapiErr) {
        const errData = vapiErr?.response?.data;
        const baseMsg = errData?.message || errData?.error || vapiErr.message || 'Unknown dial error';
        // Twilio REST errors carry a numeric .code (e.g. 21215 geo-permission,
        // 21606 invalid caller-ID, 21210 unverified from) and a .moreInfo URL.
        // Surface them - the code is the single most useful field for diagnosis.
        const twilioCode = vapiErr?.code || errData?.code || null;
        const msg = twilioCode ? `[Carrier ${twilioCode}] ${baseMsg}` : baseMsg;

        console.error(`[Campaign ${campaignId}] DIAL REJECTED for lead ${lead.id} (${lead.phone}):`, msg);
        console.error(`[Campaign ${campaignId}] Twilio code=${twilioCode} status=${vapiErr?.status || vapiErr?.response?.status} moreInfo=${vapiErr?.moreInfo || ''}`);
        console.error(`[Campaign ${campaignId}] Full error:`, JSON.stringify(errData || { code: twilioCode, message: baseMsg }, null, 2));

        // Mark call as failed
        await supabase.from('calls').update({ status: 'failed', ended_at: new Date().toISOString() }).eq('id', callId);

        // Put lead back - it was never actually called
        leadQueue.unshift(lead);

        session.consecutiveFailures++;
        // NOTE: this is a DIAL error (Twilio), not a Vapi error. Vapi is decommissioned;
        // the catch above traps any outbound-dial failure. Label it accurately so a real
        // Twilio rejection (e.g. "Account not allowed to call") isn't mistaken for Vapi.
        session.lastVapiError = `Dial error: ${msg}`;

        // Bail out of this tick immediately - don't try more leads
        break;
      }

      // Vapi accepted the call - reset failure counter
      session.consecutiveFailures = 0;
      session.lastVapiError = null;

      // Write the sid unconditionally, but only bump status if the row is still
      // 'initiated' - the /status webhook (keyed by callId) may have already
      // written a FRESHER status ('in-progress', even 'no-answer' on fast
      // failures) and this late 'ringing' must not regress it.
      await supabase.from('calls').update({ vapi_call_id: vapiCall.id }).eq('id', callId);
      await supabase.from('calls').update({ status: 'ringing' }).eq('id', callId).eq('status', 'initiated');
      await phoneRotation.recordCallStart(phoneNum.id);

      // Mark lead as being called
      await supabase.from('leads').update({
        call_count: (lead.call_count || 0) + 1,
        last_call_date: new Date().toISOString(),
        status: 'calling',
      }).eq('id', lead.id);

      activeCalls.set(callId, { vapiCallId: vapiCall.id, leadId: lead.id, phoneNumberId: phoneNum.id, startedAt: Date.now() });
      campaign.leads_called = (campaign.leads_called || 0) + 1;

      // Persist counter to DB so campaign card stays accurate
      await supabase.from('campaigns').update({
        leads_called: campaign.leads_called,
        updated_at: new Date().toISOString(),
      }).eq('id', campaignId);

      // Increment the operator's monthly dial counter (atomic via RPC, falls
      // back to read-modify-write). Drives the monthly_dial_limit enforcement.
      supabase.rpc('increment_calls_used', { p_user_id: userId }).then(({ error }) => {
        if (error) {
          supabase.from('users').select('calls_used').eq('id', userId).single()
            .then(({ data }) => supabase.from('users').update({ calls_used: (data?.calls_used || 0) + 1 }).eq('id', userId))
            .then(null, () => {});
        }
      }).catch(() => {});

      pollCallStatus(campaignId, callId);

      console.log(`[Campaign ${campaignId}] ✅ Call initiated → ${lead.first_name} ${lead.last_name} | ${phoneNum.number} → ${lead.phone}`);

    } catch (err) {
      console.error(`[Campaign ${campaignId}] Unexpected error for lead ${lead.id}:`, err.message);
      leadQueue.unshift(lead); // put back and try next tick
      break;
    }
  }
}

// Watches a live call and frees its concurrency slot when it ends.
//
// IMPORTANT: this polls OUR calls row, not Vapi. The old version polled
// vapiService.getCall(sid) - but with the in-house stream engine the id is a
// Twilio CallSid, so Vapi 404'd, .catch() mapped that to "ended", and the slot
// was freed ~5s after dialing while the call was still live. Result: the dialer
// kept filling "free" slots and over-dialed past concurrent_lines. The Twilio
// status webhook (/api/v2/voice/status) writes the terminal status to the row,
// so the row is the engine-agnostic source of truth.
//
// A hard max lifetime guarantees the interval can never leak: even if the
// webhook is lost, the slot frees and the poller exits after CALL_POLL_MAX_MS.
async function pollCallStatus(campaignId, callId) {
  const session = activeCampaigns.get(campaignId);
  if (!session) return;

  const TERMINAL_STATUSES = ['completed', 'ended', 'failed', 'no-answer', 'busy', 'canceled'];
  const MAX_POLL_MS = Number(process.env.CALL_POLL_MAX_MS) || 20 * 60 * 1000;
  const pollStartedAt = Date.now();

  const poll = setInterval(async () => {
    try {
      // Session torn down (stop()) - exit so the interval never outlives it.
      if (session.stopped) { clearInterval(poll); return; }

      const { data: row } = await supabase.from('calls').select('status').eq('id', callId).maybeSingle();
      const timedOut = Date.now() - pollStartedAt > MAX_POLL_MS;
      const isEnded = !row || TERMINAL_STATUSES.includes(row.status) || timedOut;
      if (!isEnded) return;

      clearInterval(poll);
      session.activeCalls.delete(callId);
      if (timedOut) console.warn(`[Campaign ${campaignId}] Call ${callId} poll timed out after ${Math.round(MAX_POLL_MS / 60000)}min - freeing slot`);
      console.log(`[Campaign ${campaignId}] Call finished. Active: ${session.activeCalls.size} | Queue: ${session.leadQueue.length}`);

      // Trigger next batch if queue still has leads
      if (!session.paused && !session.stopped && session.leadQueue.length > 0) {
        dialerTick(campaignId);
      } else if (session.leadQueue.length === 0 && session.activeCalls.size === 0) {
        await stop(campaignId);
      }
    } catch {
      clearInterval(poll);
      session.activeCalls.delete(callId);
    }
  }, 5000);
}

/**
 * Monthly dial-cap check for the campaign dialer.
 * - Resets `calls_used` to 0 on the first tick of a new calendar month
 *   (tracked via `dials_reset_date`, a date column on users).
 * - Only enforces for subscribed operators with a positive monthly_dial_limit;
 *   free/trial users are gated by the per-call route's free-limit logic instead.
 * Fails OPEN on any error (never blocks dialing on a transient DB hiccup).
 */
async function checkMonthlyCap(userId) {
  try {
    const { data: u } = await supabase
      .from('users')
      .select('calls_used, monthly_dial_limit, subscription_status, dials_reset_date, overage_enabled')
      .eq('id', userId)
      .single();
    if (!u) return { reached: false, used: 0, limit: 0 };

    const limit = u.monthly_dial_limit || 0;
    if (u.subscription_status !== 'active' || limit <= 0) {
      return { reached: false, used: u.calls_used || 0, limit };
    }

    // Month rollover - zero the counter on the first tick of a new month.
    const thisMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    const lastMonth = (u.dials_reset_date || '').slice(0, 7);
    if (lastMonth !== thisMonth) {
      const firstOfMonth = `${thisMonth}-01`;
      // New cycle: zero the plan meter, the overage allowance, and the warning marker.
      // Also reset the OUTREACH meter in the same write: zero usage, EXPIRE any
      // unused top-up credits (they do not roll over), clear the fire-once
      // notification flags, un-pause outreach, and stamp the outreach reset marker.
      await supabase.from('users').update({
        calls_used:              0,
        overage_dials_used:      0,
        last_usage_warning_pct:  0,
        dials_reset_date:        firstOfMonth,
        // Outreach meter rollover
        outreach_used:           0,
        topup_credits_available: 0,   // top-ups expire at reset
        topup_purchases_this_cycle: 0,
        topup_spend_this_cycle:  0,
        outreach_paused:         false,
        notified_at_80_percent:  false,
        notified_at_95_percent:  false,
        notified_at_100_percent: false,
        notified_topup_expiry:   false,
        outreach_reset_date:     firstOfMonth,
      }).eq('id', userId);

      // Mark any still-active top-up purchase rows for this operator as expired
      // (audit trail - the live balance is already zeroed above).
      supabase.from('topup_purchases')
        .update({ status: 'expired' })
        .eq('operator_id', userId)
        .eq('status', 'active')
        .then(null, () => {});

      return { reached: false, used: 0, limit };
    }

    const used = u.calls_used || 0;
    // Overage on => never "reached": the campaign keeps dialing into the allowance
    // (over-limit dials are tracked separately by the per-call route).
    return { reached: used >= limit && !u.overage_enabled, used, limit };
  } catch (e) {
    console.warn('[Campaign] checkMonthlyCap failed - allowing dial:', e.message);
    return { reached: false, used: 0, limit: 0 };
  }
}

async function pauseWithError(campaignId, errorMessage) {
  const session = activeCampaigns.get(campaignId);
  if (session) session.paused = true;
  await supabase.from('campaigns').update({
    status: 'paused',
    error_message: errorMessage,
    updated_at: new Date().toISOString(),
  }).eq('id', campaignId);
  console.warn(`[Campaign ${campaignId}] PAUSED - ${errorMessage}`);
}

async function pause(campaignId) {
  const session = activeCampaigns.get(campaignId);
  if (session) {
    session.paused = true;
    // Keep session alive (preserves queue position) but stop the tick timer
    if (session.interval) { clearInterval(session.interval); session.interval = null; }
  }
  await supabase.from('campaigns').update({ status: 'paused', updated_at: new Date().toISOString() }).eq('id', campaignId);
}

async function resume(campaignId) {
  const session = activeCampaigns.get(campaignId);
  if (session) {
    session.paused = false;
    session.stopped = false;
    session.consecutiveFailures = 0;
    session.lastVapiError = null;
    // Restart the tick timer
    const tickMs = Math.max((session.campaign.call_delay_seconds || 8), 5) * 1000;
    if (!session.interval) {
      session.interval = setInterval(() => dialerTick(campaignId), tickMs);
    }
    await dialerTick(campaignId);
  }
  await supabase.from('campaigns').update({ status: 'active', error_message: null, updated_at: new Date().toISOString() }).eq('id', campaignId);
}

async function stop(campaignId) {
  const session = activeCampaigns.get(campaignId);
  if (session) {
    session.stopped = true;
    if (session.interval) clearInterval(session.interval);
    activeCampaigns.delete(campaignId);
  }
  await supabase.from('campaigns').update({ status: 'completed', updated_at: new Date().toISOString() }).eq('id', campaignId);
  console.log(`[Campaign ${campaignId}] Completed`);
}

function isWithinCallingHours(campaign) {
  // Evaluate the operator's window in the LEAD's local time, not the server's.
  // Railway runs in UTC, so the old now.getHours() read UTC: a 09:00–20:00
  // window became 4 AM–3 PM Eastern, so an NC campaign could never dial in the
  // evening. We reuse tcpaWindow's DST-correct per-state clock. The campaign's
  // target state comes from its lead_filter (e.g. NC); unknown → Eastern (the
  // most conservative common zone), matching tcpaWindow's own default.
  const { tcpaLocalHour } = require('./tcpaWindow');
  const stateCode = campaign?.lead_filter?.state || null;
  const now = new Date();
  const hour = tcpaLocalHour(stateCode, now); // 0–23 in the lead's local tz

  // Day-of-week: also resolve in the lead's local tz so a late-night UTC tick
  // doesn't misread the weekday around midnight.
  const tz = require('./tcpaWindow').tzForState(stateCode);
  const localDayName = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now);
  const isSunday = localDayName === 'Sun';

  const [startH] = (campaign.calling_hours_start || '09:00').split(':').map(Number);
  const [endH]   = (campaign.calling_hours_end   || '20:00').split(':').map(Number);

  // Never dial before the federal 8 AM / after 9 PM TCPA quiet hours, even if an
  // operator set a wider window. The operator window can only be NARROWER.
  const effStart = Math.max(startH, 8);
  const effEnd   = Math.min(endH, 21);

  if (isSunday && hour < 12) return false; // no Sunday calls before noon local
  return hour >= effStart && hour < effEnd;
}

async function buildLeadQueue(campaignId, userId, filter = {}) {
  // Exclude leads already successfully called in THIS campaign (avoid re-calling on resume/restart)
  const { data: calledRows } = await supabase
    .from('calls')
    .select('lead_id')
    .eq('campaign_id', campaignId)
    .neq('status', 'failed')   // failed calls are ok to retry
    .not('lead_id', 'is', null);

  const calledLeadIds = [...new Set((calledRows || []).map(r => r.lead_id).filter(Boolean))];

  // Reusable builder so we can apply the exact same filters to every page.
  // Previously this loaded up to 10k leads in ONE query (silent truncation past
  // 10k + a big single allocation). We now page with .range() up to a tunable
  // cap so the queue is bounded and nothing is silently dropped below the cap.
  const PAGE_SIZE  = 1000;
  const LEAD_CAP   = Number(process.env.CAMPAIGN_LEAD_CAP) || 10000;

  const applyFilters = (q) => {
    if (calledLeadIds.length > 0) q = q.not('id', 'in', `(${calledLeadIds.join(',')})`);
    if (filter.state)              q = q.eq('property_state', filter.state);
    if (filter.min_score)          q = q.gte('motivation_score', filter.min_score);
    if (filter.max_score)          q = q.lte('motivation_score', filter.max_score);
    if (filter.source)             q = q.eq('source', filter.source);
    // Operator-selected lead tags - only call leads matching the chosen tags.
    // A lead qualifies if a chosen tag is its primary_tag OR appears in secondary_tags.
    // e.g. filter.tags = ['pre_foreclosure','absentee_owner']. Empty/absent = call all tags.
    if (Array.isArray(filter.tags) && filter.tags.length > 0) {
      // Sanitize tag values (only the [a-z_] chars our tagger produces) to keep the
      // PostgREST .or() filter string safe, then build: primary_tag.in.(...) OR secondary_tags.cs.{tag}
      const safeTags = filter.tags
        .map(t => String(t).toLowerCase().replace(/[^a-z_]/g, ''))
        .filter(Boolean);
      if (safeTags.length > 0) {
        const primaryClause   = `primary_tag.in.(${safeTags.join(',')})`;
        const secondaryClause = safeTags.map(t => `secondary_tags.cs.{${t}}`).join(',');
        q = q.or(`${primaryClause},${secondaryClause}`);
      }
    }
    return q;
  };

  const out = [];
  for (let from = 0; from < LEAD_CAP; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE, LEAD_CAP) - 1;
    let q = supabase.from('leads').select('*').eq('user_id', userId)
      .in('status', ['new', 'contacted']).eq('is_on_dnc', false)
      .order('motivation_score', { ascending: false, nullsFirst: false })
      .range(from, to);
    q = applyFilters(q);
    const { data, error } = await q;
    if (error) { console.warn('[Campaign] buildLeadQueue page failed:', error.message); break; }
    if (!data || data.length === 0) break;     // no more rows
    out.push(...data);
    if (data.length < PAGE_SIZE) break;        // last (partial) page
  }
  return out;
}

/**
 * Boot-time rehydration of active campaigns.
 *
 * The dialer session (activeCampaigns Map + setInterval) lives ONLY in process
 * memory. When Railway restarts the box, every session is wiped but the DB row
 * is still status:'active' - a zombie campaign that dials nothing, leaves no
 * Twilio log, no call rows. Nothing was re-arming it, so the operator saw
 * "active" forever with zero calls. This runs once on server boot: it finds
 * every campaign the DB believes is live and re-arms its in-memory dialer.
 *
 * start() refuses a campaign whose status is already 'active'/'running'
 * (campaignManager.js guard), so we first flip it to 'paused' to clear that
 * guard, then start() flips it back to 'active' and builds a fresh leadQueue
 * (already-called leads are skipped by buildLeadQueue's status filter - no
 * double-dials). Fully self-contained, best-effort, never throws.
 */
async function rehydrateActiveCampaigns() {
  try {
    const { data: rows, error } = await supabase
      .from('campaigns')
      .select('id, user_id, status')
      .in('status', ['active', 'running']);
    if (error) { console.warn('[Campaign] rehydrate query failed:', error.message); return; }
    if (!rows || rows.length === 0) { console.log('[Campaign] rehydrate: no active campaigns to restore'); return; }

    console.log(`[Campaign] rehydrate: restoring ${rows.length} active campaign(s) after restart`);
    for (const row of rows) {
      if (activeCampaigns.has(row.id)) continue; // already live in this process
      try {
        // Clear the "already running" guard so start() will accept it.
        await supabase.from('campaigns').update({ status: 'paused' }).eq('id', row.id);
        await start(row.id, row.user_id);
        console.log(`[Campaign] rehydrate: re-armed dialer for ${row.id}`);
      } catch (e) {
        console.warn(`[Campaign] rehydrate: failed to restore ${row.id}: ${e.message}`);
        // Leave it paused so it's visibly not-dialing rather than a silent zombie.
        await supabase.from('campaigns')
          .update({ status: 'paused', error_message: `Auto-restore failed after restart: ${e.message}` })
          .eq('id', row.id)
          .then(() => {}, () => {});
      }
    }
  } catch (e) {
    console.warn('[Campaign] rehydrate: unexpected error:', e.message);
  }
}

module.exports = { start, pause, resume, stop, activeCampaigns, rehydrateActiveCampaigns };
