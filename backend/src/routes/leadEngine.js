/**
 * Lead Engine Routes
 *
 * GET  /api/lead-engine/status          — current scheduler status + last run summary
 * GET  /api/lead-engine/sources         — all sources with stats
 * GET  /api/lead-engine/jobs            — recent job history
 * GET  /api/lead-engine/dashboard       — full dashboard data
 * GET  /api/lead-engine/coverage        — coverage map data by state
 * POST /api/lead-engine/run             — manually trigger a run
 * POST /api/lead-engine/run/:source     — run a single source
 * PUT  /api/lead-engine/sources/:key    — toggle source on/off
 */

const router   = require('express').Router();
const { requireAuth: auth } = require('../middleware/auth');
const supabase = require('../config/supabase');
const {
  runLeadEngine,
  runSource,
  SOURCE_LABELS,
} = require('../services/leadEngine');

const TARGET_STATES = ['PA', 'IL', 'MI']; // covered by free sources right now

// ─── GET /api/lead-engine/status ─────────────────────────────────────────────
router.get('/status', auth, async (req, res) => {
  try {
    const { data: recentJobs } = await supabase
      .from('lead_engine_jobs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(1);

    const { data: todayLeads } = await supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', req.user.id)
      .eq('auto_sourced', true)
      .gte('sourced_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    const runningJobs = await supabase
      .from('lead_engine_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'running');

    res.json({
      success:         true,
      is_running:      (runningJobs.count || 0) > 0,
      last_run:        recentJobs?.[0] || null,
      leads_today:     todayLeads?.count || 0,
      next_run:        'Every 24 hours (automatic)',
      sources_active:  Object.keys(SOURCE_LABELS).length,
      states_covered:  TARGET_STATES.length,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/lead-engine/sources ────────────────────────────────────────────
router.get('/sources', auth, async (req, res) => {
  try {
    const { data: dbSources } = await supabase
      .from('lead_engine_sources')
      .select('*')
      .eq('user_id', req.user.id)
      .order('total_pulled', { ascending: false });

    // Build full list — include sources not yet run
    const allSources = Object.entries(SOURCE_LABELS).map(([key, label]) => {
      const rows = (dbSources || []).filter(s => s.source_key === key);
      const totalPulled    = rows.reduce((s, r) => s + (r.total_pulled || r.last_run_count || 0), 0);
      const totalQualified = rows.reduce((s, r) => s + (r.total_qualified || 0), 0);
      const lastRun        = rows.sort((a, b) => new Date(b.last_run_at) - new Date(a.last_run_at))[0];

      return {
        key,
        label,
        is_active:       rows.length === 0 || rows.some(r => r.is_active),
        last_run_at:     lastRun?.last_run_at || null,
        last_run_status: lastRun?.last_run_status || 'never',
        total_pulled:    totalPulled,
        total_qualified: totalQualified,
        states_covered:  rows.filter(r => r.is_active).length,
        avg_score:       rows.length ? Math.round(rows.reduce((s, r) => s + parseFloat(r.avg_score || 0), 0) / rows.length) : 0,
      };
    });

    res.json({ success: true, sources: allSources });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/lead-engine/jobs ────────────────────────────────────────────────
router.get('/jobs', auth, async (req, res) => {
  try {
    const { data: jobs } = await supabase
      .from('lead_engine_jobs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(100);

    res.json({ success: true, jobs: jobs || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/lead-engine/coverage ───────────────────────────────────────────
router.get('/coverage', auth, async (req, res) => {
  try {
    const { data: coverage } = await supabase
      .from('lead_engine_coverage')
      .select('*')
      .order('state');

    // Group by state
    const byState = {};
    for (const row of coverage || []) {
      if (!byState[row.state]) byState[row.state] = { state: row.state, sources: [], total_leads: 0 };
      byState[row.state].sources.push(row.source_key);
      byState[row.state].total_leads += row.total_leads || 0;
    }

    res.json({
      success: true,
      coverage: Object.values(byState),
      total_states_covered: Object.keys(byState).length,
      target_states: TARGET_STATES.length,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/lead-engine/dashboard ──────────────────────────────────────────
router.get('/dashboard', auth, async (req, res) => {
  try {
    const now = new Date();
    const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const since7d  = new Date(now - 7  * 24 * 60 * 60 * 1000).toISOString();

    const [leadsToday, leadsWeek, bySource, byState, topLeads, jobs] = await Promise.all([
      // Leads in last 24h
      supabase.from('leads').select('id', { count: 'exact', head: true })
        .eq('user_id', req.user.id).eq('auto_sourced', true).gte('sourced_at', since24h),

      // Leads in last 7d
      supabase.from('leads').select('id', { count: 'exact', head: true })
        .eq('user_id', req.user.id).eq('auto_sourced', true).gte('sourced_at', since7d),

      // By source type
      supabase.from('leads').select('lead_type, sourcing_score')
        .eq('user_id', req.user.id).eq('auto_sourced', true).gte('sourced_at', since7d),

      // By state
      supabase.from('leads').select('property_state')
        .eq('user_id', req.user.id).eq('auto_sourced', true).gte('sourced_at', since7d),

      // Top scoring leads today
      supabase.from('leads').select('id, first_name, last_name, property_state, property_city, lead_type, sourcing_score, distress_signals, sourced_at, phone, status')
        .eq('user_id', req.user.id).eq('auto_sourced', true)
        .gte('sourced_at', since24h)
        .order('sourcing_score', { ascending: false })
        .limit(20),

      // Recent jobs
      supabase.from('lead_engine_jobs').select('*')
        .order('started_at', { ascending: false }).limit(50),
    ]);

    // Aggregate by source
    const sourceStats = {};
    for (const l of bySource.data || []) {
      const t = l.lead_type || 'unknown';
      if (!sourceStats[t]) sourceStats[t] = { count: 0, total_score: 0 };
      sourceStats[t].count++;
      sourceStats[t].total_score += l.sourcing_score || 0;
    }
    const sourceBreakdown = Object.entries(sourceStats).map(([type, s]) => ({
      type,
      label:     SOURCE_LABELS[type] || type,
      count:     s.count,
      avg_score: Math.round(s.total_score / s.count),
    })).sort((a, b) => b.count - a.count);

    // Aggregate by state
    const stateStats = {};
    for (const l of byState.data || []) {
      const st = l.property_state || 'Unknown';
      stateStats[st] = (stateStats[st] || 0) + 1;
    }
    const stateBreakdown = Object.entries(stateStats)
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    res.json({
      success: true,
      stats: {
        leads_today:  leadsToday.count  || 0,
        leads_7_days: leadsWeek.count   || 0,
      },
      source_breakdown: sourceBreakdown,
      state_breakdown:  stateBreakdown,
      top_leads:        topLeads.data || [],
      recent_jobs:      (jobs.data || []).slice(0, 20),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/lead-engine/search ─────────────────────────────────────────────
// Search + filter auto-sourced leads by ZIP, city, state, type, score
router.get('/search', auth, async (req, res) => {
  try {
    const {
      q,          // free text (name, address, city)
      state,      // 2-letter state code
      zip,        // ZIP code
      city,       // city name
      lead_type,  // source type filter
      min_score,  // minimum sourcing score
      max_score,
      limit = 50,
      offset = 0,
    } = req.query;

    let query = supabase
      .from('leads')
      .select('id, first_name, last_name, phone, email, property_address, property_city, property_state, property_zip, county, lead_type, sourcing_score, distress_signals, sourced_at, status, motivation_score, tags', { count: 'exact' })
      .eq('user_id', req.user.id)
      .eq('auto_sourced', true)
      .order('sourcing_score', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (state)     query = query.eq('property_state', state.toUpperCase());
    if (zip)       query = query.eq('property_zip', zip.trim());
    if (city)      query = query.ilike('property_city', `%${city}%`);
    if (lead_type) query = query.eq('lead_type', lead_type);
    if (min_score) query = query.gte('sourcing_score', parseInt(min_score));
    if (max_score) query = query.lte('sourcing_score', parseInt(max_score));
    if (q) {
      query = query.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,property_address.ilike.%${q}%,property_city.ilike.%${q}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    res.json({ success: true, leads: data || [], total: count || 0 });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/lead-engine/pull ──────────────────────────────────────────────
// Fast targeted pull — specific ZIP, city, or state + source type
// Returns results in ~30-60 seconds instead of waiting for the 24h cycle
router.post('/pull', auth, async (req, res) => {
  try {
    const { zip, city, state, sources } = req.body;

    if (!state && !zip && !city) {
      return res.status(400).json({ success: false, error: 'Provide at least state, city, or zip' });
    }

    const targetState = state || 'FL';
    const targetSources = sources || ['tax_delinquent', 'lis_pendens', 'probate', 'bankruptcy'];

    // Respond immediately — stream results via polling (client polls /search)
    res.json({
      success: true,
      message: `Pulling ${targetSources.length} sources for ${city || zip || targetState}. Check your Lead Engine feed — results appear within 60 seconds.`,
      target: { state: targetState, city, zip },
    });

    // Run targeted pull in background
    const { runSource } = require('../services/leadEngine');
    Promise.all(
      targetSources.map(src => runSource(src, targetState, req.user.id))
    ).then(results => {
      const total = results.reduce((s, r) => s + (r.imported || 0), 0);
      console.log(`[LeadEngine] Targeted pull complete — ${total} leads imported for ${city || zip || targetState}`);
    }).catch(err => {
      console.error('[LeadEngine] Targeted pull error:', err.message);
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/lead-engine/run ────────────────────────────────────────────────
router.post('/run', auth, async (req, res) => {
  try {
    const { states, sources } = req.body;

    // Run async — respond immediately, process in background
    res.json({ success: true, message: 'Lead Engine started. New leads will appear in your pipeline within minutes.' });

    runLeadEngine(req.user.id, {
      states:  states  || undefined,
      sources: sources || undefined,
    }).catch(err => console.error('[LeadEngine] Manual run error:', err.message));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/lead-engine/run/:source ───────────────────────────────────────
router.post('/run/:source', auth, async (req, res) => {
  try {
    const { source } = req.params;
    const { state = 'FL' } = req.body;

    if (!SOURCE_LABELS[source]) {
      return res.status(400).json({ success: false, error: `Unknown source: ${source}` });
    }

    res.json({ success: true, message: `Running ${SOURCE_LABELS[source]} for ${state}…` });

    runSource(source, state, req.user.id)
      .catch(err => console.error(`[LeadEngine] Source run error:`, err.message));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── PUT /api/lead-engine/sources/:key ───────────────────────────────────────
router.put('/sources/:key', auth, async (req, res) => {
  try {
    const { key } = req.params;
    const { is_active } = req.body;

    await supabase.from('lead_engine_sources')
      .update({ is_active })
      .eq('user_id', req.user.id)
      .eq('source_key', key);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
