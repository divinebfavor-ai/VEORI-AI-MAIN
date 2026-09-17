// ─── Per-endpoint rate limits ─────────────────────────────────────────────────
// The global limiters in index.js stop floods. These stop an expensive or abusive
// action from being repeated: AI generation, texts, calls, phone-number purchases,
// skip traces, verification codes, public forms.
//
// Counters live in Redis when REDIS_URL is set, so every server instance shares
// one count. If Redis is unreachable a request falls back to this instance's
// memory - limits get looser for a moment, the app keeps working.
//
// Signed-in requests are counted per user (the verified JWT id, which a caller
// cannot rotate); anonymous requests per IP.

const jwt = require('jsonwebtoken');
const IORedis = require('ioredis');
const { rateLimit, MemoryStore } = require('express-rate-limit');
const { sanitizeRedisUrl } = require('../services/queueService');
const { clientKeyIp } = require('../utils/clientIp');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

// ── Store ─────────────────────────────────────────────────────────────────────
let redis = null;
function getRedis() {
  const url = sanitizeRedisUrl(process.env.REDIS_URL);
  if (!url) return null;
  if (!redis) {
    redis = new IORedis(url, {
      maxRetriesPerRequest: 1,     // fail fast; never hold a request waiting on Redis
      enableOfflineQueue: false,
      connectTimeout: 2000,
      lazyConnect: false,
    });
    redis.on('error', (err) => console.warn('[RateLimit] Redis error:', err.message));
  }
  return redis;
}

// Connect at startup so the first requests after a deploy already share counts.
getRedis();

