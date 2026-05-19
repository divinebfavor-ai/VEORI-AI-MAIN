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

// ─── Extended analytics endpoints ────────────────────────────────────────────

// GET /api/analytics/kpis
router.get('/kpis', async (req, res, next) => {
  try {
    const uid = req.user.id;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const prevMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString();

    const [
      leadsRes,
      activePipelineRes,
      closedThisMonthRes,
      closedPrevMonthRes,
      feesThisMonthRes,
      feesPrevMonthRes,
      callsRes,
      callsPrevRes,
    ] = await Promise.all([
      // Total leads
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('user_id', uid),
      // Active pipeline: leads not dead
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('user_id', uid).not('status', 'in', '("dead","disqualified")'),
      // Deals closed this month
      supabase.from('deals').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('status', 'closed').gte('updated_at', monthStart),
      // Deals closed prev month
      supabase.from('deals').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('status', 'closed').gte('updated_at', prevMonthStart).lte('updated_at', prevMonthEnd),
      // Revenue this month
      supabase.from('deals').select('assignment_fee').eq('user_id', uid).eq('status', 'closed').gte('updated_at', monthStart),
      // Revenue prev month
      supabase.from('deals').select('assignment_fee').eq('user_id', uid).eq('status', 'closed').gte('updated_at', prevMonthStart).lte('updated_at', prevMonthEnd),
      // Motivation scores this month
      supabase.from('calls').select('motivation_score').eq('user_id', uid).not('motivation_score', 'is', null).gte('created_at', monthStart),
      // Motivation scores prev month
      supabase.from('calls').select('motivation_score').eq('user_id', uid).not('motivation_score', 'is', null).gte('created_at', prevMonthStart).lte('created_at', prevMonthEnd),
    ]);

    const totalFeesThis = (feesThisMonthRes.data || []).reduce((s, d) => s + (d.assignment_fee || 0), 0);
    const totalFeesPrev = (feesPrevMonthRes.data || []).reduce((s, d) => s + (d.assignment_fee || 0), 0);

    const closedThis = closedThisMonthRes.count || 0;
    const closedPrev = closedPrevMonthRes.count || 0;
    const closedTrend = closedPrev > 0 ? Math.round(((closedThis - closedPrev) / closedPrev) * 100) : null;
    const revTrend = totalFeesPrev > 0 ? Math.round(((totalFeesThis - totalFeesPrev) / totalFeesPrev) * 100) : null;

    const scoresThis = (callsRes.data || []).map(c => c.motivation_score).filter(Boolean);
    const scoresPrev = (callsPrevRes.data || []).map(c => c.motivation_score).filter(Boolean);
    const avgMotivThis = scoresThis.length ? Math.round(scoresThis.reduce((a, b) => a + b, 0) / scoresThis.length) : 0;
    const avgMotivPrev = scoresPrev.length ? Math.round(scoresPrev.reduce((a, b) => a + b, 0) / scoresPrev.length) : 0;
    const motivTrend = avgMotivPrev > 0 ? Math.round(((avgMotivThis - avgMotivPrev) / avgMotivPrev) * 100) : null;

    res.json({
      success: true,
      data: {
        total_leads:          leadsRes.count || 0,
        active_pipeline:      activePipelineRes.count || 0,
        deals_closed:         closedThis,
        deals_closed_trend:   closedTrend,
        total_revenue:        totalFeesThis,
        revenue_trend:        revTrend,
        avg_motivation_score: avgMotivThis,
        motivation_trend:     motivTrend,
      },
    });
  } catch (err) { next(err); }
});

