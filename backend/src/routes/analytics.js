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
    const nowIso = new Date().toISOString();

    const [
      leadsRes,
      callsTodayRes,
      hotLeadsRes,
      apptsTodayRes,
      dealsRes,
      revenueRes,
      liveCallsRes,
      recentActivityRes,
      titleLogsRes,
      pendingContractsRes,
      dueFollowUpsRes,
      titleRisksRes,
      dealsSnapshotRes,
      followUpsSnapshotRes,
      contractsSnapshotRes,
    ] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('user_id', uid),
      supabase.from('calls').select('id', { count: 'exact', head: true }).eq('user_id', uid).gte('created_at', today),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('user_id', uid).gte('motivation_score', 70),
      // appointments table not yet created — use callback_requested calls as proxy
      supabase.from('calls').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('outcome', 'appointment').gte('created_at', today),
      supabase.from('deals').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('status', 'under_contract'),
      supabase.from('deals').select('assignment_fee').eq('user_id', uid).eq('status', 'closed').gte('created_at', month + '-01'),
      supabase.from('calls').select('*, leads(first_name, last_name, property_address), phone_numbers(number)').eq('user_id', uid).in('status', ['in-progress', 'ringing']),
      supabase.from('deal_activity').select('id, activity_type, message, created_at, metadata').eq('user_id', uid).order('created_at', { ascending: false }).limit(20),
      supabase.from('title_logs').select('id, status', { count: 'exact' }).eq('user_id', uid),
      supabase.from('contracts').select('id', { count: 'exact', head: true }).eq('user_id', uid).in('signing_status', ['sent', 'partially_signed']),
      supabase.from('follow_ups').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('status', 'scheduled').lte('next_follow_up_at', nowIso),
      supabase.from('title_logs').select('id', { count: 'exact', head: true }).eq('user_id', uid).in('status', ['documents_sent', 'stalled', 'funding_pending']),
      supabase.from('deals').select('id, property_address, status, closing_date').eq('user_id', uid).order('updated_at', { ascending: false }).limit(100),
      supabase.from('follow_ups').select('id, deal_id, contact_type, follow_up_type, next_follow_up_at, reason, status').eq('user_id', uid).order('next_follow_up_at', { ascending: true }).limit(20),
      supabase.from('contracts').select('id, deal_id, contract_type, signing_status, sent_at, fully_signed_at').eq('user_id', uid).order('updated_at', { ascending: false }).limit(20),
    ]);

    const revenue = revenueRes.data?.reduce((sum, d) => sum + (d.assignment_fee || 0), 0) || 0;

    // Pipeline funnel
    const { data: pipeline } = await supabase.from('leads').select('status').eq('user_id', uid);
    const funnel = {};
    (pipeline || []).forEach(l => { funnel[l.status] = (funnel[l.status] || 0) + 1; });

    const dealsById = new Map((dealsSnapshotRes.data || []).map((deal) => [deal.id, deal]));
    const dueFollowUps = (followUpsSnapshotRes.data || []).filter((item) => item.status === 'scheduled' && item.next_follow_up_at <= nowIso);
    const pendingContracts = (contractsSnapshotRes.data || [])
      .filter((contract) => ['sent', 'partially_signed'].includes(contract.signing_status))
      .map((contract) => ({
        ...contract,
        property_address: dealsById.get(contract.deal_id)?.property_address || 'Unknown property',
      }));
    const titleRiskItems = (dealsSnapshotRes.data || [])
      .filter((deal) => ['sent_to_title', 'title'].includes(String(deal.status || '').toLowerCase()))
      .map((deal) => ({
        id: deal.id,
        deal_id: deal.id,
        property_address: deal.property_address,
        status: deal.status,
        closing_date: deal.closing_date,
      }))
      .slice(0, 10);

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
          title_workflows: titleLogsRes.count || 0,
          pending_signatures: pendingContractsRes.count || 0,
          due_follow_ups: dueFollowUpsRes.count || 0,
          title_risks: titleRisksRes.count || 0,
        },
        live_calls:    liveCallsRes.data || [],
        pipeline_funnel: funnel,
        recent_activity: recentActivityRes.data || [],
        due_follow_ups: dueFollowUps.map((item) => ({
          ...item,
          property_address: dealsById.get(item.deal_id)?.property_address || 'Unknown property',
        })),
        pending_contracts: pendingContracts,
        title_risks: titleRiskItems,
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
    metrics.offer_rate = metrics.total ? Math.round((metrics.offers / metrics.total) * 100) : 0;
    metrics.contract_rate = metrics.total ? Math.round((metrics.appointments / metrics.total) * 100) : 0;
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

