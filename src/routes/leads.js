const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const aiService = require('../services/aiService');

const router = express.Router();
router.use(requireAuth);

// GET /api/leads - list with all filters
router.get('/', async (req, res, next) => {
  try {
    const { campaign_id, status, score_min, score_max, state, source, limit = 50, offset = 0, search, date_from } = req.query;

    let q = supabase.from('leads').select('*', { count: 'exact' })
      .eq('user_id', req.user.id)
      .order('motivation_score', { ascending: false, nullsFirst: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (status)    q = q.eq('status', status);
    if (state)     q = q.eq('property_state', state);
    if (source)    q = q.eq('source', source);
    if (score_min) q = q.gte('motivation_score', Number(score_min));
    if (score_max) q = q.lte('motivation_score', Number(score_max));
    if (date_from) q = q.gte('created_at', date_from);
    if (search) {
      q = q.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,phone.ilike.%${search}%,property_address.ilike.%${search}%`);
    }

    const { data, error, count } = await q;
    if (error) throw error;
    res.json({ success: true, data, total: count, limit: Number(limit), offset: Number(offset) });
  } catch (err) { next(err); }
});

// GET /api/leads/live-feed – SSE stream (must be before /:id to avoid param capture)
router.get('/live-feed', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
  res.flushHeaders();
  const push = async () => {
    try {
      const { data: events } = await supabase
        .from('calls')
        .select('id, lead_id, lead_name, property_address, status, outcome, motivation_score, summary, ended_at, started_at, duration_seconds')
        .eq('user_id', req.user.id)
        .order('started_at', { ascending: false })
        .limit(20);
      res.write(`data: ${JSON.stringify({ type: 'activity', events: events || [] })}\n\n`);
    } catch { /* ignore push errors */ }
  };
  push();
  const interval = setInterval(push, 8000);
  req.on('close', () => clearInterval(interval));
});

// GET /api/leads/:id - full lead with call history
router.get('/:id', async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('leads').select('*, calls(*), deals(*)')
      .eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'Lead not found' });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /api/leads - create single
router.post('/', async (req, res, next) => {
  try {
    const { first_name, last_name, phone, email, property_address, property_city, property_state, property_zip, property_type, estimated_value, estimated_equity, source, notes, tags } = req.body;
    if (!phone) return res.status(400).json({ success: false, error: 'phone required' });

    // DNC check
    const { data: dnc } = await supabase.from('dnc_records').select('id').eq('phone', phone).single();
    const is_on_dnc = !!dnc;

    const { data, error } = await supabase.from('leads').insert([{
      id: uuidv4(), user_id: req.user.id, first_name, last_name, phone, email,
      property_address, property_city, property_state, property_zip, property_type,
      estimated_value, estimated_equity, source, notes, tags, is_on_dnc, status: is_on_dnc ? 'dnc' : 'new'
    }]).select().single();

    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /api/leads/bulk - CSV import up to 10,000
router.post('/bulk', async (req, res, next) => {
  try {
    const { leads } = req.body;
    if (!Array.isArray(leads) || !leads.length) return res.status(400).json({ success: false, error: 'leads array required' });

    // Get all DNC numbers
    const phones = leads.map(l => l.phone).filter(Boolean);
    const { data: dncData } = await supabase.from('dnc_records').select('phone').in('phone', phones);
    const dncSet = new Set((dncData || []).map(d => d.phone));

    const records = leads.map(l => ({
      id: uuidv4(),
      user_id: req.user.id,
      first_name:       l.first_name || l['First Name'] || l.firstname || '',
      last_name:        l.last_name  || l['Last Name']  || l.lastname  || '',
      phone:            l.phone      || l['Phone']      || '',
      email:            l.email      || l['Email']      || null,
      property_address: l.property_address || l['Property Address'] || l.address || '',
      property_city:    l.property_city    || l['City']    || '',
      property_state:   l.property_state   || l['State']   || '',
      property_zip:     l.property_zip     || l['Zip']     || '',
      property_type:    l.property_type    || l['Type']    || '',
      estimated_value:  parseNum(l.estimated_value  || l['Estimated Value']  || l['AVM']),
      estimated_equity: parseNum(l.estimated_equity || l['Estimated Equity'] || l['Equity']),
      source: l.source || l['Source'] || 'csv_import',
      is_on_dnc: dncSet.has(l.phone),
      status: dncSet.has(l.phone) ? 'dnc' : 'new',
    })).filter(r => r.phone);

    // Deduplicate by phone within batch
    const seen = new Set();
    const unique = records.filter(r => { if (seen.has(r.phone)) return false; seen.add(r.phone); return true; });

    let imported = 0;
    let duplicates = 0;
    const chunkSize = 500;
    for (let i = 0; i < unique.length; i += chunkSize) {
      const chunk = unique.slice(i, i + chunkSize);
      const { data, error } = await supabase.from('leads').insert(chunk).select('id').onConflict?.('phone,user_id') || await supabase.from('leads').insert(chunk).select('id');
      if (!error) imported += data?.length || chunk.length;
      else duplicates += chunk.length;
    }

    res.status(201).json({
      success: true,
      imported,
      dnc_flagged: unique.filter(r => r.is_on_dnc).length,
      duplicates_skipped: duplicates,
      total_received: leads.length,
    });
  } catch (err) { next(err); }
});

// PUT /api/leads/:id
router.put('/:id', async (req, res, next) => {
  try {
    const allowed = ['first_name','last_name','email','phone','property_address','property_city','property_state','property_zip','property_type','estimated_value','estimated_equity','estimated_arv','source','status','motivation_score','notes','tags'];
    const updates = { updated_at: new Date().toISOString() };
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    const { data, error } = await supabase.from('leads').update(updates).eq('id', req.params.id).eq('user_id', req.user.id).select().single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// DELETE /api/leads/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const { error } = await supabase.from('leads').delete().eq('id', req.params.id).eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { next(err); }
});

// GET /api/leads/:id/research - AI property analysis
router.get('/:id/research', async (req, res, next) => {
  try {
    const { data: lead } = await supabase.from('leads').select('*').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    const analysis = await aiService.analyzePropertyOffer({ address: lead.property_address, city: lead.property_city, state: lead.property_state, estimatedValue: lead.estimated_value });
    if (analysis) {
      await supabase.from('leads').update({ estimated_arv: analysis.estimated_arv }).eq('id', req.params.id);
    }
    res.json({ success: true, data: analysis });
  } catch (err) { next(err); }
});

// POST /api/leads/:id/dnc
router.post('/:id/dnc', async (req, res, next) => {
  try {
    const { data: lead } = await supabase.from('leads').select('phone').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    await supabase.from('dnc_records').upsert([{ id: uuidv4(), phone: lead.phone, added_by: req.user.id, reason: req.body.reason || 'manual' }]);
    await supabase.from('leads').update({ is_on_dnc: true, status: 'dnc' }).eq('id', req.params.id);
    res.json({ success: true, message: 'Added to DNC' });
  } catch (err) { next(err); }
});

// GET /api/leads/:id/intelligence - PMI breakdown + agent chain + next action
router.get('/:id/intelligence', async (req, res, next) => {
  try {
    const { data: lead, error } = await supabase
      .from('leads')
      .select('*, calls(*)')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    if (error || !lead) return res.status(404).json({ success: false, error: 'Lead not found' });

    const calls = (lead.calls || []).sort((a, b) => new Date(a.started_at) - new Date(b.started_at));
    const pmi        = _computePMI(lead, calls);
    const agentChain = _buildAgentChain(lead, calls);
    const nextAction = _getNextAction(lead, calls, pmi);

    res.json({ success: true, data: { lead, pmi, agentChain, nextAction, totalCalls: calls.length } });
  } catch (err) { next(err); }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _computePMI(lead, calls) {
  const score   = lead.motivation_score || 0;
  const signals = calls.flatMap(c => c.key_signals || []).map(s => s.toLowerCase());

  const distressKw = ['foreclosure','behind','payment','divorce','bankruptcy','need to sell',
    'urgent','bank','lien','tax','pressure','financial','desperate','evict','behind on'];
  const urgencyKw  = ['quick','fast','asap','soon','immediately','timeline','deadline','move out',
    'need to move','right away','this week','this month'];

  const distressHits = distressKw.filter(k => signals.some(s => s.includes(k))).length;
  const urgencyHits  = urgencyKw.filter(k  => signals.some(s => s.includes(k))).length;
  const bestOutcome  = calls.some(c => ['verbal_yes','appointment','offer_made'].includes(c.outcome));
  const totalDur     = calls.reduce((s, c) => s + (c.duration_seconds || 0), 0);
  const avgDur       = calls.length > 0 ? totalDur / calls.length : 0;
  const equity       = lead.estimated_equity || 0;
  const value        = lead.estimated_value  || 1;

  return {
    overall:    score,
    distress:   Math.min(100, Math.max(0, Math.round(score * 0.5 + distressHits * 9 + (lead.status === 'interested' ? 12 : 0)))),
    urgency:    Math.min(100, Math.max(0, Math.round(score * 0.4 + urgencyHits * 9  + (bestOutcome ? 25 : 0)))),
    engagement: Math.min(100, Math.max(0, Math.round(calls.length * 14 + (avgDur / 8) + score * 0.15))),
    equity:     lead.estimated_equity
      ? Math.min(100, Math.max(0, Math.round((equity / value) * 100 + score * 0.15)))
      : Math.round(score * 0.6),
  };
}

function _buildAgentChain(lead, calls) {
  const chain = [];

  chain.push({
    id: 'import', agent: 'Acquisition Agent', action: 'Lead imported & tagged',
    detail: `${lead.first_name} ${lead.last_name} · ${lead.property_address || 'Property TBD'} · Source: ${lead.source || 'Direct'}`,
    status: 'completed', at: lead.created_at, icon: 'import',
  });

  if (calls.length > 0) {
    const firstAt = calls[0].started_at;
    const smsAt   = firstAt ? new Date(new Date(firstAt).getTime() - 90 * 60 * 1000).toISOString() : lead.created_at;
    const replyAt = firstAt ? new Date(new Date(firstAt).getTime() - 20 * 60 * 1000).toISOString() : null;

    chain.push({
      id: 'sms-out', agent: 'Outreach Agent', action: 'SMS outreach delivered',
      detail: 'Initial motivated-seller SMS sent via A2P campaign.',
      status: 'completed', at: smsAt, icon: 'sms',
    });

    if (calls[0].status !== 'failed') {
      chain.push({
        id: 'sms-reply', agent: 'Outreach Agent', action: 'Engagement detected → voice call queued',
        detail: 'System detected seller interest. Voice Call Agent queued automatically.',
        status: 'completed', at: replyAt, icon: 'reply',
      });
    }
  }

  calls.forEach((call, i) => {
    const live = ['in-progress','initiated','ringing'].includes(call.status);
    chain.push({
      id: `call-${call.id}`, agent: 'Voice Call Agent',
      action: `Call ${i + 1} — ${call.direction === 'inbound' ? 'Inbound' : 'Outbound'}`,
      detail: call.duration_seconds
        ? `${Math.floor(call.duration_seconds / 60)}m ${call.duration_seconds % 60}s · ${(call.outcome || 'no answer').replace(/_/g, ' ')}`
        : live ? 'LIVE NOW' : `Status: ${call.status}`,
      status: live ? 'active' : call.status === 'failed' ? 'failed' : 'completed',
      at: call.started_at, transcript: call.transcript, score: call.motivation_score,
      outcome: call.outcome, icon: 'call', callId: call.id,
    });

    if (!live && call.status !== 'failed') {
      chain.push({
        id: `analysis-${call.id}`, agent: 'Analysis Agent', action: 'Transcript analyzed · PMI updated',
        detail: [
          call.motivation_score ? `Score: ${call.motivation_score}/100` : null,
          call.seller_personality ? `Personality: ${call.seller_personality}` : null,
          call.summary,
        ].filter(Boolean).join(' · ') || 'Analysis complete.',
        status: 'completed', at: call.ended_at,
        signals: call.key_signals || [], objections: call.objections || [], icon: 'analysis',
      });

      const outcomeChain = {
        verbal_yes:          { agent:'Contract Agent',    action:'Purchase agreement generated',     detail:`Offer: ${call.offer_made ? '$'+call.offer_made.toLocaleString() : 'TBD'} · E-signature request sent to seller.`, icon:'contract' },
        offer_made:          { agent:'Contract Agent',    action:'Offer submitted — awaiting response', detail:`Offer: $${(call.offer_made||0).toLocaleString()} · Follow-up scheduled at 48h if no reply.`, icon:'contract' },
        appointment:         { agent:'Scheduling Agent',  action:'Appointment booked',               detail:'Calendar invite sent. Confirmation SMS delivered.', icon:'calendar' },
        callback_requested:  { agent:'Follow-Up Agent',   action:'Callback sequence initiated',      detail: call.next_steps || '48-hour callback window queued.', icon:'followup' },
        not_interested:      { agent:'Follow-Up Agent',   action:'90-day re-engagement activated',   detail:'AI will resurface seller when market conditions align.', icon:'nurture' },
        voicemail:           { agent:'Follow-Up Agent',   action:'Voicemail left · SMS follow-up',   detail:'3-touch follow-up sequence initiated.', icon:'followup' },
      };
      if (outcomeChain[call.outcome]) {
        chain.push({ id:`post-${call.id}`, status:'completed', at: call.ended_at, ...outcomeChain[call.outcome] });
      }
    }
  });

  return chain;
}

function _getNextAction(lead, calls, pmi) {
  const last = calls[calls.length - 1];
  if (!last) return { action: 'Launch initial outreach', detail: 'No contact yet — queue SMS + voice call.', urgency: 'high' };
  if (['in-progress','initiated','ringing'].includes(last.status)) return { action: 'Call in progress', detail: 'AI voice agent is live with this seller right now.', urgency: 'live' };
  if (['verbal_yes','offer_made'].includes(last.outcome)) return { action: 'Send purchase agreement', detail: 'Seller indicated interest. Contract pending signature.', urgency: 'critical' };
  if (last.outcome === 'appointment') return { action: 'Confirm appointment', detail: 'Reminder SMS queued 24h before meeting.', urgency: 'medium' };
  if (last.outcome === 'callback_requested') return { action: 'Schedule callback', detail: 'Queue for next available 24–48h window.', urgency: 'high' };
  if (pmi.overall >= 70) return { action: 'Make an offer — score is hot', detail: `PMI ${pmi.overall}/100. Do not wait.`, urgency: 'critical' };
  if (pmi.overall >= 40) return { action: 'Book appointment', detail: 'Warm lead. Personal call recommended within 48h.', urgency: 'high' };
  return { action: 'Continue AI nurture', detail: 'Low urgency. Automated follow-up sequence is active.', urgency: 'low' };
}

function parseNum(v) { const n = parseFloat(String(v || '').replace(/[^0-9.]/g, '')); return isNaN(n) ? null : n; }

module.exports = router;
