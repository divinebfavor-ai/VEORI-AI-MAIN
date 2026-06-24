const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const vapiService = require('../services/vapiService');
const phoneRotation = require('../services/phoneRotation');
const campaignManager = require('../services/campaignManager');

const router = express.Router();
router.use(requireAuth);

// ─── TCPA helpers ─────────────────────────────────────────────────────────────
// State-to-timezone mapping (Eastern is default if unknown)
const STATE_TZ = {
  AK: 'America/Anchorage', HI: 'Pacific/Honolulu',
  WA: 'America/Los_Angeles', OR: 'America/Los_Angeles', CA: 'America/Los_Angeles', NV: 'America/Los_Angeles',
  MT: 'America/Denver', ID: 'America/Denver', WY: 'America/Denver', CO: 'America/Denver', UT: 'America/Denver', AZ: 'America/Phoenix', NM: 'America/Denver',
  ND: 'America/Chicago', SD: 'America/Chicago', NE: 'America/Chicago', KS: 'America/Chicago',
  MN: 'America/Chicago', IA: 'America/Chicago', MO: 'America/Chicago', WI: 'America/Chicago', IL: 'America/Chicago',
  MI: 'America/Detroit', IN: 'America/Indiana/Indianapolis',
  OK: 'America/Chicago', TX: 'America/Chicago', AR: 'America/Chicago', LA: 'America/Chicago', MS: 'America/Chicago',
  AL: 'America/Chicago', TN: 'America/Chicago',
};

function getTcpaHourInState(stateCode) {
  const tz = STATE_TZ[(stateCode || '').toUpperCase()] || 'America/New_York';
  const now = new Date();
  const localHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(now));
  return localHour;
}

function isTcpaAllowed(stateCode) {
  const hour = getTcpaHourInState(stateCode);
  const day  = new Date().getDay(); // 0=Sun
  // TCPA federal rule: 8 AM - 9 PM local time, no restrictions by day
  if (hour < 8 || hour >= 21) return { allowed: false, reason: `Calling not allowed at this time. TCPA prohibits calls before 8 AM or after 9 PM local time in ${stateCode || 'this state'} (current hour: ${hour}:00).` };
  // Sunday morning — many state regulations restrict before noon
  if (day === 0 && hour < 12) return { allowed: false, reason: 'Calls to this state are restricted before noon on Sundays.' };
  return { allowed: true };
}

async function logTcpa(userId, leadId, phone, action, reason) {
  try {
    const withinHours = action === 'call_initiated';
    await supabase.from('tcpa_log').insert({
      user_id: userId,
      lead_id: leadId || null,
      phone_number: phone || '',
      called_at_utc: new Date().toISOString(),
      within_calling_hours: withinHours,
      dnc_result: action === 'blocked_dnc' ? 'blocked' : action === 'call_initiated' ? 'clear' : 'unknown',
      consent_status: action === 'call_initiated' ? 'compliant' : 'blocked',
      // Store action + reason in local_time field as a simple audit note (no dedicated column)
      local_time: `${action}: ${reason}`,
    });
  } catch { /* non-fatal */ }
}

// GET /api/calls — list with filters
router.get('/', async (req, res, next) => {
  try {
    const { lead_id, status, campaign_id, direction, limit = 50, offset = 0, date_from, date_to } = req.query;
    let q = supabase.from('calls').select('*, leads(first_name, last_name, phone, property_address), phone_numbers(number, friendly_name)', { count: 'exact' })
      .eq('user_id', req.user.id).order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);
    if (lead_id)  q = q.eq('lead_id', lead_id);
    if (status)   q = q.eq('status', status);
    if (direction) q = q.eq('direction', direction);
    if (date_from) q = q.gte('created_at', date_from);
    if (date_to)   q = q.lte('created_at', date_to);
    const { data, error, count } = await q;
    if (error) throw error;
    res.json({ success: true, data, total: count, limit: Number(limit), offset: Number(offset) });
  } catch (err) { next(err); }
});

