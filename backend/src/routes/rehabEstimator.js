/**
 * Feature 18 — Rehab Cost Estimator
 * Routes: GET /api/rehab/items, POST /api/rehab/estimate, GET /api/rehab/history/:leadId,
 *         POST /api/rehab/estimate/:leadId/save
 */
const router  = require('express').Router();
const { auth } = require('../middleware/auth');
const supabase = require('../config/supabase');
const { REPAIR_ITEMS, calculateRepairEstimate, calculateScenarios, estimateFromDescription } = require('../services/repairEstimator');

router.use(auth);

// GET /api/rehab/items — return repair item catalog
router.get('/items', async (_req, res) => {
  try {
    const items = Object.entries(REPAIR_ITEMS).map(([key, val]) => ({
      key,
      label: val.label,
      options: val.options,
    }));
    res.json({ success: true, items });
  } catch (err) {
    console.error('[Rehab] items error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load repair items' });
  }
});

// POST /api/rehab/estimate — calculate estimate from selected items
router.post('/estimate', async (req, res) => {
  try {
    const { items, arv, asking_price, description } = req.body;

    let repairItems = items || [];

    // If no items selected but description provided, auto-estimate
    let autoEstimate = null;
    if (repairItems.length === 0 && description) {
      autoEstimate = estimateFromDescription(description);
      return res.json({
        success: true,
        auto_estimate: autoEstimate,
        message: 'Auto-estimated from description. Select specific items for a detailed breakdown.',
      });
    }

    const { low, high, midpoint, breakdown } = calculateRepairEstimate(repairItems);

    let scenarios = null;
    if (arv) {
      scenarios = calculateScenarios(arv, midpoint);
    }

    // Quick profit calc if asking_price provided
    let profitSnapshot = null;
    if (arv && asking_price) {
      const mao = Math.round(arv * 0.70 - midpoint);
      profitSnapshot = {
        arv,
        repair_midpoint: midpoint,
        mao,
        asking_price,
        spread: mao - asking_price,
        deal_quality: mao >= asking_price
          ? (mao - asking_price >= 20000 ? 'Excellent' : 'Good')
          : 'Below MAO',
      };
    }

    res.json({
      success: true,
      estimate: { low, high, midpoint, breakdown },
      scenarios,
      profit_snapshot: profitSnapshot,
    });
  } catch (err) {
    console.error('[Rehab] estimate error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to calculate estimate' });
  }
});

// POST /api/rehab/estimate/:leadId/save — save to profit_calculations table
router.post('/estimate/:leadId/save', async (req, res) => {
  try {
    const { leadId } = req.params;
    const { items, arv, asking_price } = req.body;

    if (!arv) return res.status(400).json({ success: false, error: 'ARV required to save' });

    const { low, high, midpoint, breakdown } = calculateRepairEstimate(items || []);
    const scenarios = calculateScenarios(arv, midpoint);
    const mao = scenarios.moderate.mao;

    const { data, error } = await supabase
      .from('profit_calculations')
      .upsert({
        user_id:         req.user.id,
        lead_id:         leadId,
        arv,
        repair_low:      low,
        repair_high:     high,
        repair_midpoint: midpoint,
        mao,
        asking_price:    asking_price || null,
        assignment_fee:  asking_price ? Math.max(0, mao - asking_price) : null,
        net_profit:      asking_price ? Math.max(0, mao - asking_price) : null,
        roi_pct:         asking_price && asking_price > 0 ? Math.round(((mao - asking_price) / asking_price) * 100) : null,
        scenarios,
        repair_items:    breakdown,
      }, { onConflict: 'lead_id' })
      .select().single();

    if (error) throw error;
    res.json({ success: true, calculation: data });
  } catch (err) {
    console.error('[Rehab] save error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to save estimate' });
  }
});

// GET /api/rehab/history/:leadId — saved calcs for a lead
router.get('/history/:leadId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('profit_calculations')
      .select('*')
      .eq('lead_id', req.params.leadId)
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ success: true, calculations: data || [] });
  } catch (err) {
    console.error('[Rehab] history error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load history' });
  }
});

module.exports = router;
