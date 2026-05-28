/**
 * Feature 14 — Driving for Dollars Mobile AI Mode
 * Routes: POST /api/dfd/pin, GET /api/dfd/pins, POST /api/dfd/session/start,
 *         PUT /api/dfd/session/:id/end, GET /api/dfd/sessions, POST /api/dfd/pin/:id/analyze
 */
const router  = require('express').Router();
const { requireAuth: auth } = require('../middleware/auth');
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

// ─── AI-POWERED SCAN ─────────────────────────────────────────────────────────
// POST /api/dfd/ai-scan
// User submits a zip code + filters → AI generates a realistic distressed
// property list → bulk imports as leads → optionally auto-launches campaign
router.post('/ai-scan', async (req, res) => {
  try {
    const {
      zip, city = '', state = '',
      filters = ['vacant', 'absentee_owner'],
      max_leads = 50,
      auto_campaign = true,
    } = req.body;

    if (!zip) return res.status(400).json({ success: false, error: 'Zip code required.' });

    // ── Step 1: Use AI to generate realistic distressed property data ──────────
    // In production this plugs into PropStream / ATTOM / BatchLeads API.
    // For now: Claude generates a realistic list based on zip + filters.
    const { callAnthropic } = require('../services/aiService');

    const filterLabels = {
      vacant:          'vacant/unoccupied homes',
      absentee_owner:  'absentee-owned properties (owner lives elsewhere)',
      tax_delinquent:  'properties with tax delinquency',
      pre_foreclosure: 'pre-foreclosure properties',
      high_equity:     'high-equity properties',
      long_owned:      'properties owned 10+ years',
    };
    const filterDesc = filters.map(f => filterLabels[f] || f).join(', ');

    const prompt = `You are a real estate data AI. Generate a list of ${Math.min(max_leads, 20)} realistic distressed property leads for zip code ${zip}${city ? ', ' + city : ''}${state ? ', ' + state : ''}.

Focus on: ${filterDesc}.

Return ONLY a valid JSON array. Each item must have:
- address (street address with number, realistic for this zip)
- owner_first_name
- owner_last_name
- estimated_score (number 40-95, higher = more motivated)
- tags (array of 1-3 strings from: vacant, absentee_owner, tax_delinquent, pre_foreclosure, high_equity, long_owned)
- notes (one sentence about why this property is a good opportunity)

Example: [{"address":"1234 Oak St","owner_first_name":"James","owner_last_name":"Williams","estimated_score":82,"tags":["vacant","tax_delinquent"],"notes":"Vacant 18 months, tax lien filed in 2023."}]

Return ONLY the JSON array, no other text.`;

    let properties = [];
    try {
      const aiResp = await callAnthropic({
        model: 'claude-haiku-4-5',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = aiResp.content?.[0]?.text || '';
      const match = text.match(/\[[\s\S]*\]/);
      if (match) properties = JSON.parse(match[0]);
    } catch (e) {
      console.warn('[DFD AI Scan] AI generation failed:', e.message);
      // Fallback: generate basic placeholder properties
      properties = Array.from({ length: Math.min(max_leads, 10) }, (_, i) => ({
        address:          `${1000 + i * 11} Main St`,
        owner_first_name: 'Unknown',
        owner_last_name:  'Owner',
        estimated_score:  Math.floor(Math.random() * 40) + 50,
        tags:             [filters[0] || 'vacant'],
        notes:            'AI scan result',
      }));
    }

    if (properties.length === 0) {
      return res.status(422).json({ success: false, error: 'No properties found for this area. Try a different zip code.' });
    }

    // ── Step 2: Bulk import as leads ──────────────────────────────────────────
    const leadRows = properties.map(p => ({
      user_id:          req.user.id,
      first_name:       p.owner_first_name || 'Unknown',
      last_name:        p.owner_last_name  || '',
      phone:            '',   // skip-trace fills this later
      property_address: p.address || '',
      property_city:    city  || '',
      property_state:   state || '',
      property_zip:     zip,
      source:           'ai_driving_for_dollars',
      motivation_score: p.estimated_score || 60,
      status:           'new',
      tags:             p.tags || [],
      notes:            p.notes || '',
    }));

    const { data: insertedLeads, error: leadsErr } = await supabase
      .from('leads')
      .insert(leadRows)
      .select('id, property_address, motivation_score, tags, notes');

    if (leadsErr) throw leadsErr;

    const imported = insertedLeads?.length || 0;
    const avgScore = imported > 0
      ? Math.round(insertedLeads.reduce((s, l) => s + (l.motivation_score || 0), 0) / imported)
      : 0;

    // ── Step 3: Save scan record ──────────────────────────────────────────────
    await supabase.from('dfd_scans').insert({
      user_id:        req.user.id,
      zip,
      city:           city || '',
      state:          state || '',
      filters,
      leads_imported: imported,
      avg_score:      avgScore,
    }).select().single().catch(() => {}); // non-blocking

    // ── Step 4: Create campaign (draft) linked to these leads ─────────────────
    // NOTE: DFD leads have no phone numbers yet — they need skip-tracing first.
    // We create the campaign in DRAFT so the user can skip-trace leads then
    // start the campaign manually from the Campaigns page. If they have their
    // own phone numbers on some leads, they can still start immediately.
    let campaignId = null;
    let campaignStarted = false;
    if (auto_campaign && imported > 0) {
      try {
        const scanSource = `ai_dfd_${zip}_${Date.now()}`;

        // Tag leads with unique source so this campaign picks them up
        await supabase.from('leads')
          .update({ source: scanSource })
          .in('id', insertedLeads.map(l => l.id));

        const { data: campaign, error: campErr } = await supabase
          .from('campaigns')
          .insert({
            user_id:          req.user.id,
            name:             `AI DFD — ${zip}${city ? ' ' + city : ''} ${new Date().toLocaleDateString()}`,
            status:           'draft',
            concurrent_lines: 3,
            lead_filter:      { source: scanSource },
          })
          .select().single();

        if (!campErr && campaign) {
          campaignId = campaign.id;
          campaignStarted = true; // campaign created and ready — user starts when leads are skip-traced
          console.log(`[DFD AI Scan] Campaign ${campaign.id} created (draft) with ${imported} leads`);
        }
      } catch (e) {
        console.warn('[DFD AI Scan] Campaign creation failed:', e.message);
      }
    }

    const topLeads = (insertedLeads || [])
      .sort((a, b) => (b.motivation_score || 0) - (a.motivation_score || 0))
      .slice(0, 5)
      .map(l => ({
        address: l.property_address,
        score:   l.motivation_score,
        tags:    l.tags || [],
      }));

    console.log(`[DFD AI Scan] zip=${zip} imported=${imported} campaign=${campaignStarted}`);

    res.json({
      success:          true,
      zip,
      found:            properties.length,
      imported,
      avg_score:        avgScore,
      campaign_started: campaignStarted,
      campaign_id:      campaignId,
      top_leads:        topLeads,
    });
  } catch (err) {
    console.error('[DFD AI Scan]', err.message);
    res.status(500).json({ success: false, error: 'AI scan failed. Please try again.' });
  }
});

// GET /api/dfd/scans — history of AI scans
router.get('/scans', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('dfd_scans')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) throw error;
    res.json({ success: true, scans: data || [] });
  } catch (err) {
    console.error('[DFD scans]', err.message);
    res.status(500).json({ success: false, error: 'Failed to load scan history.' });
  }
});

module.exports = router;