// GET /api/calls/live — all active calls
router.get('/live', async (req, res, next) => {
  try {
    // A call that already has ended_at set is NOT live, even if a stale status
    // (e.g. an inbound row stuck on 'ringing') was never flipped to 'ended'.
    // Without this guard such rows show in LiveMonitor forever and keep counting.
    const { data, error } = await supabase.from('calls').select('*, leads(first_name, last_name, phone, property_address, motivation_score, primary_tag), phone_numbers(number)')
      .eq('user_id', req.user.id).in('status', ['initiated', 'ringing', 'in-progress'])
      .is('ended_at', null);
    if (error) throw error;
    const flat = (data || []).map(c => ({
      ...c,
      lead_name: c.leads ? `${c.leads.first_name || ''} ${c.leads.last_name || ''}`.trim() || 'Unknown Seller' : 'Unknown Seller',
      property_address: c.leads?.property_address || c.property_address || 'Address unknown',
      motivation_score: c.leads?.motivation_score ?? c.motivation_score,
      primary_tag: c.leads?.primary_tag || c.primary_tag,
    }));
    res.json({ success: true, data: flat });
  } catch (err) { next(err); }
});

// GET /api/calls/:id
router.get('/:id', async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('calls').select('*, leads(*), phone_numbers(*)')
      .eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'Call not found' });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /api/calls/initiate — single call
