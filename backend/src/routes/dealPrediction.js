/**
 * /api/deal-prediction
 * Deal Prediction Engine — weekly top-10 leads most likely to close
 * NEW FILE — does not modify any existing routes
 */
const express  = require('express');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function tableMissing(err) {
  return err?.code === 'PGRST205' || (err?.message || '').includes('does not exist');
}

function getMondayOfWeek(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

function scoreLead(lead, callCount, daysSinceContact) {
  let score = 0;

  // Motivation score (0-40)
  score += Math.round(((lead.motivation_score || 0) / 100) * 40);

  // Pipeline stage (0-20)
  const stages = { offer_made: 20, interested: 14, contacted: 8, new: 2 };
  score += stages[lead.status] || 0;

  // Recency (0-20) — contacted recently scores higher
  if (daysSinceContact <= 1) score += 20;
  else if (daysSinceContact <= 3) score += 15;
  else if (daysSinceContact <= 7) score += 10;
  else if (daysSinceContact <= 14) score += 5;

  // Engagement (0-20) — more calls = more engaged
  score += Math.min(callCount * 4, 20);

  return Math.min(100, Math.max(0, score));
}

async function generateWeeklyPredictions(userId) {
  const weekStart = getMondayOfWeek();

  // Check if already generated this week
  const { data: existing } = await supabase
    .from('weekly_predictions')
    .select('id')
    .eq('user_id', userId)
    .eq('week_start', weekStart)
    .limit(1);

  if (existing && existing.length > 0) return { already_exists: true, week_start: weekStart };

  // Fetch active leads
  const { data: leads } = await supabase
    .from('leads')
    .select('*')
    .eq('user_id', userId)
    .not('status', 'in', '(closed,dnc,under_contract)')
    .gte('motivation_score', 30)
    .order('motivation_score', { ascending: false })
    .limit(200);

  if (!leads || leads.length === 0) return { generated: 0, week_start: weekStart };

  // Score each lead
  const scored = [];
  for (const lead of leads) {
    const { count: callCount } = await supabase
      .from('calls').select('*', { count: 'exact', head: true }).eq('lead_id', lead.id);

    const lastContact = lead.last_call_date ? new Date(lead.last_call_date) : null;
    const daysSinceContact = lastContact
      ? Math.floor((Date.now() - lastContact.getTime()) / (1000 * 60 * 60 * 24))
      : 999;

    const score = scoreLead(lead, callCount || 0, daysSinceContact);
    const reasoning = buildReasoning(lead, callCount || 0, daysSinceContact);
    scored.push({ lead, score, reasoning });
  }

  // Take top 10
  scored.sort((a, b) => b.score - a.score);
  const top10 = scored.slice(0, 10);

  // Store predictions
  const inserts = top10.map((item, i) => ({
    user_id:         userId,
    week_start:      weekStart,
    lead_id:         item.lead.id,
    rank:            i + 1,
    predicted_score: item.score,
    reasoning:       item.reasoning,
    status:          'active',
  }));

  const { error } = await supabase.from('weekly_predictions').insert(inserts);
  if (error) throw error;

  return { generated: top10.length, week_start: weekStart };
}

function buildReasoning(lead, callCount, daysSinceContact) {
  const parts = [];
  if ((lead.motivation_score || 0) >= 70) parts.push(`High motivation score (${lead.motivation_score}/100)`);
  if (lead.status === 'offer_made') parts.push('Offer already made — follow-up could close');
  if (lead.status === 'interested') parts.push('Expressed interest — ready for offer');
  if (callCount >= 3) parts.push(`${callCount} touch points — high engagement`);
  if (daysSinceContact <= 3) parts.push('Recently contacted — stay on their radar');
  if (!parts.length) parts.push('Strong overall profile');
  return parts.join('. ');
}

// GET /api/deal-prediction/this-week — get this week's focus list
router.get('/this-week', async (req, res, next) => {
  try {
    const weekStart = getMondayOfWeek();
    const { data, error } = await supabase
      .from('weekly_predictions')
      .select('*, leads(first_name, last_name, phone, property_address, motivation_score, status, estimated_equity, estimated_value, last_call_date)')
      .eq('user_id', req.user.id)
      .eq('week_start', weekStart)
      .eq('status', 'active')
      .order('rank', { ascending: true });

    if (error) {
      if (tableMissing(error)) return res.json({ success: true, predictions: [], week_start: weekStart, generated: false });
      throw error;
    }
    res.json({ success: true, predictions: data || [], week_start: weekStart, generated: data?.length > 0 });
  } catch (err) { next(err); }
});

// GET /api/deal-prediction/history — past weekly predictions
router.get('/history', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('weekly_predictions')
      .select('week_start, rank, predicted_score, status, reasoning, leads(first_name, last_name, property_address)')
      .eq('user_id', req.user.id)
      .order('week_start', { ascending: false })
      .order('rank', { ascending: true })
      .limit(100);

    if (error) {
      if (tableMissing(error)) return res.json({ success: true, history: [] });
      throw error;
    }
    res.json({ success: true, history: data || [] });
  } catch (err) { next(err); }
});

// POST /api/deal-prediction/generate — manually trigger prediction generation
router.post('/generate', async (req, res, next) => {
  try {
    const result = await generateWeeklyPredictions(req.user.id);
    res.json({ success: true, ...result });
  } catch (err) {
    if (tableMissing(err)) return res.status(503).json({ success: false, error: 'Run migrations first' });
    next(err);
  }
});

// PUT /api/deal-prediction/:id/close — mark a predicted lead as closed (won/missed)
router.put('/:id/close', async (req, res, next) => {
  try {
    const { status } = req.body; // 'closed' or 'missed'
    if (!['closed', 'missed'].includes(status)) return res.status(400).json({ success: false, error: 'status must be closed or missed' });
    await supabase.from('weekly_predictions').update({ status }).eq('id', req.params.id).eq('user_id', req.user.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// Background: run every Monday at 8am for all users
async function runWeeklyPredictionsForAllUsers() {
  try {
    const { data: users } = await supabase.from('users').select('id').eq('subscription_status', 'active');
    if (!users) return;
    for (const u of users) {
      try { await generateWeeklyPredictions(u.id); } catch { /* skip */ }
    }
    console.log(`[WeeklyPredictions] Generated for ${users.length} users`);
  } catch (err) {
    console.error('[WeeklyPredictions] Error:', err.message);
  }
}

// Schedule Monday 8am runs
function scheduleMondayRun() {
  const now  = new Date();
  const next = new Date(now);
  next.setDate(now.getDate() + ((1 + 7 - now.getDay()) % 7 || 7));
  next.setHours(8, 0, 0, 0);
  const ms = next.getTime() - now.getTime();
  setTimeout(() => {
    runWeeklyPredictionsForAllUsers();
    setInterval(runWeeklyPredictionsForAllUsers, 7 * 24 * 60 * 60 * 1000);
  }, ms);
  console.log(`[WeeklyPredictions] Scheduled — next run in ${Math.round(ms / 3600000)}h`);
}

// Start scheduler when this module loads
scheduleMondayRun();

module.exports = router;
