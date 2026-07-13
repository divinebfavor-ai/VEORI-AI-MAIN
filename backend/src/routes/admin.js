/**
 * Admin Dashboard API
 * Routes:
 *   GET /api/admin/stats        - overview stats
 *   GET /api/admin/users        - all users with geo + plan data
 *   GET /api/admin/countries    - users by country
 *   GET /api/admin/revenue      - revenue breakdown
 *   GET /api/admin/legacy-plans - subscribers still on retired tiers (read-only)
 */

const router   = require('express').Router();
const { requireAuth: auth } = require('../middleware/auth');
const supabase = require('../config/supabase');
const audit    = require('../services/auditLog');
const accountReview = require('../services/accountReviewService');

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'divineqflash@gmail.com').split(',').map(e => e.trim());

// Admin guard
router.use(auth, (req, res, next) => {
  if (!ADMIN_EMAILS.includes(req.user.email)) {
    return res.status(403).json({ success: false, error: 'Admin access only' });
  }
  audit.log({ userId: req.user.id, action: audit.ACTIONS.ADMIN_ACCESS, req,
    metadata: { path: req.path, method: req.method } });
  next();
});

// GET /api/admin/stats
router.get('/stats', async (req, res) => {
  try {
    const now   = new Date();
    const day   = new Date(now - 24*60*60*1000).toISOString();
    const week  = new Date(now - 7*24*60*60*1000).toISOString();
    const month = new Date(now - 30*24*60*60*1000).toISOString();

    const [usersRes, activeRes, subRes, callsRes, todayRes] = await Promise.all([
      supabase.from('users').select('id', { count: 'exact' }),
      supabase.from('users').select('id', { count: 'exact' }).gte('last_seen_at', week),
      supabase.from('users').select('subscription_plan, subscription_status').eq('subscription_status', 'active'),
      supabase.from('calls').select('id', { count: 'exact' }),
      supabase.from('users').select('id', { count: 'exact' }).gte('created_at', day),
    ]);

    const subs = subRes.data || [];
    // Monthly USD by plan. New 5-plan pricing + retired tiers kept at their
    // OLD amounts so any legacy subscriber still counts correctly toward MRR.
    const planAmounts = {
      starter: 1499, solo: 2999, operator: 4999, scale: 8999, enterprise: 14999,
      founding_member: 397, growth: 999, pro: 1799, // retired - legacy MRR only
    };
    const mrr = subs.reduce((s, u) => s + (planAmounts[u.subscription_plan] || 0), 0);

    res.json({
      success: true,
      stats: {
        total_users:       usersRes.count || 0,
        new_today:         todayRes.count || 0,
        active_this_week:  activeRes.count || 0,
        paying_customers:  subs.length,
        mrr,
        total_calls:       callsRes.count || 0,
      },
    });
  } catch (err) {
    console.error('[Admin] stats error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load stats' });
  }
});

// GET /api/admin/users
router.get('/users', async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { data, error, count } = await supabase
      .from('users')
      .select('id, full_name, email, country_code, region, city, subscription_plan, subscription_status, plan, created_at, last_seen_at, referred_by', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    if (error) throw error;

    audit.log({ userId: req.user.id, action: audit.ACTIONS.ADMIN_USER_VIEW, req,
      metadata: { page, limit } });
    res.json({ success: true, users: data || [], total: count || 0, page: parseInt(page) });
  } catch (err) {
    console.error('[Admin] users error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load users' });
  }
});

// GET /api/admin/countries
router.get('/countries', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('country_code')
      .not('country_code', 'is', null);

    if (error) throw error;

    const counts = {};
    for (const u of data || []) {
      counts[u.country_code] = (counts[u.country_code] || 0) + 1;
    }

    const sorted = Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .map(([country_code, count]) => ({ country_code, count }));

    res.json({ success: true, countries: sorted });
  } catch (err) {
    console.error('[Admin] countries error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load countries' });
  }
});