// INCR + set expiry on first hit, atomically. Returns [hits, ms until reset].
const INCR_LUA = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {hits, ttl}`;

class SharedStore {
  constructor(prefix) {
    this.prefix = `rl:${prefix}:`;
    this.memory = new MemoryStore();
    this.localKeys = true; // express-rate-limit: keys are not shared with other limiters
  }
  init(options) {
    this.windowMs = options.windowMs;
    this.memory.init(options);
  }
  async increment(key) {
    const r = getRedis();
    if (r && r.status === 'ready') {
      try {
        const [hits, ttl] = await r.eval(INCR_LUA, 1, this.prefix + key, this.windowMs);
        return { totalHits: Number(hits), resetTime: new Date(Date.now() + Number(ttl)) };
      } catch (err) {
        console.warn('[RateLimit] falling back to memory:', err.message);
      }
    }
    return this.memory.increment(key);
  }
  async decrement(key) {
    const r = getRedis();
    if (r && r.status === 'ready') {
      try { await r.decr(this.prefix + key); return; } catch { /* fall through */ }
    }
    return this.memory.decrement(key);
  }
  async resetKey(key) {
    const r = getRedis();
    if (r && r.status === 'ready') {
      try { await r.del(this.prefix + key); } catch { /* ignore */ }
    }
    return this.memory.resetKey(key);
  }
}

// ── Identity ──────────────────────────────────────────────────────────────────
function verifiedUserId(req) {
  if (req._rlUserId !== undefined) return req._rlUserId;
  let id = null;
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(h.slice(7), process.env.JWT_SECRET);
      if (decoded && decoded.type !== '2fa_pending') id = decoded.id || null;
    } catch { /* invalid or expired: anonymous */ }
  }
  req._rlUserId = id;
  return id;
}

function clientKey(req) {
  const uid = verifiedUserId(req);
  return uid ? `u:${uid}` : `ip:${clientKeyIp(req)}`;
}

// ── Policies ──────────────────────────────────────────────────────────────────
// max requests per window, per user (or per IP when signed out).
const POLICIES = {
  ai_generation:     { windowMs: MIN,       max: 20,  what: 'AI requests' },
  outbound_text:     { windowMs: MIN,       max: 60,  what: 'texts' },
  email_blast:       { windowMs: HOUR,      max: 5,   what: 'email blasts' },
  direct_mail:       { windowMs: MIN,       max: 30,  what: 'mail sends' },
  call_start:        { windowMs: MIN,       max: 30,  what: 'call starts' },
  campaign_control:  { windowMs: MIN,       max: 20,  what: 'campaign changes' },
  phone_purchase:    { windowMs: HOUR,      max: 10,  what: 'phone number purchases' },
  skip_trace:        { windowMs: MIN,       max: 30,  what: 'skip traces' },
  lead_import:       { windowMs: MIN,       max: 60,  what: 'import batches' },
  bulk_rewrite:      { windowMs: MIN,       max: 10,  what: 'bulk updates' },
  lead_engine:       { windowMs: 10 * MIN,  max: 10,  what: 'lead pulls' },
  verification_code: { windowMs: 15 * MIN,  max: 5,   what: 'verification codes' },
  password_change:   { windowMs: 15 * MIN,  max: 10,  what: 'password changes' },
  api_key_create:    { windowMs: HOUR,      max: 20,  what: 'API keys' },
  webhook_test:      { windowMs: MIN,       max: 10,  what: 'webhook tests' },
  team_invite:       { windowMs: HOUR,      max: 30,  what: 'invites' },
  invite_accept:     { windowMs: 15 * MIN,  max: 20,  what: 'invite attempts' },
  domain_verify:     { windowMs: MIN,       max: 10,  what: 'domain checks' },
  crm_connect:       { windowMs: 15 * MIN,  max: 10,  what: 'CRM connection attempts' },
  crm_backfill:      { windowMs: HOUR,      max: 5,   what: 'CRM full syncs' },
  deal_analysis:     { windowMs: MIN,       max: 10,  what: 'deal analyses' },
  data_refresh:      { windowMs: 10 * MIN,  max: 20,  what: 'property data refreshes' },
  calculation:       { windowMs: MIN,       max: 240, what: 'calculations' },
  public_upload:     { windowMs: 15 * MIN,  max: 20,  what: 'uploads' },
  public_sign:       { windowMs: 15 * MIN,  max: 20,  what: 'signature submissions' },
  public_form:       { windowMs: 15 * MIN,  max: 20,  what: 'submissions' },
  privacy_request:   { windowMs: HOUR,      max: 5,   what: 'privacy requests' },
  data_export:       { windowMs: HOUR,      max: 5,   what: 'exports' },
  recording_link:    { windowMs: MIN,       max: 120, what: 'recording links' },
  voice_preview:     { windowMs: MIN,       max: 30,  what: 'voice previews' },
};

// [METHOD, path pattern (full URL path, no query), policy]
const RULES = [
  // AI generation
  ['GET',  /^\/api\/analytics\/ai-insights$/,                'ai_generation'],
  ['GET',  /^\/api\/analytics\/regional-performance$/,       'ai_generation'],
  ['GET',  /^\/api\/leads\/[^/]+\/research$/,                'ai_generation'],
  ['POST', /^\/api\/leads\/qualify$/,                        'ai_generation'],
  ['POST', /^\/api\/calls\/takeover$/,                       'ai_generation'],
  ['POST', /^\/api\/content\/generate-caption$/,             'ai_generation'],
  ['POST', /^\/api\/property-marketing\/generate-captions$/, 'ai_generation'],
  ['POST', /^\/api\/dfd\/ai-scan$/,                          'ai_generation'],
  ['POST', /^\/api\/operator\/(generate|extract)-script$/,   'ai_generation'],
  ['POST', /^\/api\/pipeline\/publish\/[^/]+$/,              'ai_generation'],
  // Messages, mail, calls
  ['POST', /^\/api\/sms\/send$/,                             'outbound_text'],
  ['POST', /^\/api\/leads\/[^/]+\/send-photo-request$/,      'outbound_text'],
  ['POST', /^\/api\/content\/email-blast$/,                  'email_blast'],
  ['POST', /^\/api\/direct-mail\/(send|auto-trigger\/[^/]+)$/, 'direct_mail'],
  ['POST', /^\/api\/calls\/initiate$/,                       'call_start'],
  ['POST', /^\/api\/calls\/campaign\/(start|pause|stop)$/,   'campaign_control'],
  // Paid provider actions
  ['POST', /^\/api\/phones\/(provision|provision-pool|buy-local|buy-tollfree|import-twilio|auto-scale)$/, 'phone_purchase'],
  ['POST', /^\/api\/phones\/[^/]+\/sms-verification\/submit$/, 'phone_purchase'],
  ['POST', /^\/api\/leads\/[^/]+\/skip-trace$/,              'skip_trace'],
  ['POST', /^\/api\/v2\/voices\/[^/]+\/preview$/,            'voice_preview'],
  // Bulk data
  ['POST', /^\/api\/leads\/(bulk|ingest)$/,                  'lead_import'],
  ['POST', /^\/api\/leads\/(merge|retag-all|reset-stale-calling)$/, 'bulk_rewrite'],
  ['POST', /^\/api\/lead-engine\/(pull|run)(\/[^/]+)?$/,     'lead_engine'],
  // Account security
  ['POST', /^\/api\/auth\/(2fa\/resend|2fa\/setup\/sms|2fa\/setup\/email|forgot-password)$/, 'verification_code'],
  ['PUT',  /^\/api\/auth\/password$/,                        'password_change'],
  ['POST', /^\/api\/developer\/api-keys$/,                   'api_key_create'],
  ['POST', /^\/api\/developer\/webhooks\/[^/]+\/test$/,      'webhook_test'],
  ['POST', /^\/api\/team\/invites$/,                         'team_invite'],
  ['POST', /^\/api\/team\/accept$/,                          'invite_accept'],
  ['POST', /^\/api\/branding\/domain\/verify$/,              'domain_verify'],
  ['POST', /^\/api\/crm\/[^/]+\/connect$/,                   'crm_connect'],
  ['POST', /^\/api\/crm\/[^/]+\/backfill$/,                  'crm_backfill'],
  ['POST', /^\/api\/intelligence\/deals\/[^/]+\/ask$/,        'deal_analysis'],
  ['POST', /^\/api\/intelligence\/deals\/[^/]+\/understanding\/refresh$/, 'data_refresh'],
  ['POST', /^\/api\/intelligence\/calc\/[^/]+$/,              'calculation'],
  ['POST', /^\/api\/intelligence\/deals\/[^/]+\/(scenarios|optimize|timeline)$/, 'calculation'],
  // Public (no login) endpoints
  ['POST', /^\/api\/photo-upload\/[^/]+$/,                   'public_upload'],
  ['POST', /^\/api\/contracts\/handle_sign_submission\/[^/]+$/, 'public_sign'],
  ['POST', /^\/api\/waitlist\/veori-credits$/,               'public_form'],
  ['POST', /^\/api\/tour\/[^/]+\/view$/,                     'public_form'],
  ['POST', /^\/api\/privacy\/delete-request$/,               'privacy_request'],
  ['GET',  /^\/api\/privacy\/export$/,                       'data_export'],
  ['GET',  /^\/api\/calls\/[^/]+\/recording$/,               'recording_link'],
];

function retryMessage(what, seconds) {
  if (seconds <= 90) return `Too many ${what}. Try again in ${seconds} seconds.`;
  return `Too many ${what}. Try again in ${Math.ceil(seconds / 60)} minutes.`;
}

function buildLimiter(name, policy) {
  return rateLimit({
    windowMs: policy.windowMs,
    limit: policy.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: new SharedStore(name),
    keyGenerator: clientKey,
    handler: (req, res) => {
      const reset = req.rateLimit?.resetTime;
      const seconds = Math.max(1, Math.ceil(((reset ? reset.getTime() : Date.now() + policy.windowMs) - Date.now()) / 1000));
      res.set('Retry-After', String(seconds));
      res.status(429).json({
        success: false,
        code: 'RATE_LIMITED',
        policy: name,
        error: retryMessage(policy.what, seconds),
        retry_after_seconds: seconds,
      });
    },
  });
}

const LIMITERS = Object.fromEntries(Object.entries(POLICIES).map(([n, p]) => [n, buildLimiter(n, p)]));

function policyFor(method, path) {
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path;
  for (const [m, re, name] of RULES) {
    if (m === method && re.test(p)) return name;
  }
  return null;
}

// One middleware for the whole API: finds the rule for this request, if any.
function endpointRateLimits(req, res, next) {
  const name = policyFor(req.method, req.originalUrl.split('?')[0]);
  if (!name) return next();
  return LIMITERS[name](req, res, next);
}

module.exports = { endpointRateLimits, policyFor, POLICIES, RULES, SharedStore, verifiedUserId };
