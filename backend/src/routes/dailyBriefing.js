/**
 * /api/briefing
 * Daily AI Briefing - morning digest of stats + priority follow-ups
 * NEW FILE - does not modify any existing routes
 */
const express  = require('express');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function tableMissing(err) {
  return err?.code === 'PGRST205' || (err?.message || '').includes('does not exist');
}

function todayDate() {
  return new Date().toISOString().split('T')[0];
}

function yesterdayDate() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

async function generateBriefingForUser(userId) {
  const today     = todayDate();
  const yesterday = yesterdayDate();

  // ── Yesterday stats ──────────────────────────────────────────────────────────
  const { data: calls } = await supabase.from('calls')
    .select('status, duration_seconds, motivation_score')
    .eq('user_id', userId)
    .gte('created_at', yesterday + 'T00:00:00Z')
    .lt('created_at', today + 'T00:00:00Z');

  const { data: deals } = await supabase.from('deals')
    .select('status, price')
    .eq('user_id', userId)
    .gte('created_at', yesterday + 'T00:00:00Z')
    .lt('created_at', today + 'T00:00:00Z');

  const totalCalls  = calls?.length || 0;
  const answered    = calls?.filter(c => c.status === 'ended' && (c.duration_seconds || 0) > 10).length || 0;
  const avgScore    = totalCalls > 0
    ? Math.round(calls.reduce((s, c) => s + (c.motivation_score || 0), 0) / totalCalls)
    : 0;
  const newDeals    = deals?.filter(d => d.status !== 'dead').length || 0;

  const stats = { totalCalls, answered, avgMotivation: avgScore, newDeals, date: yesterday };

  // ── Today's priority follow-ups ───────────────────────────────────────────────
  const { data: followUps } = await supabase.from('follow_ups')
    .select('*, leads(first_name, last_name, phone, motivation_score)')
    .eq('user_id', userId)
    .lte('due_date', new Date().toISOString())
    .eq('status', 'pending')
    .order('due_date', { ascending: true })
    .limit(5);

  const { data: hotLeads } = await supabase.from('leads')
    .select('id, first_name, last_name, phone, motivation_score, last_call_date')
    .eq('user_id', userId)
    .gte('motivation_score', 70)
    .not('status', 'in', '(closed,dnc,under_contract)')
    .order('motivation_score', { ascending: false })
    .limit(5);

  const priorities = [
    ...(followUps || []).map(f => ({
      type:   'follow_up',
      name:   `${f.leads?.first_name || ''} ${f.leads?.last_name || ''}`.trim(),
      phone:  f.leads?.phone,
      score:  f.leads?.motivation_score,
      reason: f.title || 'Scheduled follow-up',
    })),
    ...(hotLeads || []).map(h => ({
      type:   'hot_lead',
      name:   `${h.first_name || ''} ${h.last_name || ''}`.trim(),
      phone:  h.phone,
      score:  h.motivation_score,
      reason: `Motivation ${h.motivation_score}/100 - high priority`,
    })),
  ];

  // ── AI summary ───────────────────────────────────────────────────────────────
  const aiSummary = buildSummary(stats, priorities);

  // ── Store briefing ────────────────────────────────────────────────────────────
  const { data: briefing, error } = await supabase
    .from('daily_briefings')
    .upsert({
      user_id:       userId,
      briefing_date: today,
      stats,
      priorities,
      ai_summary:    aiSummary,
      delivered_at:  new Date().toISOString(),
    }, { onConflict: 'user_id,briefing_date' })
    .select().single();

  if (error) throw error;

  // Create in-app notification
  try {
    await supabase.from('notifications').insert({
      operator_id: userId,
      type:        'daily_briefing',
      title:       `☀️ Good morning - ${today}`,
      message:     aiSummary.slice(0, 200),
      link:        '/dashboard',
      is_read:     false,
    });
  } catch { /* notifications table may not exist */ }

  return briefing;
}

function buildSummary(stats, priorities) {
  const lines = [];
  lines.push(`Yesterday: ${stats.totalCalls} calls made, ${stats.answered} answered, avg motivation ${stats.avgMotivation}/100.`);
  if (stats.newDeals > 0) lines.push(`${stats.newDeals} new deal${stats.newDeals > 1 ? 's' : ''} created.`);
  if (priorities.length > 0) {
    const names = priorities.slice(0, 3).map(p => p.name).filter(Boolean).join(', ');
    lines.push(`Today's priorities: ${names || 'Review your follow-ups'}.`);
  } else {
    lines.push('No urgent follow-ups. Focus on new outreach today.');
  }
  return lines.join(' ');
}

// GET /api/briefing/today - get today's briefing (generates if not yet done)
router.get('/today', async (req, res, next) => {
  try {
    const today = todayDate();

    // Check if already generated
    const { data: existing, error: existErr } = await supabase
      .from('daily_briefings')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('briefing_date', today)
      .single();

    if (!existErr && existing) return res.json({ success: true, briefing: existing });
    if (existErr && !tableMissing(existErr) && existErr.code !== 'PGRST116') throw existErr;

    // Generate on demand
    try {
      const briefing = await generateBriefingForUser(req.user.id);
      res.json({ success: true, briefing });
    } catch (genErr) {
      if (tableMissing(genErr)) return res.json({ success: true, briefing: null, note: 'Run migrations to enable daily briefings' });
      throw genErr;
    }
  } catch (err) { next(err); }
});

// GET /api/briefing/history - past briefings
router.get('/history', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('daily_briefings')
      .select('briefing_date, stats, ai_summary, delivered_at')
      .eq('user_id', req.user.id)
      .order('briefing_date', { ascending: false })
      .limit(30);

    if (error) {
      if (tableMissing(error)) return res.json({ success: true, history: [] });
      throw error;
    }
    res.json({ success: true, history: data || [] });
  } catch (err) { next(err); }
});

// POST /api/briefing/generate - manually regenerate today's briefing
router.post('/generate', async (req, res, next) => {
  try {
    const briefing = await generateBriefingForUser(req.user.id);
    res.json({ success: true, briefing });
  } catch (err) {
    if (tableMissing(err)) return res.status(503).json({ success: false, error: 'Run migrations first' });
    next(err);
  }
});

// Background: generate briefings for all active users at 8am every day
async function runDailyBriefingsForAllUsers() {
  try {
    const { data: users } = await supabase
      .from('users')
      .select('id')
      .eq('subscription_status', 'active');
    if (!users) return;
    for (const u of users) {
      try { await generateBriefingForUser(u.id); } catch { /* skip */ }
    }
    console.log(`[DailyBriefing] Generated for ${users.length} users`);
  } catch (err) {
    console.error('[DailyBriefing] Error:', err.message);
  }
}

function schedule8amDaily() {
  const now  = new Date();
  const next = new Date(now);
  next.setHours(8, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const ms = next.getTime() - now.getTime();
  setTimeout(() => {
    runDailyBriefingsForAllUsers();
    setInterval(runDailyBriefingsForAllUsers, 24 * 60 * 60 * 1000);
  }, ms);
  console.log(`[DailyBriefing] Scheduled - next run in ${Math.round(ms / 60000)} min`);
}

// Start scheduler
schedule8amDaily();

module.exports = router;
