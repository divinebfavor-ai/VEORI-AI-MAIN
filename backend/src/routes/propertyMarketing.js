/**
 * Property Marketing Engine — Cinematic AI Video Generator
 * Routes:
 *   POST /api/property-marketing/generate       — generate cinematic video
 *   GET  /api/property-marketing/status/:id     — poll render status
 *   GET  /api/property-marketing/videos         — list all generated videos
 *   POST /api/property-marketing/generate-captions — generate platform captions
 */

const router  = require('express').Router();
const { requireAuth: auth } = require('../middleware/auth');
const supabase = require('../config/supabase');

router.use(auth);

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SHOTSTACK_SANDBOX = 'https://api.shotstack.io/stage';
const SHOTSTACK_PROD    = 'https://api.shotstack.io/v1';

function getShotstackBase() {
  const env = process.env.SHOTSTACK_ENV || 'sandbox';
  return env === 'production' ? SHOTSTACK_PROD : SHOTSTACK_SANDBOX;
}

function getShotstackKey() {
  const env = process.env.SHOTSTACK_ENV || 'sandbox';
  return env === 'production'
    ? process.env.SHOTSTACK_API_KEY
    : process.env.SHOTSTACK_SANDBOX_KEY;
}

// Ken Burns effects cycle
const EFFECTS = ['zoomIn', 'zoomOut', 'slideLeft', 'slideRight', 'slideUp'];
const TRANSITIONS_IN  = ['fade', 'wipeLeft', 'wipeRight', 'reveal'];
const TRANSITIONS_OUT = ['fade', 'wipeLeft', 'wipeRight'];

// Background music tracks (royalty-free via Shotstack assets)
const MUSIC_TRACKS = {
  luxury:     'https://shotstack-assets.s3-ap-southeast-2.amazonaws.com/music/unminus/ambisaurus.mp3',
  investment: 'https://shotstack-assets.s3-ap-southeast-2.amazonaws.com/music/unminus/lit.mp3',
  family:     'https://shotstack-assets.s3-ap-southeast-2.amazonaws.com/music/unminus/pegasus.mp3',
  distressed: 'https://shotstack-assets.s3-ap-southeast-2.amazonaws.com/music/unminus/force.mp3',
};

// Voiceover voices
const VOICES = {
  luxury:     'Matthew',
  investment: 'Joey',
  family:     'Joanna',
  distressed: 'Matthew',
};