router.post('/initiate', async (req, res, next) => {
  try {
    const { lead_id, phone_number_id } = req.body;
    if (!lead_id) return res.status(400).json({ success: false, error: 'lead_id required' });

    // Check call quota for this operator
    const { data: opUser } = await supabase.from('users').select('calls_used, calls_limit, subscription_status, subscription_plan, monthly_dial_limit, trial_ends_at, free_calls_today, free_calls_date, overage_enabled, overage_dials_used, last_usage_warning_pct').eq('id', req.user.id).single();

    // Usage-pipeline signals computed in the quota gate below and attached to the response.
    let usagePercent = null;   // 0-100+ of the monthly dial meter (subscribed plans only)
    let usageWarning = null;   // 'approaching_limit' (80%) | 'critical' (95%) | 'over_limit'
    let isOverLimit  = false;  // true when this dial is being served from the overage allowance

    if (opUser) {
      const isTrialExpired = opUser.subscription_status === 'trial' && opUser.trial_ends_at && new Date(opUser.trial_ends_at) < new Date();
      if (isTrialExpired) return res.status(403).json({ success: false, error: 'Your trial has ended. Upgrade your plan to keep calling.' });

      const isSubscribed = opUser.subscription_status === 'active' && opUser.subscription_plan;

      if (!isSubscribed) {
        // Free tier: 10 calls per day
        const FREE_DAILY_LIMIT = 10;
        const today = new Date().toISOString().split('T')[0];
        const lastResetDate = opUser.free_calls_date || '';
        const freeCalls = lastResetDate === today ? (opUser.free_calls_today || 0) : 0;

        if (freeCalls >= FREE_DAILY_LIMIT) {
          return res.status(403).json({
            success:    false,
            error:      `You have used your ${FREE_DAILY_LIMIT} free calls for today. Subscribe to unlock more calls.`,
            error_code: 'FREE_LIMIT_REACHED',
            limit:      FREE_DAILY_LIMIT,
            used:       freeCalls,
          });
        }

        // Reset or increment daily counter
        await supabase.from('users').update({
          free_calls_today: lastResetDate === today ? freeCalls + 1 : 1,
          free_calls_date:  today,
        }).eq('id', req.user.id);
      } else {
        // Subscribed: meter against the plan's monthly dial limit.
        const monthlyLimit = opUser.monthly_dial_limit || opUser.calls_limit || 0;
        const used         = opUser.calls_used || 0;

        if (monthlyLimit) {
          usagePercent = Math.round((used / monthlyLimit) * 100);

          if (used >= monthlyLimit) {
            // At/over the meter. Overage OFF = hard block (unchanged). ON = serve from
            // the overage allowance (tracked separately, no plan reset needed).
            if (!opUser.overage_enabled) {
              return res.status(403).json({
                success:    false,
                error:      `Monthly call limit reached (${monthlyLimit.toLocaleString()} calls). Upgrade your plan for more.`,
                error_code: 'DIAL_LIMIT_REACHED',
                limit:      monthlyLimit,
                used,
              });
            }
            isOverLimit  = true;
            usageWarning = 'over_limit';
          } else if (usagePercent >= 95) {
            usageWarning = 'critical';
          } else if (usagePercent >= 80) {
            usageWarning = 'approaching_limit';
          }

          // Fire each threshold warning once per month, not on every dial.
          // Tracks the highest threshold already announced this cycle.
          const crossedPct = isOverLimit ? 100 : (usagePercent >= 95 ? 95 : (usagePercent >= 80 ? 80 : 0));
          if (crossedPct > (opUser.last_usage_warning_pct || 0)) {
            supabase.from('users').update({ last_usage_warning_pct: crossedPct }).eq('id', req.user.id).catch(() => {});
            console.log(`[Usage] Operator ${req.user.id} crossed ${crossedPct}% of dial meter (${used}/${monthlyLimit})`);
          }
        }
      }
    }

    const { data: lead } = await supabase.from('leads').select('*').eq('id', lead_id).eq('user_id', req.user.id).single();
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

    // TCPA: DNC check
    if (lead.is_on_dnc) {
      await logTcpa(req.user.id, lead.id, lead.phone, 'blocked_dnc', 'Lead is on Do Not Call list');
      return res.status(400).json({ success: false, error: 'Lead is on DNC list — call blocked for TCPA compliance' });
    }

    // TCPA: calling hours enforcement (8 AM - 9 PM local time in lead's state)
    const tcpa = isTcpaAllowed(lead.property_state);
    if (!tcpa.allowed) {
      await logTcpa(req.user.id, lead.id, lead.phone, 'blocked_hours', tcpa.reason);
      return res.status(400).json({ success: false, error: tcpa.reason });
    }

    // TCPA: consent scrub (track + warn — consent is advisory, not a hard block)
    const tcpaWarnings = [];
    if (!lead.consent) {
      tcpaWarnings.push('no_prior_consent');
      await logTcpa(req.user.id, lead.id, lead.phone, 'warn_no_consent', 'No prior express consent on record for this lead');
    }

    // TCPA: federal DNC scrub — HARD BLOCK when the registry confirms the number is listed.
    // Fails OPEN: if FTC_DNC_API_KEY is unset or the lookup errors, fed.checked is false,
    // so the call is NEVER blocked until the registry is configured and actively confirms a hit.
    try {
      const { isOnFederalDnc } = require('../services/ftcDncService');
      const fed = await isOnFederalDnc(lead.phone);
      if (fed.checked && fed.onList) {
        await logTcpa(req.user.id, lead.id, lead.phone, 'blocked_federal_dnc', 'Number is on the FTC National DNC Registry — call blocked');
        return res.status(400).json({ success: false, error: 'Number is on the FTC National Do Not Call Registry — call blocked for TCPA compliance' });
      }
    } catch (e) {
      console.warn('[TCPA] Federal DNC check skipped:', e.message);
    }

    // Derive the lead's area code for local-presence matching (305 lead → 305 number).
    const leadDigits   = String(lead.phone || '').replace(/\D/g, '');
    const leadAreaCode = leadDigits.length === 11 && leadDigits.startsWith('1')
      ? leadDigits.slice(1, 4)
      : (leadDigits.length === 10 ? leadDigits.slice(0, 3) : null);

    // Select best phone number if not specified
    const phoneNum = phone_number_id
      ? (await supabase.from('phone_numbers').select('*').eq('id', phone_number_id).eq('user_id', req.user.id).single()).data
      : await phoneRotation.selectBestNumber(req.user.id, lead.property_state, [], leadAreaCode);

    if (!phoneNum) return res.status(400).json({ success: false, error: 'No healthy phone numbers available' });

    // Create call record
    const callId = uuidv4();
    const { data: callRecord } = await supabase.from('calls').insert([{
      id: callId, user_id: req.user.id, lead_id, phone_number_id: phoneNum.id,
      status: 'initiated', started_at: new Date().toISOString()
    }]).select().single();

    // Load operator profile for personalized AI
    const { data: operatorProfile } = await supabase.from('users')
      .select('ai_caller_name, ai_voice_id, ai_personality_tone, ai_use_case, ai_intro_script, ai_voicemail_script, ai_custom_instructions, proactive_ai_disclosure, company_name, id')
      .eq('id', req.user.id).single();

    // Send SMS disclosure before calling — TCPA best practice
    // Fire-and-forget: don't block the call if SMS fails
    const { getOpeningSMS } = require('../services/leadTaggingService');
    const smsBody = getOpeningSMS(lead);
    supabase.from('conversations').insert({
      user_id:    req.user.id,
      lead_id:    lead.id,
      direction:  'outbound',
      channel:    'sms',
      body:       smsBody,
      sent_at:    new Date().toISOString(),
      status:     'sent',
    }).then(() => {
      console.log(`[Call] Pre-call SMS queued for lead ${lead.id}`);
    }).catch(e => console.warn('[Call] Pre-call SMS log failed:', e.message));

    // Initiate Vapi call with operator persona
    let vapiCall;
    try {
      vapiCall = await vapiService.initiateCall({ lead, phoneNumber: phoneNum, callId, operator: operatorProfile || {} });
    } catch (vapiErr) {
      // Mark the call record as failed so it shows correctly in the UI
      await supabase.from('calls').update({ status: 'failed', ended_at: new Date().toISOString() }).eq('id', callId);
      const vapiMsg = vapiErr.response?.data?.message || vapiErr.response?.data?.error || vapiErr.message || 'VAPI call failed';
      console.error(`[Call] VAPI initiate failed for lead ${lead_id}:`, vapiMsg);
      return res.status(502).json({ success: false, error: vapiMsg });
    }

    // Update call with Vapi ID
    await supabase.from('calls').update({ vapi_call_id: vapiCall.id, status: 'ringing' }).eq('id', callId);
    await phoneRotation.recordCallStart(phoneNum.id);
    await supabase.from('leads').update({ call_count: (lead.call_count || 0) + 1, last_call_date: new Date().toISOString(), status: 'calling' }).eq('id', lead_id);

    // Increment the right meter. Over-limit dials (overage allowance) are tracked
    // separately so the plan meter stays an honest count of in-plan usage.
    if (isOverLimit) {
      supabase.from('users').update({ overage_dials_used: (opUser?.overage_dials_used || 0) + 1 }).eq('id', req.user.id).catch(() => {});
    } else {
      supabase.from('users').update({ calls_used: (opUser?.calls_used || 0) + 1 }).eq('id', req.user.id).catch(() => {});
    }

    // TCPA audit log — call was initiated within compliant hours, not on DNC
    await logTcpa(req.user.id, lead.id, lead.phone, 'call_initiated', `Call placed to ${lead.property_state || 'unknown state'} within TCPA hours. Call ID: ${callId}`);

    res.json({
      success: true,
      data: { ...callRecord, vapi_call_id: vapiCall.id },
      tcpa_warnings: tcpaWarnings,
      usage: { percent: usagePercent, warning: usageWarning, over_limit: isOverLimit },
    });
  } catch (err) { next(err); }
});

