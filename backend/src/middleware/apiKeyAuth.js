// Public API authentication: `Authorization: Bearer vk_live_...` or `X-API-Key`.
// Sets req.user = { id } (same shape the app routes use) and req.apiKey.
const rateLimit = require('express-rate-limit');
const { authenticate } = require('../services/apiKeyService');

function extractKey(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  const x = req.headers['x-api-key'];
  return typeof x === 'string' ? x.trim() : null;
}

async function requireApiKey(req, res, next) {
  const raw = extractKey(req);
  if (!raw) return res.status(401).json({ error: { code: 'missing_api_key', message: 'Send your API key as "Authorization: Bearer vk_live_..."' } });
  try {
    const key = await authenticate(raw);
    if (!key) return res.status(401).json({ error: { code: 'invalid_api_key', message: 'API key is invalid, revoked or expired' } });
    req.apiKey = { id: key.id, scopes: key.scopes || [] };
    req.user = { id: key.user_id };
    next();
  } catch (e) {
    console.error('[PublicAPI] key check failed:', e.message);
    res.status(500).json({ error: { code: 'internal_error', message: 'Could not verify API key' } });
  }
}

function requireScope(scope) {
  return (req, res, next) => {
    if (req.apiKey?.scopes?.includes(scope)) return next();
    res.status(403).json({ error: { code: 'insufficient_scope', message: `This key needs the "${scope}" scope` } });
  };
}

// Per-key limit (after authentication, so it is keyed on the verified key id).
const perMinute = Math.max(1, parseInt(process.env.PUBLIC_API_RATE_LIMIT_PER_MINUTE, 10) || 120);
const apiKeyRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: perMinute,
  standardHeaders: true,
  legacyHeaders: false,
  store: new (require('./rateLimits').SharedStore)('public_api_key'),
  keyGenerator: (req) => `key:${req.apiKey?.id || require('../utils/clientIp').clientKeyIp(req)}`,
  message: { error: { code: 'rate_limited', message: `Limit is ${perMinute} requests per minute per key` } },
});

module.exports = { requireApiKey, requireScope, apiKeyRateLimit, extractKey };
