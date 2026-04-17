// ─── Campaign Manager — Concurrent Dialer Engine ──────────────────────────────
if (process.env.NODE_ENV !== 'production') require('dotenv').config();
const supabase = require('../config/supabase');
const vapiService = require('./vapiService');
const phoneRotation = require('./phoneRotation');
const { v4: uuidv4 } = require('uuid');

// In-memory active campaigns (in production use Redis)
const activeCampaigns = new Map();

/**
 * Start a campaign — launches concurrent Vapi sessions
 */
async function start(campaignId, userId) {
  const { data: campaign, error } = await supabase.from('campaigns').select('*').eq('id', campaignId).eq('user_id', userId).single();
  if (error || !campaign) throw new Error('Campaign not found');
  if (['active', 'running'].includes(campaign.status)) throw new Error('Campaign already running');

  await supabase.from('campaigns').update({ status: 'active', updated_at: new Date().toISOString() }).eq('id', campaignId);

  // Build lead queue
  const leads = await buildLeadQueue(campaignId, userId, campaign.lead_filter || {});
  await supabase.from('campaigns').update({ total_leads: leads.length }).eq('id', campaignId);

  const session = {
    campaignId,
    userId,
    campaign,
    leadQueue:    leads,
    activeCalls:  new Map(),
    paused:       false,
    stopped:      false,
    interval:     null,
  };
  activeCampaigns.set(campaignId, session);

  // Start the dialer loop
  session.interval = setInterval(() => dialerTick(campaignId), (campaign.call_delay_seconds || 3) * 1000);

  // Run first tick immediately
  await dialerTick(campaignId);

  return { status: 'started', total_leads: leads.length, concurrent_lines: campaign.concurrent_lines };
}

async function dialerTick(campaignId) {
  const session = activeCampaigns.get(campaignId);
  if (!session || session.stopped || session.paused) return;

  const { campaign, leadQueue, activeCalls, userId } = session;

  // Check calling hours
  if (!isWithinCallingHours(campaign)) return;

  // Check daily spend limit
  if (campaign.daily_spend_limit) {
    const todayCost = (campaign.leads_called || 0) * 0.25;
    if (todayCost >= campaign.daily_spend_limit) {
      console.log(`[Campaign ${campaignId}] Daily spend limit reached. Pausing.`);
      await pause(campaignId);
      return;
    }
  }

  const slotsAvailable = campaign.concurrent_lines - activeCalls.size;
  if (slotsAvailable <= 0 || leadQueue.length === 0) return;

  for (let i = 0; i < slotsAvailable; i++) {
    if (leadQueue.length === 0) break;
    const lead = leadQueue.shift();
    if (!lead) continue;

    try {
      // Check DNC
      const { data: dnc } = await supabase.from('dnc_records').select('id').eq('phone', lead.phone).single();
      if (dnc) { await supabase.from('leads').update({ is_on_dnc: true, status: 'dnc' }).eq('id', lead.id); continue; }

      // Select phone number (exclude numbers already in use)
      const inUseIds = Array.from(activeCalls.values()).map(c => c.phoneNumberId).filter(Boolean);
      const phoneNum = await phoneRotation.selectBestNumber(userId, lead.property_state, inUseIds);
      if (!phoneNum) { console.log('[Campaign] No healthy numbers — waiting...'); break; }

      // Create call record
      const callId = uuidv4();
      await supabase.from('calls').insert([{ id: callId, user_id: userId, lead_id: lead.id, phone_number_id: phoneNum.id, status: 'initiated', started_at: new Date().toISOString() }]);

      // Start Vapi call
      const vapiCall = await vapiService.initiateCall({ lead, phoneNumber: phoneNum, callId });
      await supabase.from('calls').update({ vapi_call_id: vapiCall.id, status: 'ringing' }).eq('id', callId);
      await phoneRotation.recordCallStart(phoneNum.id);

      // Update lead
      await supabase.from('leads').update({ call_count: (lead.call_count || 0) + 1, last_call_date: new Date().toISOString(), status: 'calling' }).eq('id', lead.id);

      activeCalls.set(callId, { vapiCallId: vapiCall.id, leadId: lead.id, phoneNumberId: phoneNum.id, startedAt: Date.now() });

      // Increment campaign counter
      await supabase.from('campaigns').update({ leads_called: (campaign.leads_called || 0) + 1 }).eq('id', campaignId);
      campaign.leads_called = (campaign.leads_called || 0) + 1;

      // Poll call status and remove from active when done
      pollCallStatus(campaignId, callId, vapiCall.id);

      console.log(`[Campaign ${campaignId}] Started call to ${lead.first_name} ${lead.last_name} | Phone: ${phoneNum.number}`);
    } catch (err) {
      console.error(`[Campaign] Error starting call for lead ${lead.id}:`, err.message);
    }
  }

  // Auto-stop when queue empty and no active calls
  if (leadQueue.length === 0 && activeCalls.size === 0) {
    await stop(campaignId);
  }
}

async function pollCallStatus(campaignId, callId, vapiCallId) {
  const session = activeCampaigns.get(campaignId);
  if (!session) return;

  // Check every 5 seconds if call is still active
  const poll = setInterval(async () => {
    try {
      const call = await vapiService.getCall(vapiCallId).catch(() => null);
      const isEnded = !call || call.status === 'ended' || call.status === 'failed';
      if (isEnded) {
        clearInterval(poll);
        session.activeCalls.delete(callId);
        console.log(`[Campaign ${campaignId}] Call ${callId} ended. Active: ${session.activeCalls.size}`);
      }
    } catch { clearInterval(poll); session.activeCalls.delete(callId); }
  }, 5000);
}

async function pause(campaignId) {
  const session = activeCampaigns.get(campaignId);
  if (session) session.paused = true;
  await supabase.from('campaigns').update({ status: 'paused', updated_at: new Date().toISOString() }).eq('id', campaignId);
}

async function resume(campaignId) {
  const session = activeCampaigns.get(campaignId);
  if (session) { session.paused = false; await dialerTick(campaignId); }
  await supabase.from('campaigns').update({ status: 'active', updated_at: new Date().toISOString() }).eq('id', campaignId);
}

async function stop(campaignId) {
  const session = activeCampaigns.get(campaignId);
  if (session) {
    session.stopped = true;
    if (session.interval) clearInterval(session.interval);
    activeCampaigns.delete(campaignId);
  }
  await supabase.from('campaigns').update({ status: 'completed', updated_at: new Date().toISOString() }).eq('id', campaignId);
}

function isWithinCallingHours(campaign) {
  const now = new Date();
  const hour = now.getHours();
  const [startH] = (campaign.calling_hours_start || '09:00').split(':').map(Number);
  const [endH]   = (campaign.calling_hours_end   || '20:00').split(':').map(Number);
  const day = now.getDay();
  if (day === 0 && hour < 12) return false; // No Sunday calls before noon
  return hour >= startH && hour < endH;
}

async function buildLeadQueue(campaignId, userId, filter = {}) {
  let q = supabase.from('leads').select('*').eq('user_id', userId)
    .in('status', ['new', 'contacted']).eq('is_on_dnc', false)
    .order('motivation_score', { ascending: false, nullsFirst: false })
    .limit(10000);

  if (filter.state)      q = q.eq('property_state', filter.state);
  if (filter.min_score)  q = q.gte('motivation_score', filter.min_score);
  if (filter.max_score)  q = q.lte('motivation_score', filter.max_score);
  if (filter.source)     q = q.eq('source', filter.source);

  const { data } = await q;
  return data || [];
}

module.exports = { start, pause, resume, stop, activeCampaigns };