// POST /api/calls/campaign/start
router.post('/campaign/start', async (req, res, next) => {
  try {
    const { campaign_id } = req.body;
    if (!campaign_id) return res.status(400).json({ success: false, error: 'campaign_id required' });
    const result = await campaignManager.start(campaign_id, req.user.id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// POST /api/calls/campaign/pause
router.post('/campaign/pause', async (req, res, next) => {
  try {
    const { campaign_id } = req.body;
    await campaignManager.pause(campaign_id);
    res.json({ success: true, message: 'Campaign paused' });
  } catch (err) { next(err); }
});

// POST /api/calls/campaign/stop
router.post('/campaign/stop', async (req, res, next) => {
  try {
    const { campaign_id } = req.body;
    await campaignManager.stop(campaign_id);
    res.json({ success: true, message: 'Campaign stopped' });
  } catch (err) { next(err); }
});

// DELETE /api/calls/:id — remove a failed call log
router.delete('/:id', async (req, res, next) => {
  try {
    // Only allow deletion of failed calls (not active or completed ones with data)
    const { data: call } = await supabase.from('calls').select('status').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (!call) return res.status(404).json({ success: false, error: 'Call not found' });
    if (call.status !== 'failed') return res.status(400).json({ success: false, error: 'Only failed calls can be deleted' });
    const { error } = await supabase.from('calls').delete().eq('id', req.params.id).eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { next(err); }
});

// PUT /api/calls/:id — update outcome, notes, score after manual call
router.put('/:id', async (req, res, next) => {
  try {
    const allowed = ['outcome', 'notes', 'motivation_score', 'status', 'ai_summary'];
    const updates = {};
    for (const k of allowed) { if (req.body[k] !== undefined) updates[k] = req.body[k]; }
    updates.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('calls').update(updates)
      .eq('id', req.params.id).eq('user_id', req.user.id).select().single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/calls/:id/listen — get Vapi listen URL for live monitoring
// Accepts ?vapi_call_id=xxx to skip DB lookup when caller already has the Vapi ID
router.get('/:id/listen', async (req, res, next) => {
  try {
    // If the frontend already has the vapi_call_id, use it directly
    let vapiCallId = req.query.vapi_call_id || null;

    if (!vapiCallId) {
      // Fall back to DB lookup
      const { data: call } = await supabase.from('calls')
        .select('vapi_call_id, status')
        .eq('id', req.params.id)
        .eq('user_id', req.user.id)
        .single();
      if (!call) return res.status(404).json({ success: false, error: 'Call not found' });
      vapiCallId = call.vapi_call_id;
    }

    if (!vapiCallId) return res.status(400).json({ success: false, error: 'No Vapi call ID — call may not have connected yet' });

    const listenUrl = await vapiService.getListenUrl(vapiCallId);
    if (!listenUrl) {
      // No listen URL can mean two very different things:
      //   (a) the call is still ringing (audio not up yet) → frontend should keep
      //       polling with the dial tone, OR
      //   (b) the call has ENDED → there will never be audio. The frontend's
      //       retry loop must stop immediately and silence the ringback; if we
      //       return a plain 404 it keeps "ringing" for the full 90s deadline.
      // Disambiguate by asking Vapi for the call's live status.
      let ended = false;
      try {
        const vc = await vapiService.getCall(vapiCallId);
        ended = vc?.status === 'ended' || !!vc?.endedAt || !!vc?.endedReason;
      } catch { /* if the lookup fails, fall through as "still connecting" */ }
      if (ended) {
        return res.status(409).json({ success: false, ended: true, error: 'Call has ended — no live audio' });
      }
      return res.status(404).json({ success: false, error: 'Audio not available yet — call is still connecting' });
    }

    res.json({ success: true, listen_url: listenUrl });
  } catch (err) { next(err); }
});

// POST /api/calls/:id/listen-join — proxy WebRTC SDP offer to Vapi (avoids browser CORS)
router.post('/:id/listen-join', async (req, res, next) => {
  try {
    const { sdp } = req.body;
    if (!sdp) return res.status(400).json({ success: false, error: 'SDP offer required' });

    const { data: call } = await supabase.from('calls')
      .select('vapi_call_id')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    if (!call?.vapi_call_id) return res.status(404).json({ success: false, error: 'Call not found or no Vapi ID' });

    const listenUrl = await vapiService.getListenUrl(call.vapi_call_id);
    if (!listenUrl) return res.status(404).json({ success: false, error: 'Listen URL not available yet' });

    // Proxy SDP exchange to Vapi on behalf of browser (no CORS issues)
    const axios = require('axios');
    const response = await axios.post(listenUrl, sdp, {
      headers: { 'Content-Type': 'application/sdp' },
      responseType: 'text',
      timeout: 10000,
    });

    res.set('Content-Type', 'application/sdp');
    res.send(response.data);
  } catch (err) {
    if (err.response) {
      return res.status(err.response.status).json({ success: false, error: `Vapi listen failed: ${err.response.status}` });
    }
    next(err);
  }
});

// POST /api/calls/:id/end — manually end a live call
router.post('/:id/end', async (req, res, next) => {
  try {
    const { data: call } = await supabase.from('calls').select('vapi_call_id')
      .eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (call?.vapi_call_id) {
      vapiService.endCall?.(call.vapi_call_id).catch(() => {});
    }
    await supabase.from('calls').update({ status: 'ended', ended_at: new Date().toISOString() })
      .eq('id', req.params.id).eq('user_id', req.user.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST /api/calls/takeover — operator takes over live call
router.post('/takeover', async (req, res, next) => {
  try {
    const { call_id } = req.body;
    const { data: call } = await supabase.from('calls').select('*').eq('id', call_id).eq('user_id', req.user.id).single();
    if (!call) return res.status(404).json({ success: false, error: 'Call not found' });

    await vapiService.muteAssistant(call.vapi_call_id);
    await supabase.from('calls').update({ operator_took_over: true }).eq('id', call_id);

    // Get coaching suggestions based on latest transcript
    const coaching = call.transcript
      ? await require('../services/aiService').getCoachingSuggestions(call.transcript)
      : { suggestions: [], objection_responses: [], offer_recommendation: null };

    res.json({ success: true, message: 'Takeover active — you are live', coaching });
  } catch (err) { next(err); }
});

// POST /api/calls/return-to-ai
router.post('/return-to-ai', async (req, res, next) => {
  try {
    const { call_id } = req.body;
    const { data: call } = await supabase.from('calls').select('*').eq('id', call_id).eq('user_id', req.user.id).single();
    if (!call) return res.status(404).json({ success: false, error: 'Call not found' });
    await vapiService.unmuteAssistant(call.vapi_call_id);
    res.json({ success: true, message: 'AI back in control' });
  } catch (err) { next(err); }
});

// POST /api/calls/wire-inbound — one-time: put all of THIS operator's Vapi
// numbers into assistant-request (inbound) mode so sellers can call them back
// into Veori. Idempotent. Scoped to the caller's own numbers only.
router.post('/wire-inbound', async (req, res, next) => {
  try {
    const { data: numbers, error } = await supabase.from('phone_numbers')
      .select('number, vapi_phone_number_id')
      .eq('user_id', req.user.id)
      .not('vapi_phone_number_id', 'is', null);
    if (error) throw error;

    const results = [];
    for (const n of numbers || []) {
      try {
        await vapiService.configureInboundNumber(n.vapi_phone_number_id);
        results.push({ number: n.number, ok: true });
      } catch (e) {
        results.push({ number: n.number, ok: false, error: e.response?.data?.message || e.message });
      }
    }

    const wired = results.filter(r => r.ok).length;
    res.json({ success: true, wired, total: results.length, results });
  } catch (err) { next(err); }
});

module.exports = router;