async function generateScript(listing, style) {
  try {
    const { callAnthropic } = require('../services/aiService');

    const styleGuides = {
      luxury: `Write like a luxury real estate narrator. Elegant, aspirational, sophisticated. Focus on lifestyle and exclusivity.`,
      investment: `Write like a sharp real estate investor coach. Direct, numbers-focused, ROI-driven. Make the math sound exciting.`,
      family: `Write like a warm real estate agent. Friendly, emotional, community-focused. Help them imagine their family there.`,
      distressed: `Write like a motivated seller specialist. Urgent but professional. Focus on opportunity, speed, and profit potential.`,
    };

    const guide = styleGuides[style] || styleGuides.investment;

    const prompt = `You are writing a 30-second voiceover script for a property marketing video.

Property Details:
- Address: ${listing.address || ''}, ${listing.city || ''}, ${listing.state || ''}
- Asking Price: $${listing.asking_price?.toLocaleString() || 'Contact for price'}
- ARV (After Repair Value): $${listing.arv?.toLocaleString() || 'N/A'}
- Bedrooms: ${listing.bedrooms || '?'} | Bathrooms: ${listing.bathrooms || '?'}
- Square Feet: ${listing.sqft || 'N/A'}
- Description: ${listing.description || listing.notes || ''}
- Highlights: ${(listing.highlights || []).join(', ')}

Style: ${guide}

Write a compelling 30-second voiceover (about 75 words max).
- Start with a powerful hook
- Paint a picture of the opportunity
- End with a clear call to action
- Do NOT say "click the link" or mention social media
- Write naturally, like a real person speaking
- Return ONLY the script text, nothing else`;

    const resp = await callAnthropic({
      model: 'claude-haiku-4-5',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    return resp.content?.[0]?.text?.trim() || null;
  } catch (e) {
    console.warn('[PropMarketing] Script generation failed:', e.message);
    return null;
  }
}

function buildShotstackTimeline(listing, photos, script, style, aspectRatio = '16:9') {
  const clipDuration = 4; // seconds per photo
  const photoClips   = photos.slice(0, 8); // max 8 photos
  const totalDuration = photoClips.length * clipDuration;

  const width  = aspectRatio === '9:16' ? 720  : 1280;
  const height = aspectRatio === '9:16' ? 1280 : 720;

  // ── Track 1: Photos with Ken Burns ───────────────────────────────────────────
  const photoTrack = {
    clips: photoClips.map((src, i) => ({
      asset:  { type: 'image', src },
      start:  i * clipDuration,
      length: clipDuration + 0.5, // slight overlap for smooth transition
      effect: EFFECTS[i % EFFECTS.length],
      transition: {
        in:  TRANSITIONS_IN[i % TRANSITIONS_IN.length],
        out: TRANSITIONS_OUT[i % TRANSITIONS_OUT.length],
      },
    })),
  };

  // ── Track 2: Brand watermark (bottom-left) ───────────────────────────────────
  const brandTrack = {
    clips: [{
      asset: {
        type:   'html',
        html:   '<p>VEORI</p>',
        css:    'p { color: rgba(0,195,122,0.9); font-family: Arial, sans-serif; font-size: 28px; font-weight: 900; letter-spacing: 4px; text-shadow: 0 2px 8px rgba(0,0,0,0.5); }',
        width:  200,
        height: 60,
      },
      start:    0,
      length:   totalDuration,
      position: 'bottomLeft',
      offset:   { x: 0.05, y: -0.04 },
    }],
  };

  // ── Track 3: Property title (first 3 seconds) ────────────────────────────────
  const address = `${listing.address || 'Investment Property'}`;
  const location = `${listing.city || ''}${listing.state ? ', ' + listing.state : ''}`;
  const price = listing.asking_price
    ? `$${listing.asking_price.toLocaleString()}`
    : 'Contact for Price';
  const arv = listing.arv ? ` | ARV $${listing.arv.toLocaleString()}` : '';

  const titleTrack = {
    clips: [
      // Address fade in
      {
        asset: {
          type:   'html',
          html:   `<div><p class="addr">${address}</p><p class="loc">${location}</p></div>`,
          css:    `.addr { color: #ffffff; font-family: Arial, sans-serif; font-size: 42px; font-weight: 700; margin: 0; text-shadow: 0 2px 12px rgba(0,0,0,0.8); } .loc { color: rgba(255,255,255,0.85); font-family: Arial, sans-serif; font-size: 28px; font-weight: 400; margin: 4px 0 0 0; text-shadow: 0 2px 8px rgba(0,0,0,0.6); }`,
          width,
          height: 160,
        },
        start:    0.5,
        length:   3.5,
        position: 'bottom',
        offset:   { x: 0, y: 0.1 },
        transition: { in: 'fade', out: 'fade' },
      },
      // Price overlay (appears at 4s)
      {
        asset: {
          type:   'html',
          html:   `<p>${price}${arv}</p>`,
          css:    `p { color: #00C37A; font-family: Arial, sans-serif; font-size: 38px; font-weight: 700; margin: 0; text-shadow: 0 2px 8px rgba(0,0,0,0.6); background: rgba(6,14,26,0.55); padding: 8px 20px; border-radius: 6px; }`,
          width,
          height: 80,
        },
        start:    4.5,
        length:   3.5,
        position: 'bottom',
        offset:   { x: 0, y: 0.12 },
        transition: { in: 'fade', out: 'fade' },
      },
      // Bed/Bath/Sqft (appears at 8s)
      ...(listing.bedrooms || listing.bathrooms || listing.sqft ? [{
        asset: {
          type:   'html',
          html:   `<p>${[listing.bedrooms ? listing.bedrooms + ' Beds' : null, listing.bathrooms ? listing.bathrooms + ' Baths' : null, listing.sqft ? listing.sqft.toLocaleString() + ' sqft' : null].filter(Boolean).join('  ·  ')}</p>`,
          css:    `p { color: #ffffff; font-family: Arial, sans-serif; font-size: 30px; font-weight: 500; margin: 0; text-shadow: 0 2px 8px rgba(0,0,0,0.7); letter-spacing: 1px; }`,
          width,
          height: 60,
        },
        start:    8.5,
        length:   3.5,
        position: 'bottom',
        offset:   { x: 0, y: 0.12 },
        transition: { in: 'fade', out: 'fade' },
      }] : []),
      // Call to action (last 4 seconds)
      {
        asset: {
          type:   'html',
          html:   '<p>DM for Details · veori.net</p>',
          css:    `p { color: #ffffff; font-family: Arial, sans-serif; font-size: 28px; font-weight: 600; margin: 0; text-shadow: 0 2px 8px rgba(0,0,0,0.7); background: rgba(0,195,122,0.85); padding: 10px 28px; border-radius: 40px; }`,
          width,
          height: 70,
        },
        start:    totalDuration - 4,
        length:   3.5,
        position: 'bottom',
        offset:   { x: 0, y: 0.12 },
        transition: { in: 'fade', out: 'fade' },
      },
    ],
  };

  // ── Track 4: AI Voiceover ────────────────────────────────────────────────────
  const voiceTracks = script ? [{
    clips: [{
      asset: {
        type:  'text-to-speech',
        text:  script,
        voice: VOICES[style] || 'Matthew',
      },
      start:  1,
      length: Math.min(totalDuration - 1, 30),
    }],
  }] : [];

  return {
    timeline: {
      background: '#060E1A',
      soundtrack: {
        src:    MUSIC_TRACKS[style] || MUSIC_TRACKS.investment,
        effect: 'fadeOut',
        volume: script ? 0.3 : 0.7, // lower music if voiceover present
      },
      tracks: [
        ...voiceTracks,
        titleTrack,
        brandTrack,
        photoTrack,
      ],
    },
    output: {
      format:      'mp4',
      resolution:  'hd',
      aspectRatio,
      fps:         25,
      destinations: [],
    },
  };
}

// ─── POST /api/property-marketing/generate ───────────────────────────────────
router.post('/generate', async (req, res) => {
  try {
    const {
      listing_id,
      style       = 'investment', // luxury | investment | family | distressed
      aspect_ratio = '16:9',     // 16:9 | 9:16
      with_voiceover = true,
    } = req.body;

    if (!listing_id) {
      return res.status(400).json({ success: false, error: 'listing_id is required' });
    }

    // ── Get listing + photos ─────────────────────────────────────────────────
    const { data: listing, error: listErr } = await supabase
      .from('listings')
      .select('*')
      .eq('id', listing_id)
      .eq('user_id', req.user.id)
      .single();

    if (listErr || !listing) {
      return res.status(404).json({ success: false, error: 'Listing not found' });
    }

    // Gather photos: from listing.photos array or property_photos table
    let photos = listing.photos || [];
    if (photos.length === 0) {
      const { data: photosData } = await supabase
        .from('property_photos')
        .select('url')
        .eq('listing_id', listing_id)
        .order('display_order', { ascending: true })
        .limit(8);
      photos = (photosData || []).map(p => p.url).filter(Boolean);
    }

    if (photos.length === 0) {
      return res.status(422).json({ success: false, error: 'This listing has no photos. Upload photos first to generate a video.' });
    }

    // ── Generate AI script ───────────────────────────────────────────────────
    let script = null;
    if (with_voiceover) {
      script = await generateScript(listing, style);
    }

    // ── Build Shotstack timeline ─────────────────────────────────────────────
    const timeline = buildShotstackTimeline(listing, photos, script, style, aspect_ratio);

    // ── Submit to Shotstack ──────────────────────────────────────────────────
    const key  = getShotstackKey();
    const base = getShotstackBase();

    if (!key) {
      // Return mock response if no key configured
      const { data: saved } = await supabase.from('property_videos').insert({
        user_id:    req.user.id,
        listing_id,
        style,
        aspect_ratio,
        script,
        status:     'draft',
        render_id:  null,
      }).select().single();

      return res.json({
        success: true,
        video:   saved,
        script,
        message: 'Video queued (Shotstack key not configured)',
      });
    }

    const renderResp = await fetch(`${base}/render`, {
      method:  'POST',
      headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      body:    JSON.stringify(timeline),
    });

    const renderData = await renderResp.json();

    if (!renderResp.ok || !renderData.response?.id) {
      console.error('[PropMarketing] Shotstack error:', JSON.stringify(renderData));
      return res.status(502).json({ success: false, error: 'Video rendering failed. Please try again.' });
    }

    const render_id = renderData.response.id;

    // ── Save to DB ───────────────────────────────────────────────────────────
    const { data: saved, error: saveErr } = await supabase
      .from('property_videos')
      .insert({
        user_id:      req.user.id,
        listing_id,
        style,
        aspect_ratio,
        script,
        status:       'rendering',
        render_id,
        shotstack_env: process.env.SHOTSTACK_ENV || 'sandbox',
      })
      .select().single();

    if (saveErr) throw saveErr;

    console.log(`[PropMarketing] Render started: ${render_id} for listing ${listing_id}`);

    res.json({
      success:   true,
      video:     saved,
      render_id,
      script,
      message:   'Your cinematic video is rendering. Check back in 2-3 minutes.',
    });
  } catch (err) {
    console.error('[PropMarketing] generate error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to generate video. Please try again.' });
  }
});

// ─── GET /api/property-marketing/status/:renderId ────────────────────────────
router.get('/status/:renderId', async (req, res) => {
  try {
    const { renderId } = req.params;

    // Get from DB to find env
    const { data: video } = await supabase
      .from('property_videos')
      .select('*')
      .eq('render_id', renderId)
      .eq('user_id', req.user.id)
      .single();

    const env  = video?.shotstack_env || process.env.SHOTSTACK_ENV || 'sandbox';
    const base = env === 'production' ? SHOTSTACK_PROD : SHOTSTACK_SANDBOX;
    const key  = env === 'production'
      ? process.env.SHOTSTACK_API_KEY
      : process.env.SHOTSTACK_SANDBOX_KEY;

    if (!key) {
      return res.json({ success: true, status: 'done', url: null, message: 'No Shotstack key configured' });
    }

    const statusResp = await fetch(`${base}/render/${renderId}`, {
      headers: { 'x-api-key': key },
    });
    const statusData = await statusResp.json();
    const renderStatus = statusData.response;

    const status = renderStatus?.status || 'queued';
    const url    = renderStatus?.url    || null;

    // Update DB if done or failed
    if ((status === 'done' || status === 'failed') && video) {
      await supabase
        .from('property_videos')
        .update({ status, video_url: url, updated_at: new Date().toISOString() })
        .eq('id', video.id);
    }

    res.json({ success: true, status, url, render_id: renderId });
  } catch (err) {
    console.error('[PropMarketing] status error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to check render status' });
  }
});

