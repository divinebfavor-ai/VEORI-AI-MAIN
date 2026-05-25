/**
 * Feature 14 — Driving for Dollars Mobile AI Mode
 * Routes: POST /api/dfd/pin, GET /api/dfd/pins, POST /api/dfd/session/start,
 *         PUT /api/dfd/session/:id/end, GET /api/dfd/sessions, POST /api/dfd/pin/:id/analyze
 */
const router  = require('express').Router();
const { auth } = require('../middleware/auth');
const supabase = require('../config/supabase');

router.use(auth);

// POST /api/dfd/session/start
router.post('/session/start', async (req, res) => {
  try {
    const { area_name } = req.body;
    const { data, error } = await supabase
      .from('dfd_sessions')
      .insert({ user_id: req.user.id, area_name: area_name || 'Unknown Area' })
      .select().single();
    if (error) throw error;
    res.json({ success: true, session: data });
  } catch (err) {
    console.error('[DFD] session start error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to start session' });
  }
});

// PUT /api/dfd/session/:id/end
router.put('/session/:id/end', async (req, res) => {
  try {
    const { miles_driven } = req.body;
    const { data: pinCount } = await supabase
      .from('dfd_pins')
      .select('id', { count: 'exact' })
      .eq('session_id', req.params.id)
      .eq('user_id', req.user.id);

    const { data, error } = await supabase
      .from('dfd_sessions')
      .update({
        ended_at:    new Date().toISOString(),
        miles_driven: miles_driven || 0,
        pin_count:   pinCount?.length || 0,
      })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select().single();

    if (error) throw error;
    res.json({ success: true, session: data });
  } catch (err) {
    console.error('[DFD] session end error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to end session' });
  }
});

// GET /api/dfd/sessions
router.get('/sessions', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('dfd_sessions')
      .select('*')
      .eq('user_id', req.user.id)
      .order('started_at', { ascending: false })
      .limit(20);
    if (error) throw error;
    res.json({ success: true, sessions: data || [] });
  } catch (err) {
    console.error('[DFD] sessions error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load sessions' });
  }
});

// POST /api/dfd/pin — add a pin
router.post('/pin', async (req, res) => {
  try {
    const { lat, lng, address, notes, condition, session_id } = req.body;
    if (!lat || !lng) return res.status(400).json({ success: false, error: 'lat/lng required' });

    const { data, error } = await supabase
      .from('dfd_pins')
      .insert({
        user_id: req.user.id,
        session_id: session_id || null,
        lat, lng, address: address || '',
        notes: notes || '',
        condition: condition || 'unknown',
      })
      .select().single();

    if (error) throw error;
    res.json({ success: true, pin: data });
  } catch (err) {
    console.error('[DFD] pin error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to save pin' });
  }
});

// GET /api/dfd/pins
router.get('/pins', async (req, res) => {
  try {
    const { session_id } = req.query;
    let query = supabase
      .from('dfd_pins')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (session_id) query = query.eq('session_id', session_id);

    const { data, error } = await query.limit(200);
    if (error) throw error;
    res.json({ success: true, pins: data || [] });
  } catch (err) {
    console.error('[DFD] pins error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load pins' });
  }
});

// POST /api/dfd/pin/:id/analyze — AI analysis of property condition
router.post('/pin/:id/analyze', async (req, res) => {
  try {
    const { address, condition, notes } = req.body;

    // Build AI-like analysis without external API dependency
    const conditionMap = {
      vacant:    { risk: 'High', opportunity: 'Excellent', action: 'Skip-trace immediately', score: 85 },
      distressed: { risk: 'Medium', opportunity: 'Very Good', action: 'Mail + call within 48h', score: 75 },
      good:      { risk: 'Low', opportunity: 'Moderate', action: 'Add to standard outreach', score: 50 },
      unknown:   { risk: 'Unknown', opportunity: 'Unknown', action: 'Drive by again / research', score: 40 },
    };

    const info = conditionMap[condition] || conditionMap.unknown;
    const analysis = {
      condition_label: condition,
      opportunity_score: info.score,
      risk_level: info.risk,
      opportunity_level: info.opportunity,
      recommended_action: info.action,
      reasoning: `Property at ${address || 'this location'} appears ${condition}. ${notes ? `Notes: ${notes}.` : ''} ${info.action}.`,
      suggested_template: condition === 'vacant' ? 'no_answer' : condition === 'distressed' ? 'motivated' : 'last_chance',
    };

    // Update pin with analysis
    const { error } = await supabase
      .from('dfd_pins')
      .update({ ai_analysis: analysis })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);

    if (error) throw error;
    res.json({ success: true, analysis });
  } catch (err) {
    console.error('[DFD] analyze error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to analyze property' });
  }
});

// POST /api/dfd/pin/:id/convert-lead — convert pin to lead
router.post('/pin/:id/convert-lead', async (req, res) => {
  try {
    const { first_name, last_name, phone, address } = req.body;

    const { data: pin } = await supabase
      .from('dfd_pins')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();

    if (!pin) return res.status(404).json({ success: false, error: 'Pin not found' });

    const { data: lead, error } = await supabase
      .from('leads')
      .insert({
        user_id:          req.user.id,
        first_name:       first_name || 'Unknown',
        last_name:        last_name  || '',
        phone:            phone || '',
        property_address: address || pin.address || '',
        source:           'driving_for_dollars',
        motivation_score: pin.ai_analysis?.opportunity_score || 50,
        notes:            `DFD Pin. Condition: ${pin.condition}. ${pin.notes || ''}`,
      })
      .select().single();

    if (error) throw error;

    // Link pin to lead
    await supabase.from('dfd_pins').update({ lead_id: lead.id }).eq('id', pin.id);

    res.json({ success: true, lead });
  } catch (err) {
    console.error('[DFD] convert error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to convert pin to lead' });
  }
});

module.exports = router;
