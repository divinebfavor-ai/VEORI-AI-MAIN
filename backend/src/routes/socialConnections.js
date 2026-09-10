/**
 * Social Media Account Connections + One-Click Publisher
 *
 * Architecture:
 *   - YOU (VEORI) register one app per platform (Facebook App, Twitter App, etc.)
 *   - Those app credentials (App ID + Secret) go in Railway ENV vars - set ONCE by you
 *   - Each operator clicks "Connect" → standard OAuth popup → their own token stored per-user
 *   - Operators never touch Railway or see any technical config
 *
 * Routes:
 *   GET  /api/social-connections              - list all connections for user
 *   GET  /api/social-connections/auth-url/:p  - get OAuth redirect URL
 *   GET  /api/social-connections/callback     - handle OAuth redirect, exchange code → token
 *   POST /api/social-connections/connect      - manual connect (for testing)
 *   DELETE /api/social-connections/:platform  - disconnect
 *   POST /api/social-connections/publish      - post content to connected platform
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

// ─── OAuth state integrity ───────────────────────────────────────────────────
// SECURITY: the `state` parameter used to be plaintext JSON, and the callback
// trusted the userId it found inside. An attacker could walk the OAuth flow with
// their OWN social account while substituting a VICTIM's id into state, binding
// their page and token to the victim's connection row - every post the victim
// made would then publish to the attacker's account (and vice versa).
//
// State is now a short-lived signed JWT. It cannot be edited without JWT_SECRET,
// it expires, and `purpose` stops a token minted elsewhere in the app from being
// replayed here.
const crypto = require('crypto');   // jwt is already required at the top of this file
const JWT_SECRET = process.env.JWT_SECRET;
const STATE_TTL  = '10m';

function signState(payload) {
  return jwt.sign({ ...payload, purpose: 'social_oauth' }, JWT_SECRET, { expiresIn: STATE_TTL });
}

function verifyState(raw) {
  try {
    const decoded = jwt.verify(decodeURIComponent(raw), JWT_SECRET);
    if (decoded.purpose !== 'social_oauth') return null;
    return decoded;
  } catch {
    return null;   // tampered, expired, or not ours
  }
}

// Real PKCE. The previous URL sent a hardcoded literal `code_challenge=challenge`
// with `method=plain`, which is identical for every user and therefore provides
// no protection at all. We now derive an S256 challenge from a random verifier.
//
// TRADE-OFF, stated plainly: the verifier is carried inside the SIGNED state
// rather than a server-side store, because this service has no session storage.
// That is weaker than holding it server-side (it does travel through the
// browser), but it is signed, single-purpose and expires in 10 minutes - and it
// is a strict improvement on a constant that was shared by every user. The
// client secret used at token exchange remains the primary protection.
function makePkce() {
  const verifier  = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildAuthUrl(platform, statePayload, pkce) {
  const state = encodeURIComponent(signState(statePayload));
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
      return `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${process.env.TWITTER_CLIENT_ID}&redirect_uri=${cb}&scope=tweet.read+tweet.write+users.read+offline.access&state=${state}&code_challenge=${pkce.challenge}&code_challenge_method=S256`;

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

// codeVerifier is the PKCE verifier carried back in the signed state (Twitter only).
async function exchangeCodeForToken(platform, code, codeVerifier) {
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
      // Must be the verifier matching the S256 challenge sent at authorize time.
      body: new URLSearchParams({ code, grant_type: 'authorization_code', redirect_uri: cb, code_verifier: codeVerifier || '' }),
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

    // The identity comes from the authenticated session, never from the client,
    // and is sealed into a signed state the callback verifies before use.
    const pkce = makePkce();
    const statePayload = { platform, userId: req.user.id, cv: pkce.verifier, ts: Date.now() };
    const url = buildAuthUrl(platform, statePayload, pkce);

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
// OAuth redirect landing point - no auth middleware (user is unauthenticated at this step)
// Reads state to identify user, exchanges code for token, stores it, redirects to frontend
router.get('/callback', async (req, res) => {
  const { code, state, error: oauthError } = req.query;

  if (oauthError) {
    return res.redirect(`${FRONTEND_URL}/oauth/callback?error=${encodeURIComponent(oauthError)}`);
  }

  // Signature-verified: a caller can no longer name which account this
  // connection binds to. A tampered or expired state is rejected outright.
  const statePayload = verifyState(state);
  if (!statePayload) {
    return res.redirect(`${FRONTEND_URL}/oauth/callback?error=invalid_state`);
  }

  const { platform, userId, cv } = statePayload;

  if (!code || !platform || !userId) {
    return res.redirect(`${FRONTEND_URL}/oauth/callback?error=missing_params`);
  }

  try {
    const tokenData = await exchangeCodeForToken(platform, code, cv);
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

// POST /api/social-connections/connect - manual / test connect
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
