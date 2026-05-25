/**
 * Feature 13 — Smart List Prioritization Engine
 * Routes: GET /api/smart-list/prioritized, POST /api/smart-list/save, GET /api/smart-list/saved
 */
const router  = require('express').Router();
const { auth } = require('../middleware/auth');
const supabase = require('../config/supabase');

router.use(auth);

// GET /api/smart-list/prioritized — rank all leads by composite score
router.get('/prioritized', async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: leads, error } = await supabase
      .from('leads')
      .select(`
        id, first_name, last_name, phone, property_address, city, state, zip,
        motivation_score, equity_percent, status, pipeline_stage,
        last_contact_date, created_at, call_count,
        seller_trust_scores(score, recommendation),
        deal_probability_scores(score)
      `)
      .eq('user_id', userId)
      .not('status', 'eq', 'closed');

    if (error) throw error;

    const scored = (leads || []).map(lead => {
      const motivation = lead.motivation_score || 0;
      const equity     = Math.min(lead.equity_percent || 0, 100);
      const trust      = lead.seller_trust_scores?.[0]?.score || 50;
      const dealProb   = lead.deal_probability_scores?.[0]?.score || 0;
      const calls      = Math.min(lead.call_count || 0, 10);

      // Days since last contact (recency penalty)
      const daysSince = lead.last_contact_date
        ? Math.floor((Date.now() - new Date(lead.last_contact_date)) / 86400000)
        : 999;
      const recencyBonus = daysSince <= 3 ? 10 : daysSince <= 7 ? 5 : 0;
      const callBonus    = calls >= 3 ? 8 : calls >= 1 ? 4 : 0;

      const composite = Math.round(
        motivation * 0.35 +
        equity     * 0.25 +
        trust      * 0.15 +
        dealProb   * 0.15 +
        recencyBonus +
        callBonus
      );

      return {
        ...lead,
        priority_score: composite,
        priority_tier: composite >= 70 ? 'A' : composite >= 50 ? 'B' : composite >= 30 ? 'C' : 'D',
        days_since_contact: daysSince === 999 ? null : daysSince,
      };
    }).sort((a, b) => b.priority_score - a.priority_score);

    res.json({ success: true, leads: scored, total: scored.length });
  } catch (err) {
    console.error('[SmartList] prioritized error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load prioritized list' });
  }
});

// GET /api/smart-list/saved — list saved smart filters
router.get('/saved', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('smart_lists')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ success: true, lists: data || [] });
  } catch (err) {
    console.error('[SmartList] saved error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load saved lists' });
  }
});

// POST /api/smart-list/save — save a named filter
router.post('/save', async (req, res) => {
  try {
    const { name, filters, sort_by } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'Name required' });

    const { data, error } = await supabase
      .from('smart_lists')
      .insert({ user_id: req.user.id, name, filters: filters || {}, sort_by: sort_by || 'score' })
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, list: data });
  } catch (err) {
    console.error('[SmartList] save error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to save list' });
  }
});

// DELETE /api/smart-list/:id — remove saved list
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('smart_lists')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('[SmartList] delete error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to delete list' });
  }
});

module.exports = router;
