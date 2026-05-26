/**
 * Listing Publish Pipeline — One trigger, full automation
 *
 * POST /api/pipeline/publish/:listingId
 *
 * What it does in order:
 *  1. Loads listing + photos
 *  2. Generates ElevenLabs voiceover from description
 *  3. Sends photos + voiceover to Shotstack → renders MP4
 *  4. Generates AI captions for each connected platform (Claude)
 *  5. Queues posts for each platform (post_queue table)
 *  6. Sends email blast to all buyers
 *  7. Updates listing status → active
 *  8. Returns full pipeline summary
 *
 * GET /api/pipeline/status/:listingId — check pipeline progress
 */
const router  = require('express').Router();
const { auth } = require('../middleware/auth');
const supabase = require('../config/supabase');

router.use(auth);

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function generateVoiceover(text) {
  if (!process.env.ELEVENLABS_API_KEY) return null;
  try {
    const voiceId = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB'; // default: Antoni
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key':   process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        'Accept':       'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_monolingual_v1',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    // Return as base64 data URI — Shotstack can use hosted audio URLs
    // In production, upload to Supabase Storage and return public URL
    // For now return null so video renders without voiceover but still works
    return null; // TODO: upload buffer to storage and return URL
  } catch (e) {
    console.warn('[Pipeline] ElevenLabs error:', e.message);
    return null;
  }
}