// ─── Extended analytics endpoints for Phase 6 dashboard ─────────────────────

// GET /api/analytics/kpis
router.get('/kpis', async (req, res, next) => {
  try {
    const uid = req.user.id;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();

    const [leads, activeDeals, closedThisMonth, prevClosed, fees, prevFees] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('user_id', uid),
      supabase.from('deals').select('deal_id', { count: 'exact', head: true }).eq('operator_id', uid).eq('status', 'active'),
      supabase.from('deals').select('deal_id', { count: 'exact', head: true }).eq('operator_id', uid).eq('stage', 'closed').gte('closed_at', monthStart),
      supabase.from('deals').select('deal_id', { count: 'exact', head: true }).eq('operator_id', uid).eq('stage', 'closed').gte('closed_at', prevMonthStart).lt('closed_at', monthStart),
      supabase.from('deals').select('assignment_fee').eq('operator_id', uid).eq('stage', 'closed').gte('closed_at', monthStart),
      supabase.from('deals').select('assignment_fee').eq('operator_id', uid).eq('stage', 'closed').gte('closed_at', prevMonthStart).lt('closed_at', monthStart),
    ]);

    const totalFees = (fees.data || []).reduce((s, d) => s + (d.assignment_fee || 0), 0);
    const prevTotalFees = (prevFees.data || []).reduce((s, d) => s + (d.assignment_fee || 0), 0);
    const closedDelta = (closedThisMonth.count || 0) - (prevClosed.count || 0);
    const feesDelta = totalFees - prevTotalFees;

    res.json({
      success: true,
      kpis: {
        total_leads: leads.count || 0,
        active_deals: activeDeals.count || 0,
        closed_this_month: closedThisMonth.count || 0,
        closed_delta: closedDelta,
        total_assignment_fees: totalFees,
        fees_delta: feesDelta,
      },
    });
  } catch (err) { next(err); }
});

// GET /api/analytics/deal-flow-by-month
router.get('/deal-flow-by-month', async (req, res, next) => {
  try {
    const uid = req.user.id;
    const year = parseInt(req.query.year) || new Date().getFullYear();

    const { data: deals } = await supabase.from('deals')
      .select('created_at, closed_at, stage')
      .eq('operator_id', uid)
      .gte('created_at', `${year}-01-01`)
      .lte('created_at', `${year}-12-31`);

    const months = Array.from({ length: 12 }, (_, i) => ({
      month: new Date(year, i).toLocaleString('default', { month: 'short' }),
      total: 0,
      closed: 0,
    }));

    (deals || []).forEach(d => {
      const m = new Date(d.created_at).getMonth();
      months[m].total++;
      if (d.stage === 'closed') months[m].closed++;
    });

    res.json({ success: true, data: months, year });
  } catch (err) { next(err); }
});

// GET /api/analytics/performance-by-state
router.get('/performance-by-state', async (req, res, next) => {
  try {
    const uid = req.user.id;
    const { data: deals } = await supabase.from('deals').select('state, stage, assignment_fee, created_at').eq('operator_id', uid);
    const { data: leads } = await supabase.from('leads').select('property_state').eq('user_id', uid);

    const stateMap = {};
    (leads || []).forEach(l => {
      if (!l.property_state) return;
      if (!stateMap[l.property_state]) stateMap[l.property_state] = { state: l.property_state, leads: 0, active_deals: 0, closings: 0, assignment_fees: 0 };
      stateMap[l.property_state].leads++;
    });

    (deals || []).forEach(d => {
      if (!d.state) return;
      if (!stateMap[d.state]) stateMap[d.state] = { state: d.state, leads: 0, active_deals: 0, closings: 0, assignment_fees: 0 };
      if (d.stage !== 'closed') stateMap[d.state].active_deals++;
      if (d.stage === 'closed') { stateMap[d.state].closings++; stateMap[d.state].assignment_fees += d.assignment_fee || 0; }
    });

    const stateData = Object.values(stateMap).sort((a, b) => b.closings - a.closings);
    res.json({ success: true, data: stateData, top5: stateData.slice(0, 5) });
  } catch (err) { next(err); }
});