// GET /api/analytics/deal-flow-by-month
router.get('/deal-flow-by-month', async (req, res, next) => {
  try {
    const uid = req.user.id;
    const year = parseInt(req.query.year) || new Date().getFullYear();

    const [leadsRes, dealsRes, callsRes] = await Promise.all([
      supabase.from('leads').select('created_at').eq('user_id', uid)
        .gte('created_at', `${year}-01-01`).lte('created_at', `${year}-12-31`),
      supabase.from('deals').select('created_at, updated_at, status, assignment_fee').eq('user_id', uid)
        .gte('created_at', `${year}-01-01`).lte('created_at', `${year}-12-31`),
      supabase.from('calls').select('created_at, motivation_score').eq('user_id', uid)
        .gte('created_at', `${year}-01-01`).lte('created_at', `${year}-12-31`).not('motivation_score', 'is', null),
    ]);

    const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const months = MONTH_NAMES.map((name, i) => ({
      month: name,
      month_label: `${name} ${year}`,
      new_leads: 0,
      deals_closed: 0,
      total_revenue: 0,
      avg_motivation: 0,
      _scores: [],
    }));

    (leadsRes.data || []).forEach(l => {
      const m = new Date(l.created_at).getMonth();
      months[m].new_leads++;
    });

    (dealsRes.data || []).forEach(d => {
      const m = new Date(d.created_at).getMonth();
      if (d.status === 'closed') {
        months[m].deals_closed++;
        months[m].total_revenue += d.assignment_fee || 0;
      }
    });

    (callsRes.data || []).forEach(c => {
      const m = new Date(c.created_at).getMonth();
      if (c.motivation_score) months[m]._scores.push(c.motivation_score);
    });

    months.forEach(m => {
      m.avg_motivation = m._scores.length
        ? Math.round(m._scores.reduce((a, b) => a + b, 0) / m._scores.length)
        : 0;
      delete m._scores;
    });

    // Only return months up to current month
    const currentMonth = new Date().getFullYear() === year ? new Date().getMonth() : 11;
    const result = months.slice(0, currentMonth + 1);

    res.json({ success: true, data: result, year });
  } catch (err) { next(err); }
});

// GET /api/analytics/performance-by-state
router.get('/performance-by-state', async (req, res, next) => {
  try {
    const uid = req.user.id;

    const [leadsRes, dealsRes] = await Promise.all([
      supabase.from('leads').select('property_state, motivation_score').eq('user_id', uid).not('property_state', 'is', null),
      supabase.from('deals').select('property_address, status, assignment_fee').eq('user_id', uid),
    ]);

    // Build state map from leads
    const stateMap = {};
    (leadsRes.data || []).forEach(l => {
      const st = (l.property_state || '').toUpperCase().trim();
      if (!st || st.length > 3) return;
      if (!stateMap[st]) stateMap[st] = { state: st, leads: 0, deals_attempted: 0, deals_closed: 0, total_fees: 0, _scores: [] };
      stateMap[st].leads++;
      if (l.motivation_score) stateMap[st]._scores.push(l.motivation_score);
    });

    // Count deals per state (try to infer state from address)
    (dealsRes.data || []).forEach(d => {
      const addr = d.property_address || '';
      // Extract 2-letter state from end of address (e.g. "Dallas, TX 75201")
      const match = addr.match(/\b([A-Z]{2})\b\s*\d{5}/) || addr.match(/,\s*([A-Z]{2})\s*$/i);
      const st = match ? match[1].toUpperCase() : null;
      if (st && stateMap[st]) {
        stateMap[st].deals_attempted++;
        if (d.status === 'closed') {
          stateMap[st].deals_closed++;
          stateMap[st].total_fees += d.assignment_fee || 0;
        }
      }
    });

    const stateData = Object.values(stateMap).map(s => {
      const close_rate = s.deals_attempted > 0 ? Math.round((s.deals_closed / s.deals_attempted) * 100) : 0;
      const avg_motivation = s._scores.length ? Math.round(s._scores.reduce((a, b) => a + b, 0) / s._scores.length) : 0;
      const avg_assignment_fee = s.deals_closed > 0 ? Math.round(s.total_fees / s.deals_closed) : 0;
      return {
        state: s.state,
        leads: s.leads,
        deals_attempted: s.deals_attempted,
        deals_closed: s.deals_closed,
        close_rate,
        avg_motivation,
        avg_assignment_fee,
        trend_direction: close_rate > 30 ? 'up' : close_rate > 0 ? 'flat' : 'down',
      };
    }).sort((a, b) => b.leads - a.leads);

    res.json({ success: true, data: stateData, top5: stateData.filter(s => s.leads > 0).slice(0, 5) });
  } catch (err) { next(err); }
});

