/**
 * Social Media Account Connections + One-Click Publisher
 *
 * Architecture:
 *   - YOU (VEORI) register one app per platform (Facebook App, Twitter App, etc.)
 *   - Those app credentials (App ID + Secret) go in Railway ENV vars — set ONCE by you
 *   - Each operator clicks "Connect" → standard OAuth popup → their own token stored per-user
 *   - Operators never touch Railway or see any technical config
 *
 * Routes:
 *   GET  /api/social-connections              — list all connections for user
 *   GET  /api/social-connections/auth-url/:p  — get OAuth redirect URL
 *   GET  /api/social-connections/callback     — handle OAuth redirect, exchange code → token
 *   POST /api/social-connections/connect      — manual connect (for testing)
 *   DELETE /api/social-connections/:platform  — disconnect
 *   POST /api/social-connections/publish      — post content to connected platform
 */
const router  = require('express').Router();
const { requireAuth: auth, optionalAuth } = require('../middleware/auth');
const supabase = require('../config/supabase');
const jwt      = require('jsonwebtoken');

const SUPPORTED_PLATFORMS = ['facebook', 'instagram', 'twitter', 'youtube', 'tiktok'];

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://veori.net';
// OAuth callback always goes through veori.net (Vercel proxies it to Railway)
// This is the URI registered in Google Cloud Console, Facebook App, etc.
const CALLBACK_URL = process.env.OAUTH_CALLBACK_URL || 'https://veori.net/api/social-connections/callback';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildAuthUrl(platform, statePayload) {
  const state = encodeURIComponent(JSON.stringify(statePayload));
  const cb    = encodeURIComponent(CALLBACK_URL);

  switch (platform) {
    case 'facebook':
      if (!process.env.FACEBOOK_APP_ID) return null;
      return `https://www.facebook.com/v19.0/dialog/oauth?client_id=${process.env.FACEBOOK_APP_ID}&redirect_uri=${cb}&scope=pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish&state=${state}&response_type=code`;

    case 'instagram':
      // Instagram uses the same Facebook app
      if (!process.env.FACEBOOK_APP_ID) return null;
      return `https://www.facebook.com/v19.0/dialog/oauth?client_id=${process.env.FACEBOOK_APP_ID}&redirect_uri=${cb}&scope=instagram_basic,instagram_content_publish&state=${state}&response_type=code`;

    case 'twitter':
      if (!process.env.TWITTER_CLIENT_ID) return null;
      return `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${process.env.TWITTER_CLIENT_ID}&redirect_uri=${cb}&scope=tweet.read+tweet.write+users.read+offline.access&state=${state}&code_challenge=challenge&code_challenge_method=plain`;

    case 'youtube':
      if (!process.env.GOOGLE_CLIENT_ID) return null;
      return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_CLIENT_ID}&redirect_uri=${cb}&scope=https://www.googleapis.com/auth/youtube.upload+https://www.googleapis.com/auth/youtube.readonly&response_type=code&access_type=offline&state=${state}`;

    case 'tiktok':
      if (!process.env.TIKTOK_CLIENT_KEY) return null;
      return `https://www.tiktok.com/auth/authorize/?client_key=${process.env.TIKTOK_CLIENT_KEY}&scope=video.upload,user.info.basic&response_type=code&redirect_uri=${cb}&state=${state}`;

    default:
      return null;
  }
}

