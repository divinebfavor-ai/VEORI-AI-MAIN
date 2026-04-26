const supabase = require('../config/supabase');
const { detectMarketTrends } = require('./dualAIService');

// ─── Nightly market intelligence scan (BullMQ job) ───────────────────────────
async function runMarketIntelligenceScan() {
  console.log('[MarketIntelligence] Running nightly scan...');
  try {
    const { data: markets } = await supabase.from('market_intelligence')
      .select('*')
      .order('updated_at', { ascending: false });

    if (!markets || markets.length === 0) return;

    // Get month-over-month changes
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();

    // Get motivation scores from deals this month vs last month
    const [thisMonth, prevMonth] = await Promise.all([
      supabase.from('leads').select('property_state, motivation_score')
        .not('motivation_score', 'is', null)
        .gte('created_at', new Date(now.getFullYear(), now.getMonth(), 1).toISOString()),
      supabase.from('leads').select('property_state, motivation_score')
        .not('motivation_score', 'is', null)
        .gte('created_at', lastMonth)
        .lt('created_at', new Date(now.getFullYear(), now.getMonth(), 1).toISOString()),
    ]);

    // Calculate avg motivation per state per period
    const thisMonthByState = groupByState(thisMonth.data || []);
    const prevMonthByState = groupByState(prevMonth.data || []);

    const marketData = Object.keys(thisMonthByState).map(state => {
      const thisAvg = thisMonthByState[state].avg;
      const prevAvg = prevMonthByState[state]?.avg || thisAvg;
      const change = prevAvg > 0 ? ((thisAvg - prevAvg) / prevAvg) * 100 : 0;

      return {
        state,
        this_month_avg_motivation: thisAvg,
        prev_month_avg_motivation: prevAvg,
        change_percentage: change,
      };
    });

    // Use Claude to detect trends
    const { alerts, summary } = await detectMarketTrends(marketData).catch(() => ({ alerts: [], summary: '' }));

    // Update market_intelligence table with trend data
    for (const item of marketData) {
      const direction = item.change_percentage > 5 ? 'up' : item.change_percentage < -5 ? 'down' : 'flat';
      await supabase.from('market_intelligence').upsert({
        state: item.state,
        avg_motivation_score: item.this_month_avg_motivation,
        trend_direction: direction,
        trend_percentage: Math.abs(item.change_percentage),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'state,county,metro' });
    }

    // Fire pulse notifications for significant rises (>15% month-over-month)
    const hotspots = marketData.filter(m => m.change_percentage > 15);
    for (const hotspot of hotspots) {
      const pct = Math.round(hotspot.change_percentage);
      // Get all operators active in this state
      const { data: operators } = await supabase.from('leads')
        .select('user_id')
        .eq('property_state', hotspot.state)
        .limit(100);

      const operatorIds = [...new Set((operators || []).map(o => o.user_id))];
      for (const operatorId of operatorIds) {
        await supabase.from('notifications').insert({
          operator_id: operatorId,
          type: 'market_hotspot',
          title: `📍 ${hotspot.state} is heating up`,
          message: `${hotspot.state} motivation scores up ${pct}% this month. This market is showing strong seller activity.`,
          is_read: false,
          created_at: new Date().toISOString(),
        });
      }
    }

    console.log(`[MarketIntelligence] Scan complete. ${hotspots.length} hotspots detected.`);
  } catch (err) {
    console.error('[MarketIntelligence] Scan error:', err.message);
  }
}

function groupByState(leads) {
  const groups = {};
  leads.forEach(l => {
    if (!l.property_state || l.motivation_score == null) return;
    if (!groups[l.property_state]) groups[l.property_state] = { scores: [] };
    groups[l.property_state].scores.push(l.motivation_score);
  });

  const result = {};
  for (const [state, { scores }] of Object.entries(groups)) {
    result[state] = { avg: Math.round(scores.reduce((s, n) => s + n, 0) / scores.length), count: scores.length };
  }
  return result;
}

module.exports = { runMarketIntelligenceScan };