async function generateShotstackVideo(listing, voiceoverUrl) {
  if (!process.env.SHOTSTACK_API_KEY) return null;
  try {
    const photos = (listing.photos || []).slice(0, 8);
    if (photos.length === 0) return null;

    const clipLength = 4;
    const imageClips = photos.map((photo, i) => ({
      asset:  { type: 'image', src: photo },
      start:  i * clipLength,
      length: clipLength,
      effect: i % 2 === 0 ? 'zoomIn' : 'zoomOut',
      transition: { in: 'fade', out: 'fade' },
    }));

    const totalLength = photos.length * clipLength;

    // Title card
    const titleClip = {
      asset: {
        type: 'html',
        html: `<p style="font-family:sans-serif;font-size:36px;font-weight:700;color:#fff;text-align:center;text-shadow:0 2px 8px rgba(0,0,0,0.8);">${listing.address || ''}</p>`,
        width: 1280,
        height: 200,
      },
      start: 0,
      length: totalLength,
      position: 'bottom',
      offset: { y: 0.15 },
    };

    // Price overlay
    const priceClip = {
      asset: {
        type: 'html',
        html: `<div style="font-family:sans-serif;background:rgba(0,195,122,0.9);padding:10px 24px;border-radius:8px;display:inline-block;"><span style="font-size:22px;font-weight:700;color:#000;">$${Number(listing.asking_price || 0).toLocaleString()}</span><span style="font-size:14px;color:#000;margin-left:8px;">Asking</span></div>`,
        width: 400,
        height: 80,
      },
      start: 0,
      length: totalLength,
      position: 'topRight',
      offset: { x: -0.05, y: -0.05 },
    };

    const tracks = [
      { clips: imageClips },
      { clips: [titleClip, priceClip] },
    ];

    // Add voiceover track if available
    if (voiceoverUrl) {
      tracks.push({
        clips: [{
          asset: { type: 'audio', src: voiceoverUrl, volume: 1 },
          start: 0,
          length: totalLength,
        }],
      });
    }

    const payload = {
      timeline: {
        soundtrack: voiceoverUrl ? undefined : {
          src:    'https://feeds.soundcloud.com/stream/522920349-unminus-beach.mp3',
          effect: 'fadeOut',
          volume: 0.3,
        },
        tracks,
      },
      output: {
        format:     'mp4',
        resolution: 'hd',  // 1280x720 — YouTube standard
        aspectRatio: '16:9',
        fps:        25,
      },
      merge: [],
    };

    const res = await fetch('https://api.shotstack.io/v1/render', {
      method:  'POST',
      headers: {
        'x-api-key':    process.env.SHOTSTACK_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    const renderId = data?.response?.id;
    if (!renderId) throw new Error('No render ID from Shotstack');

    return {
      render_id: renderId,
      status:    'rendering',
      eta:       '2-4 minutes',
      poll_url:  `https://api.shotstack.io/v1/render/${renderId}`,
    };
  } catch (e) {
    console.warn('[Pipeline] Shotstack error:', e.message);
    return null;
  }
}

async function generateCaptions(listing, userId) {
  if (!process.env.ANTHROPIC_API_KEY) return {};
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const details = `
Property: ${listing.address}, ${listing.city}, ${listing.state}
Type: ${listing.property_type?.replace(/_/g, ' ')}
Beds/Baths: ${listing.bedrooms}bd/${listing.bathrooms}ba
Sqft: ${listing.sqft?.toLocaleString() || 'N/A'}
Asking Price: $${Number(listing.asking_price || 0).toLocaleString()}
ARV: $${Number(listing.arv || 0).toLocaleString()}
Repair Cost: $${Number(listing.repair_cost || 0).toLocaleString()}
Highlights: ${(listing.highlights || []).join(', ')}
`.trim();

    const platformSpecs = {
      instagram: 'Instagram (max 2200 chars, include 15 hashtags, use emojis, start with a hook)',
      facebook:  'Facebook (max 500 chars, conversational, include call to action)',
      twitter:   'Twitter/X (max 280 chars, punchy, 2-3 hashtags)',
      youtube:   'YouTube video description (hook in first 2 lines, then bullet points, then hashtags)',
      tiktok:    'TikTok (max 150 chars, energetic, trending hashtags)',
    };

    const captions = {};
    const platforms = Object.keys(platformSpecs);

    // Generate all captions in parallel
    await Promise.all(platforms.map(async (platform) => {
      try {
        const msg = await anthropic.messages.create({
          model:      'claude-3-haiku-20240307',
          max_tokens: 600,
          messages: [{
            role: 'user',
            content: `Write a real estate wholesale post for ${platformSpecs[platform]}.

${details}

Write only the post text. No explanation. Make it compelling for cash buyers and real estate investors.`,
          }],
        });
        captions[platform] = msg.content[0]?.text?.trim() || '';
      } catch (e) {
        captions[platform] = '';
      }
    }));

    return captions;
  } catch (e) {
    console.warn('[Pipeline] Caption generation error:', e.message);
    return {};
  }
}

async function queueSocialPosts(userId, listingId, captions) {
  const platforms = Object.keys(captions).filter(p => captions[p]);
  if (platforms.length === 0) return [];

  // Check which platforms are connected
  const { data: connections } = await supabase
    .from('social_connections')
    .select('platform')
    .eq('user_id', userId)
    .eq('connected', true)
    .in('platform', platforms);

  const connectedPlatforms = (connections || []).map(c => c.platform);
  if (connectedPlatforms.length === 0) return [];

  const rows = connectedPlatforms.map(platform => ({
    user_id:    userId,
    platform,
    caption:    captions[platform],
    status:     'pending',
    post_type:  'listing_published',
    listing_id: listingId,
    retry_count: 0,
  }));

  const { data, error } = await supabase.from('post_queue').insert(rows).select('id, platform, status');
  if (error) throw error;
  return data || [];
}

async function sendBuyerEmailBlast(userId, listing) {
  try {
    const { data: buyers } = await supabase
      .from('buyers')
      .select('id, email, name, first_name')
      .eq('user_id', userId)
      .not('email', 'is', null)
      .eq('status', 'active');

    if (!buyers || buyers.length === 0) return { sent: 0, skipped: 'no active buyers with email' };

    const subject = `🏠 New Deal: ${listing.address} — $${Number(listing.asking_price || 0).toLocaleString()} Asking`;
    const html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#fff;">
        <div style="background:#060E1A;padding:24px;text-align:center;">
          <h1 style="color:#00C37A;margin:0;font-size:22px;">New Deal Alert</h1>
        </div>
        <div style="padding:28px 24px;">
          <h2 style="font-size:20px;margin:0 0 8px;">${listing.address}</h2>
          <p style="color:#666;margin:0 0 20px;">${listing.city || ''}, ${listing.state || ''} ${listing.zip || ''}</p>

          <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
            <tr style="background:#f8f9fa;">
              <td style="padding:12px 16px;font-weight:600;">Asking Price</td>
              <td style="padding:12px 16px;color:#00C37A;font-weight:700;font-size:18px;">$${Number(listing.asking_price || 0).toLocaleString()}</td>
            </tr>
            <tr>
              <td style="padding:12px 16px;font-weight:600;">ARV</td>
              <td style="padding:12px 16px;">$${Number(listing.arv || 0).toLocaleString()}</td>
            </tr>
            <tr style="background:#f8f9fa;">
              <td style="padding:12px 16px;font-weight:600;">Repair Cost</td>
              <td style="padding:12px 16px;">$${Number(listing.repair_cost || 0).toLocaleString()}</td>
            </tr>
            ${listing.bedrooms ? `<tr><td style="padding:12px 16px;font-weight:600;">Beds / Baths</td><td style="padding:12px 16px;">${listing.bedrooms} bed / ${listing.bathrooms} bath</td></tr>` : ''}
            ${listing.sqft ? `<tr style="background:#f8f9fa;"><td style="padding:12px 16px;font-weight:600;">Square Feet</td><td style="padding:12px 16px;">${Number(listing.sqft).toLocaleString()} sqft</td></tr>` : ''}
          </table>

          ${listing.description ? `<p style="color:#444;line-height:1.6;margin-bottom:24px;">${listing.description}</p>` : ''}

          ${(listing.highlights || []).length > 0 ? `
          <div style="background:#f0fdf4;border-left:4px solid #00C37A;padding:16px;margin-bottom:24px;">
            <strong style="display:block;margin-bottom:8px;">Highlights:</strong>
            <ul style="margin:0;padding-left:20px;">${listing.highlights.map(h => `<li style="margin-bottom:4px;">${h}</li>`).join('')}</ul>
          </div>` : ''}

          <div style="text-align:center;margin-top:28px;">
            <a href="https://veori.net" style="background:#00C37A;color:#000;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block;">
              View Deal Details
            </a>
          </div>
        </div>
        <div style="background:#f8f9fa;padding:16px 24px;text-align:center;color:#999;font-size:12px;">
          You're receiving this because you're on our active buyers list.
        </div>
      </div>
    `;

    const emailService = require('../services/emailService');
    let sent = 0;
    for (const buyer of buyers) {
      if (!buyer.email) continue;
      try {
        await emailService.sendEmail({
          to:      buyer.email,
          subject,
          html:    html.replace(/\{\{name\}\}/g, buyer.first_name || buyer.name || 'Investor'),
        });
        sent++;
      } catch (e) {
        console.warn(`[Pipeline] email to ${buyer.email} failed:`, e.message);
      }
    }

    // Log the blast
    await supabase.from('email_blasts').insert({
      user_id:        userId,
      listing_id:     listing.id,
      subject,
      body_html:      html,
      recipient_type: 'all_buyers',
      sent_count:     sent,
      status:         'sent',
      sent_at:        new Date().toISOString(),
    });

    return { sent, total: buyers.length };
  } catch (e) {
    console.warn('[Pipeline] email blast error:', e.message);
    return { sent: 0, error: e.message };
  }
}

// ─── POST /api/pipeline/publish/:listingId ────────────────────────────────────
router.post('/publish/:listingId', async (req, res) => {
  const { listingId } = req.params;
  const userId = req.user.id;

  // Load listing
  const { data: listing, error: listErr } = await supabase
    .from('listings')
    .select('*')
    .eq('id', listingId)
    .eq('user_id', userId)
    .single();

  if (listErr || !listing) {
    return res.status(404).json({ success: false, error: 'Listing not found' });
  }

  const results = {
    listing_id: listingId,
    steps: {},
  };

  // ── Step 1: Generate voiceover (optional — skipped if no ElevenLabs key) ──
  const voiceoverScript = listing.description
    ? `${listing.address}. ${listing.description}. Asking ${Number(listing.asking_price || 0).toLocaleString()} dollars. ARV ${Number(listing.arv || 0).toLocaleString()} dollars. Contact us today.`
    : null;

  let voiceoverUrl = null;
  if (voiceoverScript && process.env.ELEVENLABS_API_KEY) {
    voiceoverUrl = await generateVoiceover(voiceoverScript);
    results.steps.voiceover = voiceoverUrl ? 'generated' : 'skipped (upload to storage needed)';
  } else {
    results.steps.voiceover = process.env.ELEVENLABS_API_KEY ? 'skipped (no description)' : 'skipped (no ElevenLabs key)';
  }

  // ── Step 2: Generate Shotstack video ─────────────────────────────────────
  const videoResult = await generateShotstackVideo(listing, voiceoverUrl);
  results.steps.video = videoResult
    ? { status: 'rendering', render_id: videoResult.render_id, eta: videoResult.eta }
    : { status: 'skipped', reason: listing.photos?.length ? 'no Shotstack key' : 'no photos on listing' };

  // Save render ID to listing
  if (videoResult?.render_id) {
    await supabase.from('listings').update({ shotstack_render_id: videoResult.render_id }).eq('id', listingId);
  }

  // ── Step 3: Generate AI captions ─────────────────────────────────────────
  const captions = await generateCaptions(listing, userId);
  results.steps.captions = Object.keys(captions).filter(p => captions[p]).length > 0
    ? { generated: Object.keys(captions).filter(p => captions[p]) }
    : { status: 'skipped', reason: 'no Anthropic key' };

  // ── Step 4: Queue social posts ────────────────────────────────────────────
  try {
    const queued = await queueSocialPosts(userId, listingId, captions);
    results.steps.social_queue = queued.length > 0
      ? { queued: queued.map(q => q.platform), count: queued.length }
      : { status: 'skipped', reason: 'no connected social accounts' };
  } catch (e) {
    results.steps.social_queue = { status: 'error', error: e.message };
  }

  // ── Step 5: Email blast to buyers ─────────────────────────────────────────
  const emailResult = await sendBuyerEmailBlast(userId, listing);
  results.steps.email_blast = emailResult;

  // ── Step 6: Activate listing ──────────────────────────────────────────────
  await supabase.from('listings').update({
    status:       'active',
    published_at: new Date().toISOString(),
  }).eq('id', listingId).eq('user_id', userId);

  results.steps.listing_status = 'active';
  results.success = true;

  res.json(results);
});

// ─── GET /api/pipeline/status/:listingId ─────────────────────────────────────
router.get('/status/:listingId', async (req, res) => {
  try {
    const { data: listing } = await supabase
      .from('listings')
      .select('id, status, shotstack_render_id, published_at')
      .eq('id', req.params.listingId)
      .eq('user_id', req.user.id)
      .single();

    if (!listing) return res.status(404).json({ error: 'Not found' });

    let videoStatus = null;
    if (listing.shotstack_render_id && process.env.SHOTSTACK_API_KEY) {
      try {
        const r = await fetch(`https://api.shotstack.io/v1/render/${listing.shotstack_render_id}`, {
          headers: { 'x-api-key': process.env.SHOTSTACK_API_KEY },
        });
        const d = await r.json();
        videoStatus = {
          status: d.response?.status,
          url:    d.response?.url || null,
        };
        // Save completed video URL
        if (d.response?.url) {
          await supabase.from('listings').update({ video_url: d.response.url }).eq('id', listing.id);
        }
      } catch (e) {
        videoStatus = { status: 'unknown' };
      }
    }

    const { data: queue } = await supabase
      .from('post_queue')
      .select('platform, status')
      .eq('listing_id', req.params.listingId)
      .eq('user_id', req.user.id);

    res.json({
      success: true,
      listing_status:  listing.status,
      published_at:    listing.published_at,
      video:           videoStatus,
      social_posts:    queue || [],
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get status' });
  }
});

module.exports = router;