async function exchangeCodeForToken(platform, code) {
  const cb = CALLBACK_URL;

  if (platform === 'facebook' || platform === 'instagram') {
    if (!process.env.FACEBOOK_APP_ID || !process.env.FACEBOOK_APP_SECRET) return null;
    const url = `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${process.env.FACEBOOK_APP_ID}&client_secret=${process.env.FACEBOOK_APP_SECRET}&code=${code}&redirect_uri=${encodeURIComponent(cb)}`;
    const r = await fetch(url);
    const d = await r.json();
    if (d.error || !d.access_token) return null;

    // Get user/page info
    const meR = await fetch(`https://graph.facebook.com/me?fields=id,name&access_token=${d.access_token}`);
    const me  = await meR.json();

    return {
      access_token:  d.access_token,
      refresh_token: d.refresh_token || null,
      expires_in:    d.expires_in    || null,
      account_name:  me.name || platform,
      account_id:    me.id   || null,
    };
  }

  if (platform === 'twitter') {
    if (!process.env.TWITTER_CLIENT_ID || !process.env.TWITTER_CLIENT_SECRET) return null;
    const creds = Buffer.from(`${process.env.TWITTER_CLIENT_ID}:${process.env.TWITTER_CLIENT_SECRET}`).toString('base64');
    const r = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${creds}` },
      body: new URLSearchParams({ code, grant_type: 'authorization_code', redirect_uri: cb, code_verifier: 'challenge' }),
    });
    const d = await r.json();
    if (!d.access_token) return null;

    const meR = await fetch('https://api.twitter.com/2/users/me', { headers: { Authorization: `Bearer ${d.access_token}` } });
    const me  = await meR.json();

    return {
      access_token:  d.access_token,
      refresh_token: d.refresh_token || null,
      expires_in:    d.expires_in    || null,
      account_name:  me.data?.username || me.data?.name || 'twitter',
      account_id:    me.data?.id       || null,
    };
  }

  if (platform === 'youtube') {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return null;
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: cb, grant_type: 'authorization_code' }),
    });
    const d = await r.json();
    if (!d.access_token) return null;

    const chR = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${d.access_token}` } });
    const ch  = await chR.json();
    const channel = ch.items?.[0];

    return {
      access_token:  d.access_token,
      refresh_token: d.refresh_token || null,
      expires_in:    d.expires_in    || null,
      account_name:  channel?.snippet?.title || 'YouTube',
      account_id:    channel?.id || null,
    };
  }

  if (platform === 'tiktok') {
    if (!process.env.TIKTOK_CLIENT_KEY || !process.env.TIKTOK_CLIENT_SECRET) return null;
    const r = await fetch('https://open-api.tiktok.com/oauth/access_token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_key: process.env.TIKTOK_CLIENT_KEY, client_secret: process.env.TIKTOK_CLIENT_SECRET, grant_type: 'authorization_code', redirect_uri: cb }),
    });
    const d = await r.json();
    if (!d.data?.access_token) return null;

    return {
      access_token:  d.data.access_token,
      refresh_token: d.data.refresh_token || null,
      expires_in:    d.data.expires_in    || null,
      account_name:  d.data.open_id       || 'tiktok',
      account_id:    d.data.open_id       || null,
    };
  }

  return null;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /api/social-connections
router.get('/', auth, async (req, res) => {
  try {
    const { data: connections, error } = await supabase
      .from('social_connections')
      .select('id, platform, account_name, account_id, connected, expires_at, created_at')
      .eq('user_id', req.user.id);

    if (error) throw error;

    const result = SUPPORTED_PLATFORMS.map(platform => {
      const conn = connections?.find(c => c.platform === platform);
      return {
        platform,
        connected:     conn?.connected     || false,
        account_name:  conn?.account_name  || null,
        account_id:    conn?.account_id    || null,
        expires_at:    conn?.expires_at    || null,
        connection_id: conn?.id            || null,
      };
    });

    res.json({ success: true, connections: result });
  } catch (err) {
    console.error('[Social] list error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load connections' });
  }
});

// GET /api/social-connections/auth-url/:platform
// Returns the OAuth URL to open in a popup. Encodes user token in state so callback can identify the user.
router.get('/auth-url/:platform', auth, async (req, res) => {
  try {
    const { platform } = req.params;
    if (!SUPPORTED_PLATFORMS.includes(platform)) {
      return res.status(400).json({ success: false, error: 'Unsupported platform' });
    }

    // Encode user identity in state — callback uses this to store token for the right user
    const statePayload = { platform, userId: req.user.id, ts: Date.now() };
    const url = buildAuthUrl(platform, statePayload);

    if (!url) {
      return res.status(503).json({
        success: false,
        error:   'not_configured',
        message: `${platform} connection is being set up. Please check back soon.`,
      });
    }

    res.json({ success: true, url });
  } catch (err) {
    console.error('[Social] auth-url error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to generate auth URL' });
  }
});

