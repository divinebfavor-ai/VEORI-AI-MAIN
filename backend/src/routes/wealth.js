// ─── Wealth Playbook Routes ────────────────────────────────────────────────────
const express      = require('express');
const supabase     = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const {
  generatePlaybook,
  updateScore,
  getOrCreateScore,
  getTier,
  calculateProjections,
  STRATEGIES,
  SCORE_ACTIONS,
  EXAMPLE_FEED,
} = require('../services/wealthService');

const router = express.Router();
router.use(requireAuth);

// ─── POST /api/wealth/assessment ──────────────────────────────────────────────
// Save assessment + trigger AI playbook generation
router.post('/assessment', async (req, res) => {
  try {
    const userId = req.user.id;
    const { home_ownership, equity_position, debt_situation, real_estate_goal, experience_level } = req.body;

    // Upsert assessment
    const { data: assessment, error: aErr } = await supabase
      .from('wealth_assessments')
      .upsert({ user_id: userId, home_ownership, equity_position, debt_situation, real_estate_goal, experience_level, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
      .select()
      .single();

    if (aErr) {
      // Table may not exist yet — gracefully continue with playbook generation
      console.warn('[Wealth] Assessment table error (run migration):', aErr.message);
    }

    // Generate playbook via AI
    const playbook = await generatePlaybook({ home_ownership, equity_position, debt_situation, real_estate_goal, experience_level });

    // Store playbook
    const { data: stored, error: pErr } = await supabase
      .from('wealth_playbooks')
      .upsert({ user_id: userId, ...playbook, strategies: JSON.stringify(playbook.strategies), wealth_projection: JSON.stringify(playbook.wealth_projection), generated_at: new Date().toISOString() }, { onConflict: 'user_id' })
      .select()
      .single();

    if (pErr) console.warn('[Wealth] Playbook table error (run migration):', pErr.message);

    // Initialize wealth score with assessment completion bonus
    await updateScore(userId, 'assessment_completed').catch(() => {});

    res.json({ success: true, playbook });
  } catch (err) {
    console.error('[Wealth] Assessment error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/wealth/playbook/:userId ─────────────────────────────────────────
router.get('/playbook/:userId', async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: playbook } = await supabase
      .from('wealth_playbooks')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!playbook) return res.json({ success: true, playbook: null });

    // Parse JSON fields if stored as strings
    const parsed = {
      ...playbook,
      strategies: typeof playbook.strategies === 'string' ? JSON.parse(playbook.strategies) : playbook.strategies,
      wealth_projection: typeof playbook.wealth_projection === 'string' ? JSON.parse(playbook.wealth_projection) : playbook.wealth_projection,
    };

    res.json({ success: true, playbook: parsed });
  } catch (err) {
    console.error('[Wealth] Get playbook error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/wealth/regenerate/:userId ──────────────────────────────────────
router.post('/regenerate/:userId', async (req, res) => {
  try {
    const userId = req.user.id;

    // Fetch existing assessment
    const { data: assessment } = await supabase
      .from('wealth_assessments')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!assessment) return res.status(404).json({ success: false, error: 'No assessment found. Complete the assessment first.' });

    const playbook = await generatePlaybook(assessment);

    await supabase
      .from('wealth_playbooks')
      .upsert({ user_id: userId, ...playbook, strategies: JSON.stringify(playbook.strategies), wealth_projection: JSON.stringify(playbook.wealth_projection), generated_at: new Date().toISOString() }, { onConflict: 'user_id' })
      .select();

    res.json({ success: true, playbook });
  } catch (err) {
    console.error('[Wealth] Regenerate error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/wealth/strategies ───────────────────────────────────────────────
router.get('/strategies', async (_req, res) => {
  try {
    res.json({ success: true, strategies: Object.values(STRATEGIES) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/wealth/strategy/:id ─────────────────────────────────────────────
router.get('/strategy/:id', async (req, res) => {
  try {
    const strategy = STRATEGIES[req.params.id];
    if (!strategy) return res.status(404).json({ success: false, error: 'Strategy not found' });
    res.json({ success: true, strategy });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/wealth/score/:userId ────────────────────────────────────────────
router.get('/score/:userId', async (req, res) => {
  try {
    const userId = req.user.id;
    const score  = await getOrCreateScore(userId);
    const tier   = getTier(score?.score || 0);

    const availableActions = Object.entries(SCORE_ACTIONS)
      .filter(([key]) => !(score?.actions_completed || []).includes(key))
      .map(([key, pts]) => ({ action: key, points: pts }));

    res.json({ success: true, score: score?.score || 0, tier, actions_completed: score?.actions_completed || [], available_actions: availableActions });
  } catch (err) {
    console.error('[Wealth] Score error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/wealth/score/update ────────────────────────────────────────────
router.post('/score/update', async (req, res) => {
  try {
    const userId     = req.user.id;
    const { action_type } = req.body;

    const updated = await updateScore(userId, action_type);
    res.json({ success: true, score: updated?.score || 0, tier: getTier(updated?.score || 0) });
  } catch (err) {
    console.error('[Wealth] Score update error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/wealth/calculator ──────────────────────────────────────────────
router.post('/calculator', async (req, res) => {
  try {
    const userId  = req.user.id;
    const inputs  = req.body;
    const results = calculateProjections(inputs);

    // Store session for analytics (non-blocking)
    supabase.from('wealth_calculator_sessions').insert({
      user_id: userId,
      ...inputs,
      heloc_potential: results.heloc_potential,
      projection_data: results,
    }).then().catch(() => {});

    // Award score points for completing the calculator
    updateScore(userId, 'calculator_completed').catch(() => {});

    res.json({ success: true, results });
  } catch (err) {
    console.error('[Wealth] Calculator error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/wealth/feed ─────────────────────────────────────────────────────
router.get('/feed', async (_req, res) => {
  try {
    const { data: realItems } = await supabase
      .from('elite_moves_feed')
      .select('*')
      .eq('is_example', false)
      .order('created_at', { ascending: false })
      .limit(20);

    const items = realItems?.length ? realItems : EXAMPLE_FEED;
    res.json({ success: true, feed: items, using_examples: !realItems?.length });
  } catch (err) {
    // Return example data if table doesn't exist yet
    res.json({ success: true, feed: EXAMPLE_FEED, using_examples: true });
  }
});

// ─── POST /api/wealth/strategy/progress ───────────────────────────────────────
router.post('/strategy/progress', async (req, res) => {
  try {
    const userId = req.user.id;
    const { strategy_id, status } = req.body;

    const { data, error } = await supabase
      .from('strategy_progress')
      .upsert({
        user_id: userId, strategy_id, status,
        started_at: status === 'in_progress' ? new Date().toISOString() : undefined,
        completed_at: status === 'completed' ? new Date().toISOString() : undefined,
      }, { onConflict: 'user_id,strategy_id' })
      .select()
      .single();

    if (error) console.warn('[Wealth] Progress table error:', error.message);

    // Award points for reading a strategy
    if (status === 'viewed') await updateScore(userId, 'strategy_read').catch(() => {});

    res.json({ success: true, progress: data });
  } catch (err) {
    console.error('[Wealth] Progress error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/wealth/assessment/check ─────────────────────────────────────────
// Check if user has completed assessment
router.get('/assessment/check', async (req, res) => {
  try {
    const userId = req.user.id;
    const { data } = await supabase.from('wealth_assessments').select('assessment_id').eq('user_id', userId).single();
    res.json({ success: true, has_assessment: !!data });
  } catch (err) {
    res.json({ success: true, has_assessment: false });
  }
});

module.exports = router;
