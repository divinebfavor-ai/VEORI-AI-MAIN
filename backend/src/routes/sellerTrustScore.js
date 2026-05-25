/**
 * Feature 19 — Seller Trust Score
 * Routes: GET /api/seller-trust/:leadId, POST /api/seller-trust/:leadId/calculate,
 *         GET /api/seller-trust/user/top
 */
const router  = require('express').Router();
const { auth } = require('../middleware/auth');
const supabase = require('../config/supabase');

router.use(auth);

function computeTrustScore(lead, calls, sentiment) {
  let score = 50; // baseline
  const factors = {};

  // 1. Motivation score alignment (is it consistently high?)
  const motivation = lead.motivation_score || 0;
  if (motivation >= 80) { score += 20; factors.motivation = '+20 (very motivated)'; }
  else if (motivation >= 60) { score += 10; factors.motivation = '+10 (motivated)'; }
  else if (motivation < 30) { score -= 15; factors.motivation = '-15 (low motivation)'; }
  else { factors.motivation = '0 (moderate)'; }

  // 2. Contact consistency — how many times answered out of attempts
  const totalCalls = calls?.length || 0;
  const answered   = calls?.filter(c => ['completed','answered'].includes(c.status)).length || 0;
  const answerRate = totalCalls > 0 ? answered / totalCalls : 0;
  if (answerRate >= 0.6) { score += 15; factors.contact = '+15 (answers reliably)'; }
  else if (answerRate >= 0.3) { score += 5;  factors.contact = '+5 (inconsistent)'; }
  else if (totalCalls > 5) { score -= 10;   factors.contact = '-10 (rarely answers)'; }
  else { factors.contact = '0 (few calls)'; }

  // 3. Positive sentiment signals
  const positiveEvents = sentiment?.filter(s => s.sentiment === 'positive').length || 0;
  const negativeEvents = sentiment?.filter(s => s.sentiment === 'negative').length || 0;
  if (positiveEvents >= 3) { score += 10; factors.sentiment = '+10 (positive tone)'; }
  else if (negativeEvents > positiveEvents) { score -= 10; factors.sentiment = '-10 (negative tone)'; }
  else { factors.sentiment = '0 (neutral)'; }

  // 4. Lead age — older uncontacted leads are riskier
  const createdDays = lead.created_at
    ? Math.floor((Date.now() - new Date(lead.created_at)) / 86400000)
    : 0;
  if (createdDays > 180) { score -= 10; factors.age = '-10 (stale lead)'; }
  else if (createdDays <= 14) { score += 5; factors.age = '+5 (fresh lead)'; }
  else { factors.age = '0'; }

  // 5. Equity — more equity = more motivated to sell
  const equity = lead.equity_percent || 0;
  if (equity >= 60) { score += 5; factors.equity = '+5 (high equity)'; }
  else if (equity < 10) { score -= 5; factors.equity = '-5 (low equity)'; }
  else { factors.equity = '0'; }

  score = Math.max(0, Math.min(100, score));

  const recommendation = score >= 75
    ? 'High trust — push for appointment now'
    : score >= 55
    ? 'Moderate trust — continue nurturing'
    : score >= 35
    ? 'Low trust — soften approach, build rapport'
    : 'Very low trust — consider removing from active pipeline';

  return { score, factors, recommendation };
}

// GET /api/seller-trust/:leadId
router.get('/:leadId', async (req, res) => {
  try {
    const { data: existing } = await supabase
      .from('seller_trust_scores')
      .select('*')
      .eq('lead_id', req.params.leadId)
      .eq('user_id', req.user.id)
      .single();

    if (existing) return res.json({ success: true, trust: existing });

    res.json({ success: true, trust: null });
  } catch (err) {
    console.error('[SellerTrust] get error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load trust score' });
  }
});

// POST /api/seller-trust/:leadId/calculate
router.post('/:leadId/calculate', async (req, res) => {
  try {
    const { leadId } = req.params;

    const [{ data: lead }, { data: calls }, { data: sentiment }] = await Promise.all([
      supabase.from('leads').select('*').eq('id', leadId).eq('user_id', req.user.id).single(),
      supabase.from('calls').select('status').eq('lead_id', leadId).eq('user_id', req.user.id),
      supabase.from('sentiment_events').select('sentiment').eq('lead_id', leadId).eq('user_id', req.user.id),
    ]);

    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

    const { score, factors, recommendation } = computeTrustScore(lead, calls || [], sentiment || []);

    const { data, error } = await supabase
      .from('seller_trust_scores')
      .upsert({
        user_id:        req.user.id,
        lead_id:        leadId,
        score,
        factors,
        recommendation,
        calculated_at:  new Date().toISOString(),
      }, { onConflict: 'lead_id' })
      .select().single();

    if (error) throw error;
    res.json({ success: true, trust: data });
  } catch (err) {
    console.error('[SellerTrust] calculate error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to calculate trust score' });
  }
});

// GET /api/seller-trust/user/top — top trusted leads
router.get('/user/top', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('seller_trust_scores')
      .select('*, leads(first_name, last_name, phone, property_address, motivation_score)')
      .eq('user_id', req.user.id)
      .order('score', { ascending: false })
      .limit(20);

    if (error) throw error;
    res.json({ success: true, top: data || [] });
  } catch (err) {
    console.error('[SellerTrust] top error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load top trusted leads' });
  }
});

module.exports = router;