// GET /api/analytics/seller-segments
router.get('/seller-segments', async (req, res, next) => {
  try {
    const uid = req.user.id;
    const { data } = await supabase.from('sellers').select('motivation_type').eq('operator_id', uid);
    const segments = {};
    (data || []).forEach(s => {
      const t = s.motivation_type || 'other';
      segments[t] = (segments[t] || 0) + 1;
    });
    const result = Object.entries(segments).map(([type, count]) => ({ type, count }));
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// GET /api/analytics/deal-types
router.get('/deal-types', async (req, res, next) => {
  try {
    const uid = req.user.id;
    const { data } = await supabase.from('deals').select('deal_type, assignment_fee').eq('operator_id', uid);
    const types = {};
    (data || []).forEach(d => {
      const t = d.deal_type || 'assignment';
      if (!types[t]) types[t] = { type: t, count: 0, total_fees: 0 };
      types[t].count++;
      types[t].total_fees += d.assignment_fee || 0;
    });
    const total = Object.values(types).reduce((s, t) => s + t.count, 0);
    const result = Object.values(types).map(t => ({ ...t, percentage: total > 0 ? Math.round((t.count / total) * 100) : 0 }));
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// GET /api/analytics/regional-performance
router.get('/regional-performance', async (req, res, next) => {
  try {
    const uid = req.user.id;
    const { data: deals } = await supabase.from('deals').select('state, deal_type, assignment_fee, stage').eq('operator_id', uid);

    const regions = {
      East:    { states: ['ME','NH','VT','MA','RI','CT','NY','NJ','PA','DE','MD','VA','WV','NC','SC','GA','FL'], deals: 0, closed: 0, fees: 0 },
      West:    { states: ['WA','OR','CA','NV','ID','MT','WY','UT','CO','AZ','NM','AK','HI'], deals: 0, closed: 0, fees: 0 },
      Central: { states: ['ND','SD','NE','KS','MN','IA','MO','WI','IL','MI','IN','OH'], deals: 0, closed: 0, fees: 0 },
      South:   { states: ['TX','OK','AR','LA','MS','AL','TN','KY'], deals: 0, closed: 0, fees: 0 },
    };

    (deals || []).forEach(d => {
      for (const [region, data] of Object.entries(regions)) {
        if (data.states.includes(d.state)) {
          data.deals++;
          if (d.stage === 'closed') { data.closed++; data.fees += d.assignment_fee || 0; }
          break;
        }
      }
    });

    const result = Object.entries(regions).map(([name, data]) => ({
      region: name,
      total_deals: data.deals,
      closed: data.closed,
      assignment_fees: data.fees,
    }));

    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// GET /api/analytics/ai-insights — Claude Sonnet 4.6 generated insights
router.get('/ai-insights', async (req, res, next) => {
  try {
    const uid = req.user.id;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const [kpisRes, statesRes, alertsRes] = await Promise.all([
      supabase.from('deals').select('stage, assignment_fee, state, created_at').eq('operator_id', uid).gte('created_at', monthStart),
      supabase.from('market_intelligence').select('state, avg_motivation_score, trend_direction, trend_percentage').order('trend_percentage', { ascending: false }).limit(5),
      supabase.from('notifications').select('message').eq('operator_id', uid).eq('is_read', false).order('created_at', { ascending: false }).limit(5),
    ]);

    const { generateAnalyticsInsights } = require('../services/dualAIService');
    const insights = await generateAnalyticsInsights({
      kpis: {
        deals_this_month: (kpisRes.data || []).length,
        closed_this_month: (kpisRes.data || []).filter(d => d.stage === 'closed').length,
        total_fees: (kpisRes.data || []).reduce((s, d) => s + (d.assignment_fee || 0), 0),
      },
      topStates: statesRes.data || [],
      recentDeals: kpisRes.data || [],
      marketAlerts: alertsRes.data || [],
    }).catch(() => ['📊 Connect more deals to generate AI insights.']);

    res.json({ success: true, insights, generated_at: new Date().toISOString() });
  } catch (err) { next(err); }
});

module.exports = router;
