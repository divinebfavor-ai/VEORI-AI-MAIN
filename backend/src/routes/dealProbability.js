/**
 * /api/deal-probability
 * Multi-factor deal probability score (0-100) per lead
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

/**
 * Score a lead based on available data.
 * Returns 0-100 and a breakdown of factors.
 */
function calculateDealProbability(lead, callCount, latestSentiment) {
  let score = 0;
  const factors = {};

  // 1. Motivation score (0-40 pts) - most important signal
  const motivation = Number(lead.motivation_score) || 0;
  const motivationPts = Math.round((motivation / 100) * 40);
  score += motivationPts;
  factors.motivation_score = { value: motivation, points: motivationPts, max: 40 };

  // 2. Equity percentage (0-20 pts)
  const equity   = Number(lead.estimated_equity) || 0;
  const value    = Number(lead.estimated_value) || 1;
  const equityPct = Math.min(100, Math.round((equity / value) * 100));
  const equityPts = equityPct >= 50 ? 20 : equityPct >= 30 ? 12 : equityPct >= 15 ? 6 : 0;
  score += equityPts;
  factors.equity_percentage = { value: equityPct, points: equityPts, max: 20 };

  // 3. Contact attempts (0-15 pts) - diminishing returns after 3
  const attempts = Math.min(callCount, 10);
  const attemptPts = attempts >= 3 ? 15 : attempts === 2 ? 10 : attempts === 1 ? 5 : 0;
  score += attemptPts;
  factors.contact_attempts = { value: callCount, points: attemptPts, max: 15 };

  // 4. Sentiment (0-15 pts)
  const sentimentMap = { Motivated: 15, Neutral: 8, Hesitant: 4, Cold: 1, Hostile: 0 };
  const sentimentPts = sentimentMap[latestSentiment] ?? 5;
  score += sentimentPts;
  factors.sentiment = { value: latestSentiment || 'Unknown', points: sentimentPts, max: 15 };

  // 5. Pipeline stage (0-10 pts)
  const stageMap = { new: 0, contacted: 3, interested: 6, offer_made: 9, under_contract: 10 };
  const stagePts = stageMap[lead.status] ?? 2;
  score += stagePts;
  factors.pipeline_stage = { value: lead.status, points: stagePts, max: 10 };

  // Clamp 0-100
  score = Math.min(100, Math.max(0, score));
  const color = score >= 61 ? 'green' : score >= 31 ? 'yellow' : 'red';

  return { score, color, factors };
}

// GET /api/deal-probability/:leadId - get current score for a lead
router.get('/:leadId', async (req, res, next) => {
  try {
    // Try cached score first
    const { data: cached, error: cacheErr } = await supabase
      .from('deal_probability_scores')
      .select('*')
      .eq('lead_id', req.params.leadId)
      .single();

    if (!cacheErr && cached) {
      return res.json({ success: true, ...cached });
    }
    if (cacheErr && !tableMissing(cacheErr) && cacheErr.code !== 'PGRST116') throw cacheErr;

    // Compute on the fly if not cached
    const { data: lead } = await supabase.from('leads').select('*').eq('id', req.params.leadId).single();
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

    const { count: callCount } = await supabase.from('calls').select('*', { count: 'exact', head: true }).eq('lead_id', req.params.leadId);
    const { data: sentimentData } = await supabase.from('sentiment_events').select('sentiment').eq('lead_id', req.params.leadId).order('created_at', { ascending: false }).limit(1);
    const latestSentiment = sentimentData?.[0]?.sentiment;

    const { score, color, factors } = calculateDealProbability(lead, callCount || 0, latestSentiment);
    res.json({ success: true, lead_id: req.params.leadId, score, color, factors, cached: false });
  } catch (err) { next(err); }
});

// POST /api/deal-probability/:leadId/calculate - recalculate and store score
router.post('/:leadId/calculate', async (req, res, next) => {
  try {
    const { data: lead } = await supabase.from('leads').select('*').eq('id', req.params.leadId).single();
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

    const { count: callCount } = await supabase.from('calls').select('*', { count: 'exact', head: true }).eq('lead_id', req.params.leadId);
    const { data: sentimentData } = await supabase.from('sentiment_events').select('sentiment').eq('lead_id', req.params.leadId).order('created_at', { ascending: false }).limit(1);
    const latestSentiment = sentimentData?.[0]?.sentiment;

    const { score, color, factors } = calculateDealProbability(lead, callCount || 0, latestSentiment);

    const { data: stored, error } = await supabase
      .from('deal_probability_scores')
      .upsert({
        lead_id:       req.params.leadId,
        user_id:       req.user.id,
        score,
        color,
        factors,
        calculated_at: new Date().toISOString(),
        updated_at:    new Date().toISOString(),
      }, { onConflict: 'lead_id' })
      .select().single();

    if (error) {
      if (tableMissing(error)) return res.status(503).json({ success: false, error: 'Run migrations first' });
      throw error;
    }
    res.json({ success: true, ...stored });
  } catch (err) { next(err); }
});

// GET /api/deal-probability/user/top - top leads by probability score
router.get('/user/top', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);

    const { data, error } = await supabase
      .from('deal_probability_scores')
      .select('*, leads(first_name, last_name, property_address, phone, status, motivation_score)')
      .eq('user_id', req.user.id)
      .order('score', { ascending: false })
      .limit(limit);

    if (error) {
      if (tableMissing(error)) return res.json({ success: true, leads: [] });
      throw error;
    }
    res.json({ success: true, leads: data || [] });
  } catch (err) { next(err); }
});

// POST /api/deal-probability/user/recalculate-all - background recalc for all user leads
router.post('/user/recalculate-all', async (req, res, next) => {
  try {
    const { data: leads } = await supabase.from('leads').select('*').eq('user_id', req.user.id).limit(500);
    if (!leads || leads.length === 0) return res.json({ success: true, updated: 0 });

    let updated = 0;
    for (const lead of leads) {
      try {
        const { count: callCount } = await supabase.from('calls').select('*', { count: 'exact', head: true }).eq('lead_id', lead.id);
        const { data: sd } = await supabase.from('sentiment_events').select('sentiment').eq('lead_id', lead.id).order('created_at', { ascending: false }).limit(1);
        const { score, color, factors } = calculateDealProbability(lead, callCount || 0, sd?.[0]?.sentiment);
        await supabase.from('deal_probability_scores').upsert({
          lead_id: lead.id, user_id: req.user.id, score, color, factors,
          calculated_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }, { onConflict: 'lead_id' });
        updated++;
      } catch { /* skip individual failures */ }
    }
    res.json({ success: true, updated, total: leads.length });
  } catch (err) { next(err); }
});

module.exports = router;
