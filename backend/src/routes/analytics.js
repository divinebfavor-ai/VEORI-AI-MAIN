const express  = require('express');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/analytics/dashboard
router.get('/dashboard', async (req, res, next) => {
  try {
    const uid = req.user.id;
    const today  = new Date().toISOString().split('T')[0];
    const month  = new Date().toISOString().slice(0, 7);

    const [leadsRes, callsTodayRes, hotLeadsRes, apptsTodayRes, dealsRes, revenueRes, liveCallsRes] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('user_id', uid),
      supabase.from('calls').select('id', { count: 'exact', head: true }).eq('user_id', uid).gte('created_at', today),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('user_id', uid).gte('motivation_score', 70),
      supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('user_id', uid).gte('scheduled_at', today),
      supabase.from('deals').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('status', 'under_contract'),
      supabase.from('deals').select('assignment_fee').eq('user_id', uid).eq('status', 'closed').gte('created_at', month + '-01'),
      supabase.from('calls').select('*, leads(first_name, last_name, property_address), phone_numbers(number)').eq('user_id', uid).in('status', ['in-progress', 'ringing']),
    ]);

    const revenue = revenueRes.data?.reduce((sum, d) => sum + (d.assignment_fee || 0), 0) || 0;

    // Pipeline funnel
    const { data: pipeline } = await supabase.from('leads').select('status').eq('user_id', uid);
    const funnel = {};
    (pipeline || []).forEach(l => { funnel[l.status] = (funnel[l.status] || 0) + 1; });

    // Recent activity (last 20 calls)
    const { data: recentActivity } = await supabase.from('calls')
      .select('id, status, outcome, created_at, leads(first_name, last_name)')
      .eq('user_id', uid).order('created_at', { ascending: false }).limit(20);

    res.json({
      success: true,
      data: {
        stats: {
          total_leads:        leadsRes.count || 0,
          calls_today:        callsTodayRes.count || 0,
          hot_leads:          hotLeadsRes.count || 0,
          appointments_today: apptsTodayRes.count || 0,
          deals_under_contract: dealsRes.count || 0,
          revenue_this_month: revenue,
        },
        live_calls:    liveCallsRes.data || [],
        pipeline_funnel: funnel,
        recent_activity: recentActivity || [],
      },
    });
  } catch (err) { next(err); }
});

// GET /api/analytics/calls
router.get('/calls', async (req, res, next) => {
  try {
    const { days = 7 } = req.query;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase.from('calls').select('status, duration_seconds, motivation_score, outcome, operator_took_over, created_at')
      .eq('user_id', req.user.id).gte('created_at', since);
    if (error) throw error;

    const metrics = {
      total: data.length,
      answered:      data.filter(c => (c.duration_seconds || 0) > 10).length,
      avg_duration:  data.length ? Math.round(data.reduce((s,c) => s + (c.duration_seconds || 0), 0) / data.length) : 0,
      avg_score:     data.filter(c => c.motivation_score).length
        ? Math.round(data.filter(c => c.motivation_score).reduce((s,c) => s + c.motivation_score, 0) / data.filter(c => c.motivation_score).length) : 0,
      hot:           data.filter(c => (c.motivation_score || 0) >= 70).length,
      appointments:  data.filter(c => c.outcome === 'appointment').length,
      offers:        data.filter(c => c.outcome === 'offer_made').length,
      takeovers:     data.filter(c => c.operator_took_over).length,
      answer_rate:   data.length ? Math.round((data.filter(c => (c.duration_seconds || 0) > 10).length / data.length) * 100) : 0,
    };
    res.json({ success: true, data: metrics });
  } catch (err) { next(err); }
});

// GET /api/analytics/revenue
router.get('/revenue', async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('deals').select('assignment_fee, status, created_at, property_address').eq('user_id', req.user.id).order('created_at', { ascending: false });
    if (error) throw error;
    const closed = data.filter(d => d.status === 'closed');
    const pipeline = data.filter(d => !['closed','dead'].includes(d.status));
    res.json({
      success: true,
      data: {
        total_revenue:    closed.reduce((s, d) => s + (d.assignment_fee || 0), 0),
        pipeline_value:   pipeline.reduce((s, d) => s + (d.assignment_fee || 0), 0),
        deals_closed:     closed.length,
        deals_in_pipeline: pipeline.length,
        deals:            data,
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;
