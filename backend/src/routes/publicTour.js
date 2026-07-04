/**
 * Feature 36 - Public Tour Page (no auth required)
 * Routes: GET /api/tour/:token - public tour view by token
 *         POST /api/tour/:token/view - log a view
 */
const router  = require('express').Router();
const supabase = require('../config/supabase');

// GET /api/tour/:token - public tour
router.get('/:token', async (req, res) => {
  try {
    const { data: tour, error } = await supabase
      .from('virtual_tours')
      .select('id, title, photos, tour_type, kuula_url, trolto_url, status, listing_id, created_at')
      .eq('tour_token', req.params.token)
      .eq('is_public', true)
      .single();

    if (error || !tour) return res.status(404).json({ success: false, error: 'Tour not found or no longer public' });

    // Fetch listing data if linked
    let listing = null;
    if (tour.listing_id) {
      const { data } = await supabase
        .from('listings')
        .select('title, address, city, state, zip, asking_price, arv, bedrooms, bathrooms, sqft, description, highlights')
        .eq('id', tour.listing_id)
        .single();
      listing = data;
    }

    res.json({ success: true, tour, listing });
  } catch (err) {
    console.error('[PublicTour] get error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load tour' });
  }
});

// POST /api/tour/:token/view - log a view (Feature 38)
router.post('/:token/view', async (req, res) => {
  try {
    const { source, duration_sec } = req.body;

    const { data: tour } = await supabase
      .from('virtual_tours')
      .select('id')
      .eq('tour_token', req.params.token)
      .single();

    if (!tour) return res.status(404).json({ success: false, error: 'Tour not found' });

    await supabase.from('tour_views').insert({
      tour_id:      tour.id,
      viewer_ip:    req.ip || null,
      viewer_agent: req.headers['user-agent'] || null,
      duration_sec: duration_sec || 0,
      source:       source || 'direct',
    });

    res.json({ success: true });
  } catch (err) {
    console.error('[PublicTour] view error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to log view' });
  }
});

module.exports = router;