// GET /api/admin/revenue
router.get('/revenue', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('subscription_plan, subscription_status')
      .eq('subscription_status', 'active');

    if (error) throw error;

    // Monthly USD by plan. New 5-plan pricing + retired tiers kept at their
    // OLD amounts so any legacy subscriber still counts correctly toward MRR.
    const planAmounts = {
      starter: 1499, solo: 2999, operator: 4999, scale: 8999, enterprise: 14999,
      founding_member: 397, growth: 999, pro: 1799, // retired - legacy MRR only
    };

    const breakdown = {};
    let mrr = 0;

    for (const u of data || []) {
      const plan   = u.subscription_plan || 'unknown';
      const amount = planAmounts[plan] || 0;
      if (!breakdown[plan]) breakdown[plan] = { count: 0, revenue: 0 };
      breakdown[plan].count++;
      breakdown[plan].revenue += amount;
      mrr += amount;
    }

    res.json({
      success: true,
      mrr,
      arr:       mrr * 12,
      breakdown: Object.entries(breakdown).map(([plan, data]) => ({ plan, ...data })),
    });
  } catch (err) {
    console.error('[Admin] revenue error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load revenue' });
  }
});

// GET /api/admin/legacy-plans
// Read-only. Lists anyone still on a RETIRED tier so they can be migrated to a
// current plan. Touches nothing - pure visibility into stranded subscribers.
router.get('/legacy-plans', async (req, res) => {
  try {
    const RETIRED = ['founding_member', 'growth', 'pro'];
    // Suggested landing tier for each retired plan (closest current equivalent).
    const MIGRATE_TO = { founding_member: 'starter', growth: 'starter', pro: 'solo' };

    const { data, error } = await supabase
      .from('users')
      .select('id, full_name, email, subscription_plan, subscription_status, monthly_dial_limit, calls_used, created_at, subscription_expires_at')
      .in('subscription_plan', RETIRED)
      .order('created_at', { ascending: true });

    if (error) throw error;

    const users = (data || []).map(u => ({
      ...u,
      suggested_plan: MIGRATE_TO[u.subscription_plan] || 'starter',
    }));

    // Count stranded users per retired tier (active subs first - they're the priority).
    const byPlan = {};
    for (const u of users) {
      const p = u.subscription_plan;
      if (!byPlan[p]) byPlan[p] = { plan: p, total: 0, active: 0, suggested_plan: MIGRATE_TO[p] || 'starter' };
      byPlan[p].total++;
      if (u.subscription_status === 'active') byPlan[p].active++;
    }

    res.json({
      success:       true,
      retired_plans: RETIRED,
      total:         users.length,
      summary:       Object.values(byPlan),
      users,
    });
  } catch (err) {
    console.error('[Admin] legacy-plans error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load legacy plans' });
  }
});

// ─── Account lifecycle (manual, admin-triggered) ─────────────────────────────

// POST /api/admin/accounts/:userId/deal-closed  { closed?: boolean }
// Manually flag (or clear) a Starter account as "deal closed". When set on a Starter
// account this creates the in-app Solo upgrade prompt. No calendar cutoff involved.
router.post('/accounts/:userId/deal-closed', async (req, res) => {
  try {
    const closed = req.body?.closed !== false; // default true; pass { closed:false } to clear
    const result = await accountReview.setDealClosed(req.params.userId, { closed, adminId: req.user.id });
    if (!result.ok) return res.status(404).json({ success: false, error: result.reason || 'user not found' });
    audit.log({ userId: req.user.id, action: audit.ACTIONS.ADMIN_ACCESS, req,
      metadata: { action: 'deal_closed', target: req.params.userId, closed, promptCreated: result.promptCreated } });
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[Admin] deal-closed error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to update deal-closed flag' });
  }
});

// POST /api/admin/engagement/scan  { dryRun?: boolean }
// Manually run the engagement scan. Flags accounts >= 3 months old with zero hot
// leads and zero responses for founder review. Never suspends or messages operators.
router.post('/engagement/scan', async (req, res) => {
  try {
    const dryRun = req.body?.dryRun === true;
    const result = await accountReview.scanEngagement({ dryRun });
    audit.log({ userId: req.user.id, action: audit.ACTIONS.ADMIN_ACCESS, req,
      metadata: { action: 'engagement_scan', dryRun, flagged: result.flagged } });
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[Admin] engagement scan error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to run engagement scan' });
  }
});

// GET /api/admin/engagement/review — accounts currently awaiting founder review.
router.get('/engagement/review', async (req, res) => {
  try {
    const accounts = await accountReview.listFounderReview();
    res.json({ success: true, total: accounts.length, accounts });
  } catch (err) {
    console.error('[Admin] engagement review error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load review list' });
  }
});

module.exports = router;
