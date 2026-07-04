/**
 * /api/sentiment
 * Seller Sentiment Timeline - track sentiment per call/SMS interaction
 * NEW FILE - does not modify any existing routes
 */
const express  = require('express');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const VALID_SENTIMENTS = ['Motivated', 'Neutral', 'Hesitant', 'Cold', 'Hostile'];

function tableMissing(err) {
  return err?.code === 'PGRST205' || (err?.message || '').includes('does not exist');
}

// GET /api/sentiment/:leadId - full sentiment timeline for a lead
router.get('/:leadId', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('sentiment_events')
      .select('*')
      .eq('lead_id', req.params.leadId)
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: true });

    if (error) {
      if (tableMissing(error)) return res.json({ success: true, timeline: [] });
      throw error;
    }
    res.json({ success: true, timeline: data || [] });
  } catch (err) { next(err); }
});

// GET /api/sentiment/user/summary - sentiment distribution across all leads
router.get('/user/summary', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('sentiment_events')
      .select('sentiment, lead_id')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      if (tableMissing(error)) return res.json({ success: true, summary: {} });
      throw error;
    }

    // Get latest sentiment per lead
    const latestPerLead = {};
    (data || []).forEach(e => {
      if (!latestPerLead[e.lead_id]) latestPerLead[e.lead_id] = e.sentiment;
    });

    const summary = VALID_SENTIMENTS.reduce((acc, s) => ({ ...acc, [s]: 0 }), {});
    Object.values(latestPerLead).forEach(s => { if (summary[s] !== undefined) summary[s]++; });

    res.json({ success: true, summary, totalLeads: Object.keys(latestPerLead).length });
  } catch (err) { next(err); }
});

// POST /api/sentiment - add a sentiment event
router.post('/', async (req, res, next) => {
  try {
    const { lead_id, call_id, source = 'call', sentiment, score, notes } = req.body;

    if (!lead_id) return res.status(400).json({ success: false, error: 'lead_id required' });
    if (!VALID_SENTIMENTS.includes(sentiment)) {
      return res.status(400).json({ success: false, error: `sentiment must be one of: ${VALID_SENTIMENTS.join(', ')}` });
    }

    const { data, error } = await supabase.from('sentiment_events').insert({
      lead_id,
      user_id:  req.user.id,
      call_id:  call_id || null,
      source,
      sentiment,
      score:    score || null,
      notes:    notes || null,
    }).select().single();

    if (error) {
      if (tableMissing(error)) return res.status(503).json({ success: false, error: 'Run migrations first' });
      throw error;
    }
    res.status(201).json({ success: true, event: data });
  } catch (err) { next(err); }
});

// POST /api/sentiment/auto-tag
// Infer sentiment from a motivation score and transcript snippet
router.post('/auto-tag', async (req, res, next) => {
  try {
    const { lead_id, call_id, motivation_score, transcript } = req.body;
    if (!lead_id) return res.status(400).json({ success: false, error: 'lead_id required' });

    let sentiment = 'Neutral';
    const score = Number(motivation_score) || 0;
    const text = (transcript || '').toLowerCase();

    if (text.includes('hostile') || text.includes('don\'t call') || text.includes('lawsuit') || text.includes('harass')) {
      sentiment = 'Hostile';
    } else if (score >= 75 || text.includes('want to sell') || text.includes('need to sell') || text.includes('motivated')) {
      sentiment = 'Motivated';
    } else if (score >= 50) {
      sentiment = 'Neutral';
    } else if (score >= 25 || text.includes('not sure') || text.includes('maybe') || text.includes('thinking about')) {
      sentiment = 'Hesitant';
    } else if (score < 25 || text.includes('not interested') || text.includes('not selling') || text.includes('listed')) {
      sentiment = 'Cold';
    }

    const { data, error } = await supabase.from('sentiment_events').insert({
      lead_id,
      user_id:   req.user.id,
      call_id:   call_id || null,
      source:    'call',
      sentiment,
      score:     score || null,
    }).select().single();

    if (error) {
      if (tableMissing(error)) return res.status(503).json({ success: false, error: 'Run migrations first' });
      throw error;
    }
    res.status(201).json({ success: true, event: data, inferred_sentiment: sentiment });
  } catch (err) { next(err); }
});

module.exports = router;
