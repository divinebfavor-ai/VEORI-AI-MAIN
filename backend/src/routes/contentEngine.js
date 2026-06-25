/**
 * Features 29-33 — AI Video Generator, Caption Generator, Email Blast Builder, Content Calendar
 * Routes: POST /api/content/generate-caption, POST /api/content/generate-video,
 *         GET /api/content, POST /api/content/email-blast, GET /api/content/calendar,
 *         POST /api/content/schedule
 */
const router  = require('express').Router();
const { requireAuth: auth } = require('../middleware/auth');
const supabase = require('../config/supabase');

router.use(auth);

// ─── FEATURE 30: AI CAPTION GENERATOR ────────────────────────────────────────

// POST /api/content/generate-caption
router.post('/generate-caption', async (req, res) => {
  try {
    const { listing_id, platform, tone = 'professional', keywords = [] } = req.body;

    let listing = null;
    if (listing_id) {
      const { data } = await supabase.from('listings').select('*').eq('id', listing_id).single();
      listing = data;
    }

    // Use Anthropic SDK if available
    let caption = null;
    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      const propertyDetails = listing
        ? `Address: ${listing.address}, ${listing.city}, ${listing.state}
           Price: $${listing.asking_price?.toLocaleString() || 'Contact for price'}
           ARV: $${listing.arv?.toLocaleString() || 'N/A'}
           Beds/Baths: ${listing.bedrooms}/${listing.bathrooms}
           Highlights: ${(listing.highlights || []).join(', ')}`
        : 'Investment property opportunity';

      const platformInstructions = {
        instagram: 'Instagram post with hashtags. Max 2200 chars. Include 10-15 relevant hashtags.',
        facebook:  'Facebook post. Max 500 chars. Conversational and engaging.',
        twitter:   'Tweet. Max 280 chars. Punchy and direct.',
        youtube:   'YouTube video description. 150-200 chars for the hook, then bullet points.',
        tiktok:    'TikTok caption. Short, energetic, with trending hashtags.',
      };

      const instruction = platformInstructions[platform] || 'Social media post. Professional and engaging.';

      const message = await anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `Write a ${tone} real estate wholesale ${instruction}

Property: ${propertyDetails}
Extra keywords: ${keywords.join(', ')}

Write the caption only, no explanation.`,
        }],
      });

      caption = message.content[0]?.text?.trim();
    } catch (aiErr) {
      console.warn('[Content] AI caption fallback:', aiErr.message);
      // Fallback template
      const templates = {
        instagram: `🏠 OFF-MARKET DEAL ALERT!\n\n${listing?.address || 'Prime Investment Property'} — ${listing?.city || ''}\n\n💰 Asking: $${listing?.asking_price?.toLocaleString() || 'Contact us'}\n📈 ARV: $${listing?.arv?.toLocaleString() || 'N/A'}\n🛏 ${listing?.bedrooms || '?'} bed / 🛁 ${listing?.bathrooms || '?'} bath\n\nDM us NOW before this deal is gone! 🔥\n\n#realestate #wholesaling #investmentproperty #offmarket #realestateinvesting #cashbuyers #fixandflip #motivated #dealoftheday`,
        facebook:  `🏠 NEW OFF-MARKET DEAL!\n\n${listing?.address || 'Investment Property'}\nAsking: $${listing?.asking_price?.toLocaleString() || 'Contact'} | ARV: $${listing?.arv?.toLocaleString() || 'N/A'}\n\nComment or DM for details. First come first served! 🔥`,
        twitter:   `🏠 OFF-MARKET: ${listing?.address || 'Investment Deal'} | Ask: $${listing?.asking_price?.toLocaleString() || '?'} | ARV: $${listing?.arv?.toLocaleString() || '?'} | DM for details 🔥 #realestate #wholesale`,
        default:   `Investment property available. ${listing?.address || 'Contact for address'}. Asking $${listing?.asking_price?.toLocaleString() || 'TBD'}. Contact for details.`,
      };
      caption = templates[platform] || templates.default;
    }

    // Save generated caption
    const { data: content, error } = await supabase
      .from('generated_content')
      .insert({
        user_id:     req.user.id,
        listing_id:  listing_id || null,
        content_type: 'caption',
        platform:    platform || 'instagram',
        caption,
        content:     caption,
        status:      'draft',
      })
      .select().single();

    if (error) throw error;
    res.json({ success: true, caption, content });
  } catch (err) {
    console.error('[Content] caption error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to generate caption' });
  }
});

