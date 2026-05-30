/**
 * Admin Dashboard API
 * Routes:
 *   GET /api/admin/stats        - overview stats
 *   GET /api/admin/users        - all users with geo + plan data
 *   GET /api/admin/countries    - users by country
 *   GET /api/admin/revenue      - revenue breakdown
 */

const router   = require('express').Router();
const { requireAuth: auth } = require('../middleware/auth');
const supabase = require('../config/supabase');

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'divineqflash@gmail.com').split(',').map(e => e.trim());

// Admin guard
router.use(auth, (req, res, next) => {
  if (!ADMIN_EMAILS.includes(req.user.email)) {
    return res.status(403).json({ success: false, error: 'Admin access only' });
  }
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
    const planAmounts = {
      founding_member: 397, starter: 499, growth: 999,
      pro: 1799, scale: 2999, enterprise: 5999,
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

    const planAmounts = {
      founding_member: 397, starter: 499, growth: 999,
      pro: 1799, scale: 2999, enterprise: 5999,
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

module.exports = router;
