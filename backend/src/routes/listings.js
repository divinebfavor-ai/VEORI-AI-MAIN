/**
 * Features 22-24, 27 - Property Listings, Buyer Qualification, Assignment Contracts
 * Routes: CRUD /api/listings, POST /api/listings/:id/blast, POST /api/listings/:id/inquire,
 *         POST /api/listings/:id/qualify-buyers, POST /api/listings/:id/assignment
 */
const router  = require('express').Router();
const { requireAuth: auth } = require('../middleware/auth');
const supabase = require('../config/supabase');

router.use(auth);

// ─── LISTINGS CRUD ────────────────────────────────────────────────────────────

// GET /api/listings - all user listings
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    let query = supabase
      .from('listings')
      .select('*, leads(first_name, last_name)')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;
    res.json({ success: true, listings: data || [] });
  } catch (err) {
    console.error('[Listings] list error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load listings' });
  }
});

// GET /api/listings/:id - single listing
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('listings')
      .select('*, leads(*), buyer_inquiries(*, buyers(name, email, phone))')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'Listing not found' });
    res.json({ success: true, listing: data });
  } catch (err) {
    console.error('[Listings] get error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load listing' });
  }
});

// POST /api/listings - create listing
router.post('/', async (req, res) => {
  try {
    const {
      lead_id, title, description, asking_price, arv, repair_cost,
      property_type, bedrooms, bathrooms, sqft, year_built,
      address, city, state, zip, highlights, photos,
    } = req.body;

    if (!title) return res.status(400).json({ success: false, error: 'Title required' });

    const equity = arv && asking_price ? Math.round(arv - asking_price - (repair_cost || 0)) : null;

    const { data, error } = await supabase
      .from('listings')
      .insert({
        user_id: req.user.id,
        lead_id:       lead_id   || null,
        title,
        description:   description || '',
        asking_price:  asking_price || null,
        arv:           arv || null,
        repair_cost:   repair_cost || null,
        equity,
        property_type: property_type || 'single_family',
        bedrooms:      bedrooms || null,
        bathrooms:     bathrooms || null,
        sqft:          sqft || null,
        year_built:    year_built || null,
        address:       address || '',
        city:          city || '',
        state:         state || '',
        zip:           zip || '',
        highlights:    highlights || [],
        photos:        photos || [],
        status:        'draft',
      })
      .select().single();

    if (error) throw error;
    res.json({ success: true, listing: data });
  } catch (err) {
    console.error('[Listings] create error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to create listing' });
  }
});

// PUT /api/listings/:id - update listing
router.put('/:id', async (req, res) => {
  try {
    const allowed = [
      'title','description','asking_price','arv','repair_cost','equity',
      'property_type','bedrooms','bathrooms','sqft','year_built',
      'address','city','state','zip','highlights','photos','status','tour_url',
    ];
    const updates = {};
    for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('listings')
      .update(updates)
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select().single();

    if (error) throw error;
    res.json({ success: true, listing: data });
  } catch (err) {
    console.error('[Listings] update error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to update listing' });
  }
});

