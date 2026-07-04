/**
 * Feature 21 - Deal Profit Calculator
 * Routes: POST /api/profit-calc/calculate, GET /api/profit-calc/history,
 *         GET /api/profit-calc/:leadId, DELETE /api/profit-calc/:id
 */
const router  = require('express').Router();
const { requireAuth: auth } = require('../middleware/auth');
const supabase = require('../config/supabase');
const { calculateRepairEstimate, calculateScenarios } = require('../services/repairEstimator');
const { calculateCreative } = require('../services/creativeFinanceCalc');

let compsService;
try { compsService = require('../services/compsService'); } catch {}

router.use(auth);

// POST /api/profit-calc/calculate
router.post('/calculate', async (req, res) => {
  try {
    const {
      lead_id,
      property_address,
      arv,              // manual ARV override
      asking_price,
      repair_items,     // [{ category, option, quantity }]
      closing_costs_pct = 2,
      holding_costs    = 0,
      assignment_fee_target = 10000,
      fetch_comps      = false,
      strategy,         // optional: cash (default) | subject_to | seller_finance | lease_option
      strategy_inputs,  // optional creative-finance terms (mortgage_balance, rate, down_percent, etc.)
    } = req.body;

    // Step 1: Determine ARV
    let resolvedARV = arv;
    let compsData = null;

    if ((!resolvedARV || resolvedARV === 0) && fetch_comps && property_address && compsService) {
      try {
        const comps = await compsService.lookupPropertyValue(property_address);
        resolvedARV = comps?.arv || comps?.estimated_value || null;
        compsData = comps;
      } catch (e) {
        console.warn('[ProfitCalc] comps lookup failed:', e.message);
      }
    }

    if (!resolvedARV) {
      return res.status(400).json({ success: false, error: 'ARV required. Provide arv or enable fetch_comps with a valid address.' });
    }

    // Step 2: Repair estimate
    const { low: repair_low, high: repair_high, midpoint: repair_midpoint, breakdown } =
      calculateRepairEstimate(repair_items || []);

    // Step 3: Scenarios
    const scenarios = calculateScenarios(resolvedARV, repair_midpoint);

    // Step 4: Target profit
    const closingCosts = Math.round(resolvedARV * (closing_costs_pct / 100));
    const mao          = scenarios.moderate.mao;
    const net_profit   = asking_price ? Math.max(0, mao - asking_price - closingCosts - holding_costs) : null;
    const roi_pct      = (asking_price && asking_price > 0)
      ? Math.round((net_profit / (asking_price + repair_midpoint + closingCosts + holding_costs)) * 100)
      : null;

    const result = {
      arv: resolvedARV,
      repair_low, repair_high, repair_midpoint,
      repair_breakdown: breakdown,
      mao, asking_price: asking_price || null,
      closing_costs: closingCosts,
      holding_costs,
      assignment_fee_target,
      net_profit,
      roi_pct,
      scenarios,
      comps: compsData,
      deal_rating: mao >= (asking_price || 0) + assignment_fee_target
        ? 'Deal ✅'
        : mao >= (asking_price || 0)
        ? 'Tight Deal ⚠️'
        : 'No Deal ❌',
    };

    // Creative-finance overlay (additive): only computed when a creative strategy is
    // requested. Cash/omitted → calculateCreative returns null → response unchanged.
    const creative = calculateCreative(strategy, {
      arv: resolvedARV,
      rehab: repair_midpoint,
      ...(strategy_inputs || {}),
    });
    if (creative) result.creative = creative;

    // Save if lead_id provided
    if (lead_id) {
      try {
        await supabase.from('profit_calculations').upsert({
          user_id: req.user.id, lead_id,
          arv: resolvedARV, repair_low, repair_high, repair_midpoint,
          mao, asking_price: asking_price || null,
          assignment_fee: net_profit,
          net_profit, roi_pct,
          scenarios, repair_items: breakdown,
        }, { onConflict: 'lead_id' });
      } catch {}
    }

    res.json({ success: true, result });
  } catch (err) {
    console.error('[ProfitCalc] calculate error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to calculate profit' });
  }
});

// GET /api/profit-calc/history - all saved calculations
router.get('/history', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('profit_calculations')
      .select('*, leads(first_name, last_name, property_address)')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    res.json({ success: true, calculations: data || [] });
  } catch (err) {
    console.error('[ProfitCalc] history error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load history' });
  }
});

// GET /api/profit-calc/:leadId - saved calc for a specific lead
router.get('/:leadId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('profit_calculations')
      .select('*')
      .eq('lead_id', req.params.leadId)
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    res.json({ success: true, calculation: data || null });
  } catch (err) {
    console.error('[ProfitCalc] get error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load calculation' });
  }
});

module.exports = router;