// ─── FEATURE 29: AI VIDEO GENERATOR ──────────────────────────────────────────

// POST /api/content/generate-video
router.post('/generate-video', async (req, res) => {
  try {
    const { listing_id, style = 'slideshow', caption } = req.body;

    const { data: listing } = await supabase
      .from('listings')
      .select('*')
      .eq('id', listing_id)
      .single();

    // If Shotstack API key available, use it
    let videoResult = null;
    if (process.env.SHOTSTACK_API_KEY && listing) {
      try {
        const axios = require('axios');
        const photos = listing.photos || [];

        // Build Shotstack timeline
        const clips = photos.slice(0, 6).map((photo, i) => ({
          asset: { type: 'image', src: photo },
          start: i * 3,
          length: 3,
          transition: { in: 'fadeIn', out: 'fadeOut' },
        }));

        if (clips.length === 0) throw new Error('No photos on listing');

        // Add caption clip
        clips.push({
          asset: {
            type: 'title',
            text: `${listing.address}\n$${listing.asking_price?.toLocaleString()} | ARV: $${listing.arv?.toLocaleString()}`,
            style: 'minimal',
          },
          start: 0,
          length: clips.length * 3,
        });

        const { data: renderResp } = await axios.post('https://api.shotstack.io/v1/render', {
          timeline: { tracks: [{ clips }] },
          output: { format: 'mp4', resolution: 'sd' },
        }, {
          headers: {
            'x-api-key': process.env.SHOTSTACK_API_KEY,
            'Content-Type': 'application/json',
          },
        });

        videoResult = {
          render_id: renderResp?.response?.id,
          status:    'rendering',
          message:   'Video rendering — check back in 2-3 minutes',
        };
      } catch (e) {
        console.warn('[Content] Shotstack error:', e.message);
      }
    }

    const { data: content, error } = await supabase
      .from('generated_content')
      .insert({
        user_id:      req.user.id,
        listing_id:   listing_id || null,
        content_type: 'video',
        platform:     'instagram',
        caption:      caption || '',
        status:       videoResult ? 'processing' : 'draft',
        media_url:    videoResult?.render_id ? `https://api.shotstack.io/v1/render/${videoResult.render_id}` : null,
      })
      .select().single();

    if (error) throw error;

    res.json({
      success: true,
      content,
      video: videoResult || { status: 'draft', message: 'Add photos to listing to generate a video' },
    });
  } catch (err) {
    console.error('[Content] video error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to generate video' });
  }
});

// ─── GET /api/content — list all generated content ───────────────────────────
router.get('/', async (req, res) => {
  try {
    const { type, platform } = req.query;
    let query = supabase
      .from('generated_content')
      .select('*, listings(title, address)')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (type)     query = query.eq('content_type', type);
    if (platform) query = query.eq('platform', platform);

    const { data, error } = await query;
    if (error) throw error;
    res.json({ success: true, content: data || [] });
  } catch (err) {
    console.error('[Content] list error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load content' });
  }
});

// ─── FEATURE 32: EMAIL BLAST BUILDER ─────────────────────────────────────────

