/**
 * /api/hot-leads
 * Hot Lead Auto-Escalation — triggers when motivation_score > 85
 * NEW FILE — does not modify any existing routes
 */
const express  = require('express');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const HOT_THRESHOLD = 85;

function tableMissing(err) {
  return err?.code === 'PGRST205' || (err?.message || '').includes('does not exist');
}

async function createNotification(userId, leadId, leadName, score) {
  try {
    await supabase.from('notifications').insert({
      operator_id: userId,
      type:        'hot_lead',
      title:       `🔥 Hot Lead — ${leadName}`,
      message:     `Motivation score hit ${score}/100. Lead has been flagged for immediate follow-up. Contract draft ready.`,
      link:        `/leads`,
      is_read:     false,
    });
  } catch { /* notifications table may not exist */ }
}

async function createFollowUpTask(userId, leadId, leadName) {
  try {
    await supabase.from('follow_ups').insert({
      user_id:     userId,
      lead_id:     leadId,
      type:        'call',
      priority:    'urgent',
      title:       `🔥 HOT LEAD — Call ${leadName} within 10 minutes`,
      notes:       'Auto-created by hot lead escalation. Motivation score exceeded 85. Strike while hot.',
      due_date:    new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 minutes
      status:      'pending',
    });
  } catch { /* follow_ups table schema may differ */ }
}

/**
 * Core escalation logic — can be called from scanner or webhook
 */
async function escalateLead(userId, lead) {
  // Check if already escalated (active escalation exists)
  const { data: existing } = await supabase
    .from('hot_lead_escalations')
    .select('id')
    .eq('lead_id', lead.id)
    .is('resolved_at', null)
    .single();

  if (existing) return { skipped: true, reason: 'already_escalated' };

  const leadName = `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Unknown';

  // 1. Insert escalation record
  const { data: escalation, error } = await supabase
    .from('hot_lead_escalations')
    .insert({
      lead_id:          lead.id,
      user_id:          userId,
      motivation_score: lead.motivation_score,
    })
    .select().single();

  if (error) {
    if (tableMissing(error)) return { skipped: true, reason: 'table_missing' };
    throw error;
  }

  // 2. Mark lead as HOT in the tags field (non-destructive)
  const currentTags = lead.tags || [];
  if (!currentTags.includes('HOT')) {
    await supabase.from('leads')
      .update({ tags: [...currentTags, 'HOT'] })
      .eq('id', lead.id);
  }

  // 3. Send in-app notification
  await createNotification(userId, lead.id, leadName, lead.motivation_score);
  await supabase.from('hot_lead_escalations').update({ notification_sent: true }).eq('id', escalation.id);

  // 4. Create 10-minute follow-up task
  await createFollowUpTask(userId, lead.id, leadName);
  await supabase.from('hot_lead_escalations').update({ follow_up_created: true }).eq('id', escalation.id);

  return { escalated: true, lead_id: lead.id, leadName, score: lead.motivation_score };
}

// GET /api/hot-leads — list all current hot leads (score > 85 or tagged HOT)
router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('leads')
      .select('id, first_name, last_name, phone, property_address, motivation_score, status, tags, last_call_date')
      .eq('user_id', req.user.id)
      .gte('motivation_score', HOT_THRESHOLD)
      .order('motivation_score', { ascending: false })
      .limit(50);

    if (error) throw error;

    // Fetch active escalations
    const { data: escalations } = await supabase
      .from('hot_lead_escalations')
      .select('lead_id, triggered_at, notification_sent, follow_up_created')
      .eq('user_id', req.user.id)
      .is('resolved_at', null);

    const escalationMap = {};
    (escalations || []).forEach(e => { escalationMap[e.lead_id] = e; });

    const leads = (data || []).map(l => ({
      ...l,
      escalation: escalationMap[l.id] || null,
    }));

    res.json({ success: true, hotLeads: leads, total: leads.length });
  } catch (err) { next(err); }
});

// GET /api/hot-leads/escalations — history of all escalation events
router.get('/escalations', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('hot_lead_escalations')
      .select('*, leads(first_name, last_name, property_address, motivation_score)')
      .eq('user_id', req.user.id)
      .order('triggered_at', { ascending: false })
      .limit(100);

    if (error) {
      if (tableMissing(error)) return res.json({ success: true, escalations: [] });
      throw error;
    }
    res.json({ success: true, escalations: data || [] });
  } catch (err) { next(err); }
});

// POST /api/hot-leads/scan — scan all leads and escalate those above threshold
router.post('/scan', async (req, res, next) => {
  try {
    const { data: hotLeads, error } = await supabase
      .from('leads')
      .select('*')
      .eq('user_id', req.user.id)
      .gte('motivation_score', HOT_THRESHOLD)
      .not('status', 'in', '(under_contract,closed,dnc)');

    if (error) throw error;
    if (!hotLeads || hotLeads.length === 0) return res.json({ success: true, escalated: 0 });

    const results = [];
    for (const lead of hotLeads) {
      const result = await escalateLead(req.user.id, lead);
      results.push(result);
    }

    const escalated = results.filter(r => r.escalated).length;
    const skipped   = results.filter(r => r.skipped).length;
    res.json({ success: true, escalated, skipped, total: hotLeads.length });
  } catch (err) { next(err); }
});

// POST /api/hot-leads/:leadId/escalate — manually escalate a specific lead
router.post('/:leadId/escalate', async (req, res, next) => {
  try {
    const { data: lead } = await supabase.from('leads').select('*').eq('id', req.params.leadId).eq('user_id', req.user.id).single();
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

    const result = await escalateLead(req.user.id, lead);
    res.json({ success: true, result });
  } catch (err) { next(err); }
});

// PUT /api/hot-leads/escalations/:id/resolve — mark escalation as resolved
router.put('/escalations/:id/resolve', async (req, res, next) => {
  try {
    await supabase.from('hot_lead_escalations')
      .update({ resolved_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
