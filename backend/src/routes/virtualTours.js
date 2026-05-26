/**
 * Features 34-38 — 3D Virtual Tour Engine
 * Routes: POST /api/tours, GET /api/tours, GET /api/tours/:id,
 *         POST /api/tours/:id/views, GET /api/tours/:token/public,
 *         GET /api/tours/:id/analytics
 */
const router  = require('express').Router();
const { requireAuth: auth } = require('../middleware/auth');
const supabase = require('../config/supabase');

router.use(auth);

// POST /api/tours — create a virtual tour from photos
router.post('/', async (req, res) => {
  try {
    const { listing_id, lead_id, title, photos = [], tour_type = 'slideshow' } = req.body;

    if (photos.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one photo required' });
    }

    let kuula_url  = null;
    let trolto_url = null;
    let status     = 'ready';

    // Attempt Trolto API (Feature 34)
    if (process.env.TROLTO_API_KEY && tour_type === '360') {
      try {
        const axios = require('axios');
        const { data: troltoResp } = await axios.post('https://api.trolto.com/v1/tours', {
          photos,
          title: title || 'Property Tour',
        }, {
          headers: { 'Authorization': `Bearer ${process.env.TROLTO_API_KEY}` },
          timeout: 30000,
        });
        trolto_url = troltoResp?.tour_url;
        status     = 'ready';
      } catch (e) {
        console.warn('[VirtualTours] Trolto error:', e.message);
        status = 'ready'; // fallback to slideshow
      }
    }

    // Attempt Kuula API (Feature 35)
    if (process.env.KUULA_API_KEY && tour_type === 'kuula') {
      try {
        const axios = require('axios');
        const { data: kuulaResp } = await axios.post('https://kuula.co/api/v1/spaces', {
          name: title || 'Property Tour',
        }, {
          headers: { 'Authorization': `Bearer ${process.env.KUULA_API_KEY}` },
          timeout: 30000,
        });
        kuula_url = kuulaResp?.url;
      } catch (e) {
        console.warn('[VirtualTours] Kuula error:', e.message);
      }
    }

    const { data, error } = await supabase
      .from('virtual_tours')
      .insert({
        user_id:    req.user.id,
        listing_id: listing_id || null,
        lead_id:    lead_id    || null,
        title:      title || 'Property Tour',
        photos,
        tour_type,
        kuula_url,
        trolto_url,
        status,
        is_public:  true,
      })
      .select().single();

    if (error) throw error;

    // Link to listing
    if (listing_id) {
      const publicUrl = `${process.env.FRONTEND_URL || 'https://veori.net'}/tour/${data.tour_token}`;
      await supabase.from('listings').update({ tour_url: publicUrl }).eq('id', listing_id);
    }

    res.json({ success: true, tour: data, public_url: `${process.env.FRONTEND_URL || 'https://veori.net'}/tour/${data.tour_token}` });
  } catch (err) {
    console.error('[VirtualTours] create error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to create virtual tour' });
  }
});

// GET /api/tours — all user tours
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('virtual_tours')
      .select('*, listings(title, address)')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ success: true, tours: data || [] });
  } catch (err) {
    console.error('[VirtualTours] list error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load tours' });
  }
});

// GET /api/tours/:id — tour detail
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('virtual_tours')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'Tour not found' });

    res.json({ success: true, tour: data });
  } catch (err) {
    console.error('[VirtualTours] get error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load tour' });
  }
});

// GET /api/tours/:id/analytics — Feature 38: Tour Analytics
router.get('/:id/analytics', async (req, res) => {
  try {
    const { data: views, error } = await supabase
      .from('tour_views')
      .select('*')
      .eq('tour_id', req.params.id)
      .order('viewed_at', { ascending: false });

    if (error) throw error;

    const rows    = views || [];
    const total   = rows.length;
    const avgDur  = total > 0 ? Math.round(rows.reduce((s, r) => s + (r.duration_sec || 0), 0) / total) : 0;

    const bySource = {};
    for (const v of rows) {
      const src = v.source || 'direct';
      bySource[src] = (bySource[src] || 0) + 1;
    }

    res.json({
      success: true,
      analytics: {
        total_views: total,
        avg_duration_sec: avgDur,
        by_source: bySource,
        recent_views: rows.slice(0, 20),
      },
    });
  } catch (err) {
    console.error('[VirtualTours] analytics error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load analytics' });
  }
});

// DELETE /api/tours/:id
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('virtual_tours')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('[VirtualTours] delete error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to delete tour' });
  }
});

module.exports = router;
