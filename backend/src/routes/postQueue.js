/**
 * Social Media Post Queue — Feature 29 (Section 6 of Master Build)
 * Routes:
 *   GET    /api/post-queue          — list queue items (filter by tab/status)
 *   POST   /api/post-queue          — create/schedule a post
 *   PATCH  /api/post-queue/:id/cancel — cancel a pending/scheduled post
 *   POST   /api/post-queue/:id/retry  — retry a failed post
 */
const router  = require('express').Router();
const { requireAuth: auth } = require('../middleware/auth');
const supabase = require('../config/supabase');

router.use(auth);

const VALID_STATUSES = ['pending', 'scheduled', 'published', 'failed', 'cancelled'];

// ─── GET /api/post-queue ──────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { tab = 'all', limit = 50, offset = 0 } = req.query;

    let query = supabase
      .from('post_queue')
      .select('*', { count: 'exact' })
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (tab === 'queue') {
      query = query.in('status', ['pending', 'scheduled']);
    } else if (tab !== 'all' && VALID_STATUSES.includes(tab)) {
      query = query.eq('status', tab);
    }

    const { data: posts, count, error } = await query;
    if (error) throw error;

    res.json({ posts: posts || [], total: count || 0 });
  } catch (err) {
    console.error('[postQueue GET]', err.message);
    res.status(500).json({ error: 'Failed to load post queue' });
  }
});

// ─── POST /api/post-queue ─────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const {
      caption,
      platforms = [],
      scheduled_at = null,
      post_type = 'manual',
      media_urls = [],
      lead_id = null,
      listing_id = null,
    } = req.body;

    if (!caption || !caption.trim()) {
      return res.status(400).json({ error: 'Caption is required' });
    }
    if (!Array.isArray(platforms) || platforms.length === 0) {
      return res.status(400).json({ error: 'At least one platform is required' });
    }

    const status = scheduled_at ? 'scheduled' : 'pending';

    // Create one queue entry per platform
    const rows = platforms.map(platform => ({
      user_id: req.user.id,
      platform,
      caption: caption.trim(),
      scheduled_at: scheduled_at || null,
      status,
      post_type,
      media_urls,
      lead_id,
      listing_id,
      retry_count: 0,
    }));

    const { data, error } = await supabase
      .from('post_queue')
      .insert(rows)
      .select();

    if (error) throw error;

    res.status(201).json({ posts: data, message: `${rows.length} post(s) ${status}` });
  } catch (err) {
    console.error('[postQueue POST]', err.message);
    res.status(500).json({ error: 'Failed to create post' });
  }
});

// ─── PATCH /api/post-queue/:id/cancel ────────────────────────────────────────
router.patch('/:id/cancel', async (req, res) => {
  try {
    const { data: existing } = await supabase
      .from('post_queue')
      .select('id, user_id, status')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();

    if (!existing) return res.status(404).json({ error: 'Post not found' });
    if (!['pending', 'scheduled'].includes(existing.status)) {
      return res.status(400).json({ error: 'Only pending or scheduled posts can be cancelled' });
    }

    const { error } = await supabase
      .from('post_queue')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);

    if (error) throw error;
    res.json({ message: 'Post cancelled' });
  } catch (err) {
    console.error('[postQueue CANCEL]', err.message);
    res.status(500).json({ error: 'Failed to cancel post' });
  }
});

// ─── POST /api/post-queue/:id/retry ──────────────────────────────────────────
router.post('/:id/retry', async (req, res) => {
  try {
    const { data: existing } = await supabase
      .from('post_queue')
      .select('id, user_id, status, retry_count')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();

    if (!existing) return res.status(404).json({ error: 'Post not found' });
    if (existing.status !== 'failed') {
      return res.status(400).json({ error: 'Only failed posts can be retried' });
    }

    const { error } = await supabase
      .from('post_queue')
      .update({
        status: 'pending',
        retry_count: (existing.retry_count || 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);

    if (error) throw error;
    res.json({ message: 'Post queued for retry' });
  } catch (err) {
    console.error('[postQueue RETRY]', err.message);
    res.status(500).json({ error: 'Failed to retry post' });
  }
});

// ─── POST /api/post-queue/auto-trigger ───────────────────────────────────────
// Called internally when a deal closes, listing publishes, etc.
router.post('/auto-trigger', async (req, res) => {
  try {
    const {
      trigger_type,   // 'deal_closed' | 'listing_published' | 'deal_assigned'
      context = {},   // { lead_name, arv, assignment_fee, listing_address, ... }
    } = req.body;

    let caption = '';
    if (trigger_type === 'deal_closed') {
      caption = `Just closed another wholesale deal! ARV: $${context.arv?.toLocaleString() || '0'}. Assignment fee: $${context.assignment_fee?.toLocaleString() || '0'}. Let's go! #WholesaleRealEstate #Veori`;
    } else if (trigger_type === 'listing_published') {
      caption = `New off-market property available: ${context.listing_address || 'Contact us for details'}. Serious buyers only. DM to learn more. #OffMarket #RealEstateInvesting`;
    } else if (trigger_type === 'deal_assigned') {
      caption = `Deal assigned! Building wealth one property at a time. #WholesaleDeals #RealEstate #Investing`;
    } else {
      return res.status(400).json({ error: 'Unknown trigger_type' });
    }

    // Get user's connected platforms
    const { data: connections } = await supabase
      .from('social_connections')
      .select('platform')
      .eq('user_id', req.user.id)
      .eq('connected', true);

    const platforms = (connections || []).map(c => c.platform);
    if (platforms.length === 0) {
      return res.json({ message: 'No connected platforms — post skipped', platforms: [] });
    }

    const rows = platforms.map(platform => ({
      user_id: req.user.id,
      platform,
      caption,
      status: 'pending',
      post_type: trigger_type,
      retry_count: 0,
      ...context,
    }));

    const { data, error } = await supabase.from('post_queue').insert(rows).select();
    if (error) throw error;

    res.json({ message: `Auto-post triggered for ${platforms.join(', ')}`, posts: data });
  } catch (err) {
    console.error('[postQueue AUTO-TRIGGER]', err.message);
    res.status(500).json({ error: 'Auto-trigger failed' });
  }
});

module.exports = router;