// ─── GET /api/property-marketing/videos ──────────────────────────────────────
router.get('/videos', async (req, res) => {
  try {
    const { listing_id } = req.query;

    let query = supabase
      .from('property_videos')
      .select('*, listings(address, city, state, asking_price)')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (listing_id) query = query.eq('listing_id', listing_id);

    const { data, error } = await query;
    if (error) throw error;

    res.json({ success: true, videos: data || [] });
  } catch (err) {
    console.error('[PropMarketing] videos error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load videos' });
  }
});

// ─── POST /api/property-marketing/generate-captions ─────────────────────────
router.post('/generate-captions', async (req, res) => {
  try {
    const { listing_id, style = 'investment', platforms = ['facebook', 'instagram', 'twitter'] } = req.body;

    const { data: listing } = await supabase
      .from('listings')
      .select('*')
      .eq('id', listing_id)
      .eq('user_id', req.user.id)
      .single();

    if (!listing) return res.status(404).json({ success: false, error: 'Listing not found' });

    const { callAnthropic } = require('../services/aiService');

    const platformSpecs = {
      facebook:  { chars: 500,  format: 'Facebook post. Conversational, numbers-focused. Include call to action. No hashtags needed.' },
      instagram: { chars: 2200, format: 'Instagram post. Lifestyle + emotion. End with 10-15 targeted hashtags.' },
      twitter:   { chars: 280,  format: 'Tweet. Max 280 chars. Punchy, bold, one hook. 2-3 hashtags max.' },
      youtube:   { chars: 500,  format: 'YouTube video description hook (first 150 chars most important). Then bullet points with property details.' },
    };

    const styleVoices = {
      luxury:     'Aspirational and sophisticated. Lifestyle-focused.',
      investment: 'Sharp and ROI-driven. Make the numbers exciting.',
      family:     'Warm and emotional. Community and home feeling.',
      distressed: 'Urgent opportunity. Speed and profit potential.',
    };

    const propertyInfo = `
Address: ${listing.address}, ${listing.city}, ${listing.state}
Price: $${listing.asking_price?.toLocaleString() || 'Contact'}
ARV: $${listing.arv?.toLocaleString() || 'N/A'}
Beds/Baths: ${listing.bedrooms}/${listing.bathrooms}
Sqft: ${listing.sqft || 'N/A'}
Description: ${listing.description || listing.notes || ''}
    `.trim();

    const captions = {};

    await Promise.all(platforms.map(async (platform) => {
      const spec = platformSpecs[platform];
      if (!spec) return;

      try {
        const resp = await callAnthropic({
          model: 'claude-haiku-4-5',
          max_tokens: 600,
          messages: [{
            role: 'user',
            content: `Write a ${style} real estate wholesale marketing post for ${platform}.

Property:
${propertyInfo}

Voice/Tone: ${styleVoices[style] || styleVoices.investment}
Format: ${spec.format}
Max length: ${spec.chars} characters

Write ONLY the post text. No explanations. No quotes around it.`,
          }],
        });

        captions[platform] = resp.content?.[0]?.text?.trim() || null;
      } catch (e) {
        captions[platform] = null;
      }
    }));

    res.json({ success: true, captions, listing_id });
  } catch (err) {
    console.error('[PropMarketing] captions error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to generate captions' });
  }
});

module.exports = router;
