/**
 * Features 15 & 16 — Silent Call Detection + Best Time to Call AI
 * Routes: GET /api/call-analytics/best-time, GET /api/call-analytics/silent-calls,
 *         POST /api/call-analytics/log, GET /api/call-analytics/summary
 */
const router  = require('express').Router();
const { auth } = require('../middleware/auth');
const supabase = require('../config/supabase');

router.use(auth);

// GET /api/call-analytics/best-time — AI recommendation for best calling windows
router.get('/best-time', async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: rows, error } = await supabase
      .from('call_analytics')
      .select('call_hour, call_day_of_week, answered, duration_sec')
      .eq('user_id', userId)
      .gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString());

    if (error) throw error;

    // Aggregate by hour
    const hourStats = {};
    for (let h = 0; h < 24; h++) hourStats[h] = { total: 0, answered: 0, avg_dur: 0, total_dur: 0 };

    for (const r of rows || []) {
      if (r.call_hour == null) continue;
      hourStats[r.call_hour].total++;
      if (r.answered) hourStats[r.call_hour].answered++;
      hourStats[r.call_hour].total_dur += r.duration_sec || 0;
    }

    const hourBreakdown = Object.entries(hourStats).map(([hour, s]) => ({
      hour: parseInt(hour),
      label: formatHour(parseInt(hour)),
      total_calls: s.total,
      answered:    s.answered,
      answer_rate: s.total > 0 ? Math.round((s.answered / s.total) * 100) : null,
      avg_duration: s.answered > 0 ? Math.round(s.total_dur / s.answered) : 0,
    })).filter(h => h.total_calls > 0);

    // Best windows (answer_rate >= 50% OR top 3 by answer_rate)
    const sorted = [...hourBreakdown].sort((a, b) => (b.answer_rate || 0) - (a.answer_rate || 0));
    const topWindows = sorted.slice(0, 3).map(w => ({
      ...w,
      recommendation: w.answer_rate >= 60
        ? '🔥 Prime time — high answer rate'
        : w.answer_rate >= 40
        ? '✅ Good window'
        : '⚠️ Below average answer rate',
    }));

    // Aggregate by day of week
    const dayStats = Array.from({ length: 7 }, (_, i) => ({
      day: i, label: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][i],
      total: 0, answered: 0,
    }));
    for (const r of rows || []) {
      if (r.call_day_of_week != null) {
        dayStats[r.call_day_of_week].total++;
        if (r.answered) dayStats[r.call_day_of_week].answered++;
      }
    }
    dayStats.forEach(d => {
      d.answer_rate = d.total > 0 ? Math.round((d.answered / d.total) * 100) : null;
    });

    res.json({
      success: true,
      top_windows: topWindows,
      hour_breakdown: hourBreakdown,
      day_breakdown: dayStats,
      data_points: rows?.length || 0,
      ai_tip: topWindows.length > 0
        ? `Your best calling time is ${topWindows[0].label} with a ${topWindows[0].answer_rate}% answer rate.`
        : 'Not enough data yet. Make more calls to unlock AI time recommendations.',
    });
  } catch (err) {
    console.error('[CallAnalytics] best-time error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load best time data' });
  }
});

// GET /api/call-analytics/silent-calls — calls where silence was detected
router.get('/silent-calls', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('call_analytics')
      .select('*, calls(vapi_call_id, recording_url), leads(first_name, last_name, phone)')
      .eq('user_id', req.user.id)
      .eq('was_silent', true)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    const total = data?.length || 0;
    const avgSilence = total > 0
      ? Math.round(data.reduce((s, r) => s + (r.silence_sec || 0), 0) / total)
      : 0;

    res.json({
      success: true,
      silent_calls: data || [],
      total,
      avg_silence_sec: avgSilence,
      recommendation: total > 10
        ? 'High silent call rate. Check phone number health and carrier registration.'
        : total > 5
        ? 'Moderate silent calls. Monitor number reputation score.'
        : 'Silent call rate looks healthy.',
    });
  } catch (err) {
    console.error('[CallAnalytics] silent-calls error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load silent calls' });
  }
});

// POST /api/call-analytics/log — log a call analytics event
router.post('/log', async (req, res) => {
  try {
    const { call_id, lead_id, duration_sec, was_silent, silence_sec, answered, sentiment } = req.body;

    const now = new Date();
    const { data, error } = await supabase
      .from('call_analytics')
      .insert({
        user_id:        req.user.id,
        call_id:        call_id  || null,
        lead_id:        lead_id  || null,
        duration_sec:   duration_sec  || 0,
        was_silent:     was_silent    || false,
        silence_sec:    silence_sec   || 0,
        answered:       answered      || false,
        sentiment:      sentiment     || null,
        call_hour:      now.getHours(),
        call_day_of_week: now.getDay(),
      })
      .select().single();

    if (error) throw error;
    res.json({ success: true, record: data });
  } catch (err) {
    console.error('[CallAnalytics] log error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to log call analytics' });
  }
});

// GET /api/call-analytics/summary — 30-day overview
router.get('/summary', async (req, res) => {
  try {
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data, error } = await supabase
      .from('call_analytics')
      .select('answered, was_silent, duration_sec')
      .eq('user_id', req.user.id)
      .gte('created_at', since);

    if (error) throw error;

    const rows = data || [];
    const total      = rows.length;
    const answered   = rows.filter(r => r.answered).length;
    const silent     = rows.filter(r => r.was_silent).length;
    const totalDur   = rows.reduce((s, r) => s + (r.duration_sec || 0), 0);
    const avgDur     = answered > 0 ? Math.round(totalDur / answered) : 0;

    res.json({
      success: true,
      summary: {
        total_calls: total,
        answered_calls: answered,
        silent_calls: silent,
        answer_rate: total > 0 ? Math.round((answered / total) * 100) : 0,
        silent_rate: total > 0 ? Math.round((silent  / total) * 100) : 0,
        avg_duration_sec: avgDur,
      },
    });
  } catch (err) {
    console.error('[CallAnalytics] summary error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load summary' });
  }
});

function formatHour(h) {
  if (h === 0)  return '12am';
  if (h < 12)   return `${h}am`;
  if (h === 12) return '12pm';
  return `${h - 12}pm`;
}

module.exports = router;