// ─── PHOTO ENHANCEMENT - Real-ESRGAN via Replicate ───────────────────────────
// POST /api/listings/:id/enhance-photos
// Upscales every photo in the listing using Real-ESRGAN (4x, face enhance on)
// Saves enhanced URLs back to listing.photos[] and returns them
router.post('/:id/enhance-photos', async (req, res) => {
  try {
    const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;
    if (!REPLICATE_TOKEN) {
      return res.status(503).json({ success: false, error: 'Photo enhancement not configured yet.' });
    }

    // Load listing + verify ownership
    const { data: listing, error: listErr } = await supabase
      .from('listings')
      .select('id, photos')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();

    if (listErr || !listing) return res.status(404).json({ success: false, error: 'Listing not found.' });

    const photos = listing.photos || [];
    if (photos.length === 0) return res.status(400).json({ success: false, error: 'No photos to enhance.' });

    const axios = require('axios');

    // Helper: run one photo through Real-ESRGAN and wait for result
    async function enhanceOne(imageUrl) {
      // Start prediction
      const start = await axios.post(
        'https://api.replicate.com/v1/models/nightmareai/real-esrgan/predictions',
        {
          input: {
            image:         imageUrl,
            scale:         4,
            face_enhance:  false,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${REPLICATE_TOKEN}`,
            'Content-Type': 'application/json',
            Prefer: 'wait',  // Replicate will wait up to 60s and return inline
          },
          timeout: 90000,
        }
      );

      const prediction = start.data;

      // If Prefer:wait returned a completed result inline
      if (prediction.status === 'succeeded' && prediction.output) {
        return prediction.output;
      }

      // Otherwise poll until done (max 90s)
      const pollUrl = prediction.urls?.get || `https://api.replicate.com/v1/predictions/${prediction.id}`;
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const poll = await axios.get(pollUrl, {
          headers: { Authorization: `Bearer ${REPLICATE_TOKEN}` },
          timeout: 15000,
        });
        if (poll.data.status === 'succeeded') return poll.data.output;
        if (poll.data.status === 'failed')    throw new Error('Enhancement failed for image');
      }
      throw new Error('Enhancement timed out');
    }

    // Enhance up to 6 photos (keep cost reasonable)
    const toEnhance = photos.slice(0, 6);
    const enhanced  = [];
    const errors    = [];

    for (const url of toEnhance) {
      try {
        const result = await enhanceOne(url);
        enhanced.push(result || url);
      } catch (e) {
        console.warn('[enhance-photos] skipped one photo:', e.message);
        enhanced.push(url); // keep original on failure
        errors.push(e.message);
      }
    }

    // Merge: enhanced + any photos beyond the first 6 (unchanged)
    const newPhotos = [...enhanced, ...photos.slice(6)];

    // Save back to listing
    await supabase
      .from('listings')
      .update({ photos: newPhotos, updated_at: new Date().toISOString() })
      .eq('id', req.params.id);

    console.log(`[enhance-photos] listing ${req.params.id}: ${enhanced.length} photos enhanced`);
    res.json({ success: true, photos: newPhotos, enhanced: enhanced.length, errors });
  } catch (err) {
    console.error('[enhance-photos]', err.message);
    res.status(500).json({ success: false, error: 'Photo enhancement failed. Please try again.' });
  }
});

// DELETE /api/listings/:id
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('listings')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('[Listings] delete error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to delete listing' });
  }
});

// ─── FEATURE 23: BLAST ────────────────────────────────────────────────────────

// POST /api/listings/:id/blast - multi-platform blast
router.post('/:id/blast', async (req, res) => {
  try {
    const { platforms = [] } = req.body;
    if (platforms.length === 0) {
      return res.status(400).json({ success: false, error: 'Select at least one platform' });
    }

    const { data: listing } = await supabase
      .from('listings')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();

    if (!listing) return res.status(404).json({ success: false, error: 'Listing not found' });

    // Check social connections
    const { data: connections } = await supabase
      .from('social_connections')
      .select('platform, account_name, connected')
      .eq('user_id', req.user.id)
      .in('platform', platforms);

    const results = {};
    for (const platform of platforms) {
      const conn = connections?.find(c => c.platform === platform && c.connected);
      if (conn) {
        results[platform] = { status: 'queued', account: conn.account_name };
      } else {
        results[platform] = { status: 'not_connected', error: `${platform} account not connected` };
      }
    }

    // Log the blast
    const { data: blast } = await supabase
      .from('listing_blasts')
      .insert({ listing_id: req.params.id, user_id: req.user.id, platforms, results })
      .select().single();

    // Update listing's published_to
    const alreadyPublished = listing.published_to || [];
    const newPublished = [...new Set([...alreadyPublished, ...platforms.filter(p => results[p].status === 'queued')])];
    await supabase.from('listings').update({ published_to: newPublished, status: 'active' }).eq('id', req.params.id);

    res.json({ success: true, blast, results });
  } catch (err) {
    console.error('[Listings] blast error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to blast listing' });
  }
});

// ─── FEATURE 24: BUYER QUALIFICATION ─────────────────────────────────────────

// POST /api/listings/:id/inquire - buyer submits inquiry (public-facing, no auth)
router.post('/:id/inquire', async (req, res) => {
  try {
    const { buyer_name, buyer_email, buyer_phone, message, buyer_id } = req.body;
    if (!buyer_name || !buyer_email) {
      return res.status(400).json({ success: false, error: 'Name and email required' });
    }

    const { data: listing } = await supabase
      .from('listings')
      .select('id, user_id, title')
      .eq('id', req.params.id)
      .single();

    if (!listing) return res.status(404).json({ success: false, error: 'Listing not found' });

    const { data, error } = await supabase
      .from('buyer_inquiries')
      .insert({
        listing_id:  req.params.id,
        user_id:     listing.user_id,
        buyer_id:    buyer_id || null,
        buyer_name, buyer_email, buyer_phone: buyer_phone || '',
        message: message || '',
        status: 'new',
        ai_score: 50, // default until qualified
      })
      .select().single();

    if (error) throw error;
    res.json({ success: true, inquiry: data });
  } catch (err) {
    console.error('[Listings] inquire error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to submit inquiry' });
  }
});