// GET /api/analytics/seller-segments
router.get('/seller-segments', async (req, res, next) => {
  try {
    const uid = req.user.id;
    const { data } = await supabase.from('leads').select('primary_tag, motivation_score').eq('user_id', uid);

    // Group by primary_tag, fall back to motivation score buckets
    const segments = {};
    (data || []).forEach(l => {
      let seg = l.primary_tag || null;
      if (!seg) {
        const score = l.motivation_score || 0;
        if (score >= 80) seg = 'highly_motivated';
        else if (score >= 60) seg = 'motivated';
        else if (score >= 40) seg = 'curious';
        else seg = 'not_motivated';
      }
      if (!segments[seg]) segments[seg] = { segment: seg, count: 0, _scores: [] };
      segments[seg].count++;
      if (l.motivation_score) segments[seg]._scores.push(l.motivation_score);
    });

    const result = Object.values(segments).map(s => ({
      segment: s.segment,
      motivation_type: s.segment,
      count: s.count,
      avg_score: s._scores.length ? Math.round(s._scores.reduce((a, b) => a + b, 0) / s._scores.length) : 0,
    })).sort((a, b) => b.count - a.count);

    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// GET /api/analytics/deal-types
router.get('/deal-types', async (req, res, next) => {
  try {
    const uid = req.user.id;
    const { data } = await supabase.from('deals').select('deal_type, assignment_fee').eq('user_id', uid);
    const types = {};
    (data || []).forEach(d => {
      const t = d.deal_type || 'assignment';
      if (!types[t]) types[t] = { type: t, count: 0, total_fees: 0 };
      types[t].count++;
      types[t].total_fees += d.assignment_fee || 0;
    });
    const total = Object.values(types).reduce((s, t) => s + t.count, 0);
    const result = Object.values(types).map(t => ({
      ...t,
      deal_type: t.type,
      percentage: total > 0 ? Math.round((t.count / total) * 100) : 0,
    }));
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// GET /api/analytics/regional-performance
router.get('/regional-performance', async (req, res, next) => {
  try {
    const uid = req.user.id;

    const [leadsRes, dealsRes] = await Promise.all([
      supabase.from('leads').select('property_state').eq('user_id', uid).not('property_state', 'is', null),
      supabase.from('deals').select('property_address, status, assignment_fee').eq('user_id', uid),
    ]);

    const REGIONS = {
      East:    ['ME','NH','VT','MA','RI','CT','NY','NJ','PA','DE','MD','VA','WV','NC','SC','GA','FL','DC'],
      West:    ['WA','OR','CA','NV','ID','MT','WY','UT','CO','AZ','NM','AK','HI'],
      Central: ['ND','SD','NE','KS','MN','IA','MO','WI','IL','MI','IN','OH'],
      South:   ['TX','OK','AR','LA','MS','AL','TN','KY'],
    };

    const regionData = {};
    Object.keys(REGIONS).forEach(r => {
      regionData[r] = { region: r, leads: 0, deals_attempted: 0, deals_closed: 0, assignment_fees: 0 };
    });

    (leadsRes.data || []).forEach(l => {
      const st = (l.property_state || '').toUpperCase().trim();
      for (const [region, states] of Object.entries(REGIONS)) {
        if (states.includes(st)) { regionData[region].leads++; break; }
      }
    });

    (dealsRes.data || []).forEach(d => {
      const addr = d.property_address || '';
      const match = addr.match(/\b([A-Z]{2})\b\s*\d{5}/) || addr.match(/,\s*([A-Z]{2})\s*$/i);
      const st = match ? match[1].toUpperCase() : null;
      if (!st) return;
      for (const [region, states] of Object.entries(REGIONS)) {
        if (states.includes(st)) {
          regionData[region].deals_attempted++;
          if (d.status === 'closed') {
            regionData[region].deals_closed++;
            regionData[region].assignment_fees += d.assignment_fee || 0;
          }
          break;
        }
      }
    });

    const result = Object.values(regionData);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// GET /api/analytics/ai-insights — Claude-generated insights from real data
router.get('/ai-insights', async (req, res, next) => {
  try {
    const uid = req.user.id;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [leadsRes, callsRes, dealsRes, hotLeadsRes] = await Promise.all([
      supabase.from('leads').select('status, motivation_score, property_state, primary_tag, created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(200),
      supabase.from('calls').select('outcome, duration_seconds, motivation_score, ai_summary, created_at').eq('user_id', uid).gte('created_at', thirtyDaysAgo).order('created_at', { ascending: false }).limit(100),
      supabase.from('deals').select('status, assignment_fee, property_address, created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(50),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('user_id', uid).gte('motivation_score', 70),
    ]);

    const leads = leadsRes.data || [];
    const calls = callsRes.data || [];
    const deals = dealsRes.data || [];

    // Build summary stats for AI prompt
    const totalLeads = leads.length;
    const hotLeads = hotLeadsRes.count || 0;
    const callsLast30 = calls.length;
    const answered = calls.filter(c => (c.duration_seconds || 0) > 10).length;
    const answerRate = callsLast30 > 0 ? Math.round((answered / callsLast30) * 100) : 0;
    const avgScore = calls.filter(c => c.motivation_score).length
      ? Math.round(calls.filter(c => c.motivation_score).reduce((s, c) => s + c.motivation_score, 0) / calls.filter(c => c.motivation_score).length)
      : 0;
    const appointments = calls.filter(c => c.outcome === 'appointment').length;
    const closedDeals = deals.filter(d => d.status === 'closed').length;
    const totalRevenue = deals.filter(d => d.status === 'closed').reduce((s, d) => s + (d.assignment_fee || 0), 0);

    // Top states
    const stateCounts = {};
    leads.forEach(l => { if (l.property_state) stateCounts[l.property_state] = (stateCounts[l.property_state] || 0) + 1; });
    const topStates = Object.entries(stateCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s, c]) => `${s}(${c})`).join(', ');

    // Common tags
    const tagCounts = {};
    leads.forEach(l => { if (l.primary_tag) tagCounts[l.primary_tag] = (tagCounts[l.primary_tag] || 0) + 1; });
    const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, c]) => `${t}(${c})`).join(', ');

    // Recent call summaries for context
    const recentSummaries = calls
      .filter(c => c.ai_summary && c.ai_summary.length > 10)
      .slice(0, 5)
      .map(c => c.ai_summary)
      .join(' | ');

    // Generate insights using Claude directly
    let insights = [];
    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 700,
        messages: [{
          role: 'user',
          content: `You are an expert real estate acquisitions analyst. Based on this operator's data, provide 5 sharp, specific, actionable insights. Each insight must start with a relevant emoji, then a space, then 1-2 concise sentences. Be specific with numbers. Focus on what matters most for closing deals.

OPERATOR STATS (last 30 days):
- Total leads in system: ${totalLeads}
- Hot leads (score ≥70): ${hotLeads}
- Calls made: ${callsLast30}
- Answer rate: ${answerRate}%
- Avg motivation score: ${avgScore}/100
- Appointments booked: ${appointments}
- Deals closed: ${closedDeals}
- Revenue closed: $${totalRevenue.toLocaleString()}
- Top states by lead count: ${topStates || 'N/A'}
- Lead types: ${topTags || 'N/A'}
- Recent call notes: ${recentSummaries || 'None yet'}

Return ONLY a JSON array of exactly 5 strings. No markdown. Example: ["🔥 Insight here.", "📞 Insight here."]`,
        }],
      });

      const raw = msg.content[0]?.text || '';
      const match = raw.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) insights = parsed.slice(0, 6);
      }
    } catch (aiErr) {
      console.warn('[Analytics] AI insights generation failed:', aiErr.message);
    }

    // Fallback static insights based on real data if AI fails
    if (insights.length === 0) {
      if (totalLeads === 0) {
        insights = [
          '📥 Import your first leads to unlock AI-powered market intelligence.',
          '📞 Once you have leads, the AI will analyze call patterns and recommend next moves.',
          '🗺️ Connect leads from multiple states to see regional performance insights.',
          '🎯 Score your leads after calls to train the motivation ranking system.',
          '🚀 Start your first campaign to begin generating real acquisition data.',
        ];
      } else {
        insights = [
          `🔥 You have ${hotLeads} hot leads (score ≥70) ready for aggressive follow-up — prioritize these today.`,
          answerRate > 0
            ? `📞 Your ${answerRate}% answer rate across ${callsLast30} calls this month ${answerRate >= 30 ? 'is solid — maintain your call velocity.' : 'has room to improve — try calling between 10am-12pm and 4pm-6pm local time.'}`
            : `📞 Run your first campaign to start building call data and answer rate benchmarks.`,
          avgScore > 0
            ? `🎯 Average seller motivation is ${avgScore}/100 — ${avgScore >= 60 ? 'strong pipeline quality.' : 'consider refining your lead source to target higher-distress properties.'}`
            : `🎯 Collect motivation scores by completing calls — this unlocks seller ranking and prioritization.`,
          topStates
            ? `🗺️ Most leads come from ${topStates.split(',')[0].split('(')[0]} — consider doubling down on this market if conversion is strong.`
            : `🗺️ Add property state to your leads for geographic performance tracking.`,
          appointments > 0
            ? `📅 ${appointments} appointment${appointments > 1 ? 's' : ''} booked from calls — follow up within 24 hours to maximize conversion.`
            : `📅 Focus on booking walk-throughs during calls — properties toured are 3× more likely to close.`,
        ];
      }
    }

    res.json({ success: true, insights, generated_at: new Date().toISOString() });
  } catch (err) { next(err); }
});

module.exports = router;
