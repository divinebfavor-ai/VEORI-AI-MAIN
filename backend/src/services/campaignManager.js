// ─── Campaign Manager — Concurrent Dialer Engine ──────────────────────────────
const supabase = require('../config/supabase');
const vapiService = require('./vapiService');
const phoneRotation = require('./phoneRotation');
const { v4: uuidv4 } = require('uuid');

// In-memory active campaigns (in production use Redis)
const activeCampaigns = new Map();

const MAX_CONSECUTIVE_FAILURES = 3; // Stop immediately after 3 straight Vapi rejections

async function start(campaignId, userId) {
  const { data: campaign, error } = await supabase.from('campaigns').select('*').eq('id', campaignId).eq('user_id', userId).single();
  if (error || !campaign) throw new Error('Campaign not found');
  if (['active', 'running'].includes(campaign.status)) throw new Error('Campaign already running');

  // Load operator profile so Alex uses the right voice/name/settings
  const { data: operator } = await supabase.from('users').select('*').eq('id', userId).single();

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
    console.log(`[Campaign ${campaignId}] Outside calling hours — skipping tick`);
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
      console.error(`[Campaign ${campaignId}] ${MAX_CONSECUTIVE_FAILURES} consecutive Vapi failures — pausing to protect leads`);
      await pauseWithError(campaignId, session.lastVapiError || 'Vapi rejected multiple calls in a row. Check your Vapi account limits and phone number configuration.');
      return;
    }

    const lead = leadQueue.shift();
    if (!lead) continue;

    try {
      // DNC check
      const { data: dnc } = await supabase.from('dnc_records').select('id').eq('phone', lead.phone).single();
      if (dnc) {
        await supabase.from('leads').update({ is_on_dnc: true, status: 'dnc' }).eq('id', lead.id);
        session.consecutiveFailures = 0; // DNC skip is not a Vapi failure
        continue;
      }

      // Phone number selection
      const inUseIds = Array.from(activeCalls.values()).map(c => c.phoneNumberId).filter(Boolean);
      const phoneNum = await phoneRotation.selectBestNumber(userId, lead.property_state, inUseIds);
      if (!phoneNum) {
        console.log('[Campaign] No healthy numbers available — waiting for next tick');
        leadQueue.unshift(lead); // put lead back, try again next tick
        break;
      }

      // Create call record — campaign_id required for webhook stats to update
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

      // Initiate Vapi call — pass operator so Alex uses right voice/settings
      let vapiCall;
      try {
        vapiCall = await vapiService.initiateCall({ lead, phoneNumber: phoneNum, callId, operator });
      } catch (vapiErr) {
        const errData = vapiErr?.response?.data;
        const msg = errData?.message || errData?.error || vapiErr.message || 'Unknown Vapi error';

        console.error(`[Campaign ${campaignId}] Vapi REJECTED call for lead ${lead.id} (${lead.phone}):`, msg);
        console.error(`[Campaign ${campaignId}] Vapi response status: ${vapiErr?.response?.status}`);
        console.error(`[Campaign ${campaignId}] Full error:`, JSON.stringify(errData || {}, null, 2));

        // Mark call as failed
        await supabase.from('calls').update({ status: 'failed', ended_at: new Date().toISOString() }).eq('id', callId);

        // Put lead back — it was never actually called
        leadQueue.unshift(lead);

        session.consecutiveFailures++;
        session.lastVapiError = `Vapi error: ${msg}`;

        // Bail out of this tick immediately — don't try more leads
        break;
      }

      // Vapi accepted the call — reset failure counter
      session.consecutiveFailures = 0;
      session.lastVapiError = null;

      await supabase.from('calls').update({ vapi_call_id: vapiCall.id, status: 'ringing' }).eq('id', callId);
      await phoneRotation.recordCallStart(phoneNum.id);

      // Mark lead as being called
      await supabase.from('leads').update({
        call_count: (lead.call_count || 0) + 1,
        last_call_date: new Date().toISOString(),
        status: 'calling',
      }).eq('id', lead.id);

      activeCalls.set(callId, { vapiCallId: vapiCall.id, leadId: lead.id, phoneNumberId: phoneNum.id, startedAt: Date.now() });
      campaign.leads_called = (campaign.leads_called || 0) + 1;

      pollCallStatus(campaignId, callId, vapiCall.id);

      console.log(`[Campaign ${campaignId}] ✅ Call initiated → ${lead.first_name} ${lead.last_name} | ${phoneNum.number} → ${lead.phone}`);

    } catch (err) {
      console.error(`[Campaign ${campaignId}] Unexpected error for lead ${lead.id}:`, err.message);
      leadQueue.unshift(lead); // put back and try next tick
      break;
    }
  }
}

async function pollCallStatus(campaignId, callId, vapiCallId) {
  const session = activeCampaigns.get(campaignId);
  if (!session) return;

  const poll = setInterval(async () => {
    try {
      const call = await vapiService.getCall(vapiCallId).catch(() => null);
      const isEnded = !call || call.status === 'ended' || call.status === 'failed';
      if (isEnded) {
        clearInterval(poll);
        session.activeCalls.delete(callId);
        console.log(`[Campaign ${campaignId}] Call finished. Active: ${session.activeCalls.size} | Queue: ${session.leadQueue.length}`);

        // Trigger next batch if queue still has leads
        if (!session.paused && !session.stopped && session.leadQueue.length > 0) {
          dialerTick(campaignId);
        } else if (session.leadQueue.length === 0 && session.activeCalls.size === 0) {
          await stop(campaignId);
        }
      }
    } catch {
      clearInterval(poll);
      session.activeCalls.delete(callId);
    }
  }, 5000);
}

async function pauseWithError(campaignId, errorMessage) {
  const session = activeCampaigns.get(campaignId);
  if (session) session.paused = true;
  await supabase.from('campaigns').update({
    status: 'paused',
    error_message: errorMessage,
    updated_at: new Date().toISOString(),
  }).eq('id', campaignId);
  console.warn(`[Campaign ${campaignId}] PAUSED — ${errorMessage}`);
}

async function pause(campaignId) {
  const session = activeCampaigns.get(campaignId);
  if (session) session.paused = true;
  await supabase.from('campaigns').update({ status: 'paused', updated_at: new Date().toISOString() }).eq('id', campaignId);
}

async function resume(campaignId) {
  const session = activeCampaigns.get(campaignId);
  if (session) {
    session.paused = false;
    session.consecutiveFailures = 0;
    session.lastVapiError = null;
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
  const now = new Date();
  const hour = now.getHours();
  const [startH] = (campaign.calling_hours_start || '09:00').split(':').map(Number);
  const [endH]   = (campaign.calling_hours_end   || '20:00').split(':').map(Number);
  const day = now.getDay();
  if (day === 0 && hour < 12) return false;
  return hour >= startH && hour < endH;
}

async function buildLeadQueue(campaignId, userId, filter = {}) {
  let q = supabase.from('leads').select('*').eq('user_id', userId)
    .in('status', ['new', 'contacted']).eq('is_on_dnc', false)
    .order('motivation_score', { ascending: false, nullsFirst: false })
    .limit(10000);

  if (filter.state)     q = q.eq('property_state', filter.state);
  if (filter.min_score) q = q.gte('motivation_score', filter.min_score);
  if (filter.max_score) q = q.lte('motivation_score', filter.max_score);
  if (filter.source)    q = q.eq('source', filter.source);

  const { data } = await q;
  return data || [];
}

module.exports = { start, pause, resume, stop, activeCampaigns };