// POST /api/content/email-blast — create and send email blast
router.post('/email-blast', async (req, res) => {
  try {
    const { listing_id, subject, body_html, recipient_type = 'all_buyers', recipient_ids = [] } = req.body;

    if (!subject || !body_html) {
      return res.status(400).json({ success: false, error: 'subject and body_html required' });
    }

    // Get recipients
    let recipients = [];
    if (recipient_type === 'all_buyers') {
      const { data: buyers } = await supabase
        .from('buyers')
        .select('id, email, name')
        .eq('user_id', req.user.id)
        .not('email', 'is', null);
      recipients = buyers || [];
    } else if (recipient_type === 'specific' && recipient_ids.length > 0) {
      const { data: buyers } = await supabase
        .from('buyers')
        .select('id, email, name')
        .in('id', recipient_ids);
      recipients = buyers || [];
    }

    // Create blast record
    const { data: blast, error } = await supabase
      .from('email_blasts')
      .insert({
        user_id:        req.user.id,
        listing_id:     listing_id || null,
        subject,
        body_html,
        recipient_type,
        recipient_ids:  recipient_ids || [],
        sent_count:     0,
        status:         'sending',
      })
      .select().single();

    if (error) throw error;

    // Send via email service
    let sentCount = 0;
    let suppressedCount = 0;
    try {
      const emailService = require('../services/emailService');
      const { buildUnsubscribeUrl } = require('../services/emailSuppression');
      for (const r of recipients) {
        if (!r.email) continue;
        // Per-recipient one-click unsubscribe (CAN-SPAM). Null if no public base
        // is configured — sendEmail then omits the footer/header, but suppression
        // + logging below still apply because we pass userId.
        const unsubscribeUrl = await buildUnsubscribeUrl({
          userId: req.user.id,
          email:  r.email,
        });
        // CRITICAL FIX: pass userId so the suppression gate + email_log both fire.
        // Previously the blast omitted userId, which silently bypassed every
        // unsubscribe AND wrote no log row (a CAN-SPAM exposure on bulk sends).
        const result = await emailService.sendEmail({
          userId:  req.user.id,
          to:      r.email,
          subject,
          html:    body_html.replace(/\{\{name\}\}/g, r.name || 'Investor'),
          emailType: 'email_blast',
          unsubscribeUrl,
        });
        if (result && result.suppressed) { suppressedCount++; continue; }
        sentCount++;
      }

      await supabase.from('email_blasts').update({
        sent_count: sentCount,
        status:     'sent',
        sent_at:    new Date().toISOString(),
      }).eq('id', blast.id);
    } catch (emailErr) {
      console.warn('[Content] email blast error:', emailErr.message);
      await supabase.from('email_blasts').update({ status: 'failed' }).eq('id', blast.id);
    }

    res.json({ success: true, blast: { ...blast, sent_count: sentCount }, suppressed_count: suppressedCount, recipients_found: recipients.length });
  } catch (err) {
    console.error('[Content] email-blast error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to send email blast' });
  }
});

// GET /api/content/email-blasts — list blasts
router.get('/email-blasts', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('email_blasts')
      .select('*, listings(title)')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    res.json({ success: true, blasts: data || [] });
  } catch (err) {
    console.error('[Content] blasts list error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load blasts' });
  }
});

// ─── FEATURE 33: CONTENT CALENDAR ────────────────────────────────────────────

// GET /api/content/calendar — calendar view
router.get('/calendar', async (req, res) => {
  try {
    const { month, year } = req.query;
    const startDate = month && year
      ? new Date(parseInt(year), parseInt(month) - 1, 1).toISOString().split('T')[0]
      : new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const endDate = month && year
      ? new Date(parseInt(year), parseInt(month), 0).toISOString().split('T')[0]
      : new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('content_calendar')
      .select('*, generated_content(content_type, platform, caption, status, media_url)')
      .eq('user_id', req.user.id)
      .gte('scheduled_date', startDate)
      .lte('scheduled_date', endDate)
      .order('scheduled_date', { ascending: true });

    if (error) throw error;
    res.json({ success: true, calendar: data || [], start_date: startDate, end_date: endDate });
  } catch (err) {
    console.error('[Content] calendar error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load calendar' });
  }
});

// POST /api/content/schedule — add to calendar
router.post('/schedule', async (req, res) => {
  try {
    const { content_id, scheduled_date, platform, notes } = req.body;
    if (!content_id || !scheduled_date) {
      return res.status(400).json({ success: false, error: 'content_id and scheduled_date required' });
    }

    const { data, error } = await supabase
      .from('content_calendar')
      .insert({
        user_id: req.user.id,
        content_id,
        scheduled_date,
        platform: platform || null,
        notes:    notes || '',
        status:   'scheduled',
      })
      .select().single();

    if (error) throw error;

    // Update content status
    await supabase.from('generated_content').update({
      status:         'scheduled',
      scheduled_for:  scheduled_date,
    }).eq('id', content_id).eq('user_id', req.user.id);

    res.json({ success: true, calendar_entry: data });
  } catch (err) {
    console.error('[Content] schedule error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to schedule content' });
  }
});

module.exports = router;