// POST /api/listings/:id/qualify-buyers - AI qualify all pending inquiries
router.post('/:id/qualify-buyers', async (req, res) => {
  try {
    const { data: inquiries, error } = await supabase
      .from('buyer_inquiries')
      .select('*')
      .eq('listing_id', req.params.id)
      .eq('user_id', req.user.id)
      .eq('status', 'new');

    if (error) throw error;

    const qualified = [];
    for (const inq of inquiries || []) {
      // Score based on available signals (no external AI needed)
      let score = 50;
      const qual = {};

      if (inq.buyer_phone) { score += 10; qual.has_phone = true; }
      if (inq.message && inq.message.length > 50) { score += 10; qual.detailed_message = true; }

      // Check if buyer exists in buyers table (has history)
      if (inq.buyer_id) {
        const { data: buyer } = await supabase
          .from('buyers')
          .select('verified, deals_closed')
          .eq('id', inq.buyer_id)
          .single();
        if (buyer?.verified)     { score += 20; qual.verified_buyer = true; }
        if (buyer?.deals_closed) { score += 10; qual.has_closed_deals = true; }
      }

      score = Math.min(100, score);
      const status = score >= 70 ? 'qualified' : score >= 40 ? 'new' : 'rejected';

      await supabase
        .from('buyer_inquiries')
        .update({ ai_score: score, qualification: qual, status })
        .eq('id', inq.id);

      qualified.push({ ...inq, ai_score: score, qualification: qual, status });
    }

    res.json({ success: true, qualified, total: qualified.length });
  } catch (err) {
    console.error('[Listings] qualify error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to qualify buyers' });
  }
});

// ─── FEATURE 27: ASSIGNMENT CONTRACTS ────────────────────────────────────────

// POST /api/listings/:id/assignment - create assignment contract
router.post('/:id/assignment', async (req, res) => {
  try {
    const { buyer_id, buyer_name, purchase_price, assignment_fee } = req.body;
    if (!purchase_price || !assignment_fee) {
      return res.status(400).json({ success: false, error: 'purchase_price and assignment_fee required' });
    }

    const { data: listing } = await supabase
      .from('listings')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();

    if (!listing) return res.status(404).json({ success: false, error: 'Listing not found' });

    const { data: operator } = await supabase
      .from('operator_profiles')
      .select('full_name, company_name')
      .eq('user_id', req.user.id)
      .single();

    let buyerName = buyer_name;
    if (!buyerName && buyer_id) {
      const { data: buyer } = await supabase.from('buyers').select('name').eq('id', buyer_id).single();
      buyerName = buyer?.name;
    }

    const { data: contract, error } = await supabase
      .from('assignment_contracts')
      .insert({
        user_id:          req.user.id,
        listing_id:       req.params.id,
        buyer_id:         buyer_id || null,
        assignor_name:    operator?.full_name || operator?.company_name || 'Assignor',
        assignee_name:    buyerName || 'Assignee',
        property_address: listing.address + ', ' + listing.city + ', ' + listing.state + ' ' + listing.zip,
        purchase_price,
        assignment_fee,
        status:           'draft',
      })
      .select().single();

    if (error) throw error;

    // Attempt DropboxSign
    let signUrl = null;
    try {
      const dropboxSignService = require('../services/dropboxSignService');
      const signResult = await dropboxSignService.createAssignmentContract({
        assignorName:     contract.assignor_name,
        assigneeName:     contract.assignee_name,
        propertyAddress:  contract.property_address,
        purchasePrice:    purchase_price,
        assignmentFee:    assignment_fee,
      });
      signUrl = signResult?.sign_url;
      await supabase.from('assignment_contracts').update({
        sign_url: signUrl,
        dropbox_envelope_id: signResult?.envelope_id,
        status: 'sent',
      }).eq('id', contract.id);
    } catch (e) {
      console.warn('[Listings] DropboxSign error:', e.message);
    }

    res.json({ success: true, contract: { ...contract, sign_url: signUrl } });
  } catch (err) {
    console.error('[Listings] assignment error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to create assignment contract' });
  }
});

// GET /api/listings/:id/assignments - list contracts for a listing
router.get('/:id/assignments', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('assignment_contracts')
      .select('*')
      .eq('listing_id', req.params.id)
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ success: true, contracts: data || [] });
  } catch (err) {
    console.error('[Listings] assignments error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load contracts' });
  }
});

module.exports = router;
