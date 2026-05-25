/**
 * /api/heatmap
 * Market Heat Map — lead density and motivation by zip code
 * NEW FILE — does not modify any existing routes
 */
const express  = require('express');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/heatmap — zip-code aggregated lead data
router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('leads')
      .select('property_zip, motivation_score, status, estimated_equity, estimated_value')
      .eq('user_id', req.user.id)
      .not('property_zip', 'is', null);

    if (error) throw error;
    if (!data || data.length === 0) return res.json({ success: true, heatmap: [] });

    // Aggregate by zip code
    const zipMap = {};
    for (const lead of data) {
      const zip = (lead.property_zip || '').replace(/\s/g, '').slice(0, 5);
      if (!zip || zip.length < 5) continue;

      if (!zipMap[zip]) {
        zipMap[zip] = {
          zip,
          count:        0,
          totalScore:   0,
          hotCount:     0,
          closedCount:  0,
          totalEquity:  0,
          totalValue:   0,
        };
      }

      const z = zipMap[zip];
      z.count++;
      z.totalScore += Number(lead.motivation_score) || 0;
      if ((lead.motivation_score || 0) >= 70) z.hotCount++;
      if (lead.status === 'closed') z.closedCount++;
      z.totalEquity += Number(lead.estimated_equity) || 0;
      z.totalValue  += Number(lead.estimated_value) || 0;
    }

    const heatmap = Object.values(zipMap).map(z => {
      const avgScore = z.count > 0 ? Math.round(z.totalScore / z.count) : 0;
      const heat     = avgScore >= 65 ? 'red' : avgScore >= 40 ? 'yellow' : 'grey';
      const avgEquity = z.totalValue > 0
        ? Math.round((z.totalEquity / z.totalValue) * 100)
        : 0;

      return {
        zip:          z.zip,
        count:        z.count,
        avg_score:    avgScore,
        hot_count:    z.hotCount,
        closed_count: z.closedCount,
        avg_equity_pct: avgEquity,
        heat,          // red|yellow|grey
      };
    });

    // Sort by count descending
    heatmap.sort((a, b) => b.count - a.count);

    res.json({ success: true, heatmap, totalZips: heatmap.length });
  } catch (err) { next(err); }
});

// GET /api/heatmap/top-zips — top 10 zip codes by hot lead density
router.get('/top-zips', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('leads')
      .select('property_zip, motivation_score')
      .eq('user_id', req.user.id)
      .gte('motivation_score', 60)
      .not('property_zip', 'is', null);

    if (error) throw error;

    const zipCount = {};
    for (const lead of data || []) {
      const zip = (lead.property_zip || '').slice(0, 5);
      if (!zip) continue;
      zipCount[zip] = (zipCount[zip] || 0) + 1;
    }

    const topZips = Object.entries(zipCount)
      .map(([zip, count]) => ({ zip, hot_leads: count }))
      .sort((a, b) => b.hot_leads - a.hot_leads)
      .slice(0, 10);

    res.json({ success: true, topZips });
  } catch (err) { next(err); }
});

module.exports = router;