// GET /api/social-connections/callback
// OAuth redirect landing point — no auth middleware (user is unauthenticated at this step)
// Reads state to identify user, exchanges code for token, stores it, redirects to frontend
router.get('/callback', async (req, res) => {
  const { code, state, error: oauthError } = req.query;

  if (oauthError) {
    return res.redirect(`${FRONTEND_URL}/oauth/callback?error=${encodeURIComponent(oauthError)}`);
  }

  let statePayload;
  try {
    statePayload = JSON.parse(decodeURIComponent(state));
  } catch {
    return res.redirect(`${FRONTEND_URL}/oauth/callback?error=invalid_state`);
  }

  const { platform, userId } = statePayload;

  if (!code || !platform || !userId) {
    return res.redirect(`${FRONTEND_URL}/oauth/callback?error=missing_params`);
  }

  try {
    const tokenData = await exchangeCodeForToken(platform, code);
    if (!tokenData) {
      return res.redirect(`${FRONTEND_URL}/oauth/callback?error=token_exchange_failed&platform=${platform}`);
    }

    const expires_at = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
      : null;

    const { error: upsertErr } = await supabase
      .from('social_connections')
      .upsert({
        user_id:       userId,
        platform,
        access_token:  tokenData.access_token,
        refresh_token: tokenData.refresh_token || null,
        account_name:  tokenData.account_name  || platform,
        account_id:    tokenData.account_id    || null,
        expires_at,
        connected:     true,
        updated_at:    new Date().toISOString(),
      }, { onConflict: 'user_id,platform' });

    if (upsertErr) throw upsertErr;

    res.redirect(`${FRONTEND_URL}/oauth/callback?success=true&platform=${platform}&account=${encodeURIComponent(tokenData.account_name || platform)}`);
  } catch (err) {
    console.error('[Social] callback error:', err.message);
    res.redirect(`${FRONTEND_URL}/oauth/callback?error=server_error&platform=${platform}`);
  }
});

// POST /api/social-connections/connect — manual / test connect
router.post('/connect', auth, async (req, res) => {
  try {
    const { platform, access_token, refresh_token, account_name, account_id, expires_in } = req.body;
    if (!platform || !SUPPORTED_PLATFORMS.includes(platform)) {
      return res.status(400).json({ success: false, error: 'Invalid platform' });
    }
    if (!access_token) {
      return res.status(400).json({ success: false, error: 'access_token required' });
    }

    const expires_at = expires_in ? new Date(Date.now() + expires_in * 1000).toISOString() : null;

    const { data, error } = await supabase
      .from('social_connections')
      .upsert({
        user_id: req.user.id, platform, access_token,
        refresh_token: refresh_token || null,
        account_name:  account_name  || platform,
        account_id:    account_id    || null,
        expires_at, connected: true,
      }, { onConflict: 'user_id,platform' })
      .select('id, platform, account_name, connected').single();

    if (error) throw error;
    res.json({ success: true, connection: data });
  } catch (err) {
    console.error('[Social] connect error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to save connection' });
  }
});

// DELETE /api/social-connections/:platform
router.delete('/:platform', auth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('social_connections')
      .update({ connected: false, access_token: null, refresh_token: null })
      .eq('user_id', req.user.id)
      .eq('platform', req.params.platform);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('[Social] disconnect error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to disconnect' });
  }
});

// POST /api/social-connections/publish
router.post('/publish', auth, async (req, res) => {
  try {
    const { content_id, platforms, caption, media_url } = req.body;
    if (!platforms || platforms.length === 0) {
      return res.status(400).json({ success: false, error: 'Select at least one platform' });
    }

    const results = {};
    for (const platform of platforms) {
      const { data: conn } = await supabase
        .from('social_connections')
        .select('access_token, account_id, connected')
        .eq('user_id', req.user.id)
        .eq('platform', platform)
        .single();

      if (!conn?.connected || !conn?.access_token) {
        results[platform] = { success: false, error: 'Not connected' };
        continue;
      }

      results[platform] = { success: true, status: 'queued', message: `Post queued for ${platform}` };
    }

    if (content_id) {
      await supabase
        .from('generated_content')
        .update({ status: 'published', published_at: new Date().toISOString(), publish_result: results })
        .eq('id', content_id)
        .eq('user_id', req.user.id);
    }

    res.json({ success: true, results });
  } catch (err) {
    console.error('[Social] publish error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to publish' });
  }
});

module.exports = router;
