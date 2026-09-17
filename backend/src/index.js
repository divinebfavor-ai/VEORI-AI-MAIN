// ─── Load env FIRST - before any other require ────────────────────────────────
// Railway injects env vars automatically. dotenv is only for local dev.
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

// ─── Global crash guards - keep the process alive on unhandled errors ─────────
// These also feed the error tracker, so a crash-level fault is recorded rather
// than only printed. Required lazily inside each handler: these run before the
// module graph is loaded, and a failure here must never prevent boot.
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException - keeping process alive:', err.message, err.stack);
  try { require('./services/observability').captureError(err, { path: 'uncaughtException', status: 500 }); } catch {}
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection - keeping process alive:', reason);
  try {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    require('./services/observability').captureError(err, { path: 'unhandledRejection', status: 500 });
  } catch {}
});

const http    = require('http');
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');
const rateLimit = require('express-rate-limit');
const { endpointRateLimits, SharedStore } = require('./middleware/rateLimits');
const { isSignedByTwilio } = require('./middleware/twilioWebhook');
const { clientKeyIp } = require('./utils/clientIp');
const jwt     = require('jsonwebtoken');

const supabaseClient = require('./config/supabase');
const { errorHandler, notFound } = require('./middleware/errorHandler');

// ─── Route imports ────────────────────────────────────────────────────────────
const authRouter      = require('./routes/auth');
const leadsRouter     = require('./routes/leads');
const callsRouter     = require('./routes/calls');
const campaignsRouter = require('./routes/campaigns');
const phonesRouter    = require('./routes/phones');
const dealsRouter     = require('./routes/deals');
const contractsRouter = require('./routes/contracts');
const buyersRouter    = require('./routes/buyers');
const analyticsRouter = require('./routes/analytics');
const vapiRouter      = require('./routes/vapi');
const followUpsRouter        = require('./routes/followUps');
const propertyPhotosRouter   = require('./routes/propertyPhotos');
const operatorRouter         = require('./routes/operatorProfile');
const titleCoRouter          = require('./routes/titleCompanies');
const sequencesRouter        = require('./routes/sequences');
const complianceRouter       = require('./routes/compliance');
const ariaRouter             = require('./routes/aria');
const conversationsRouter    = require('./routes/conversations');
const academyRouter          = require('./routes/academy');
const waitlistRouter         = require('./routes/waitlist');
const notificationsRouter    = require('./routes/notifications');
const smsRouter              = require('./routes/sms');
const smsFirstRouter         = require('./routes/smsFirst');
const smsTemplatesRouter     = require('./routes/smsTemplates');
const wealthRouter           = require('./routes/wealth');
const billingRouter          = require('./routes/billing');
const feedbackRouter         = require('./routes/feedback');
// ─── Twilio + ElevenLabs calling layer (v2) - NEW, parallel to Vapi ──────────
const v2VoicesRouter         = require('./routes/v2voices');
const v2VoiceRouter          = require('./routes/v2voice'); // Twilio voice webhooks (twiml/status/recording)

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── Trust Railway/Vercel reverse proxy ───────────────────────────────────────
// Required for express-rate-limit to correctly read X-Forwarded-For
// Railway sends requests through its edge and an internal proxy: two hops.
// The visitor's address is resolved in utils/clientIp.js.
app.set('trust proxy', 2);
// ─── Security Headers (Helmet hardened) ──────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,          // handled by Vercel frontend
  crossOriginEmbedderPolicy: false,      // needed for external APIs
  hsts: {
    maxAge:            31536000,         // 1 year
    includeSubDomains: true,
    preload:           true,
  },
  noSniff:                 true,         // X-Content-Type-Options: nosniff
  xssFilter:               true,         // X-XSS-Protection
  referrerPolicy:          { policy: 'strict-origin-when-cross-origin' },
  frameguard:              { action: 'deny' },       // no iframes
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },
  dnsPrefetchControl:      { allow: false },
}));

// ─── HPP - HTTP Parameter Pollution protection ─────────────────────────────
const hpp = require('hpp');
app.use(hpp());

// ─── NoSQL / injection sanitization ───────────────────────────────────────
const mongoSanitize = require('express-mongo-sanitize');
app.use(mongoSanitize({ replaceWith: '_' }));

// Stripe webhook needs raw body - mount BEFORE express.json()
app.use('/api/billing/webhook', require('./routes/billing'));
app.use('/api/stripe/webhook',  require('./routes/billing'));

app.use(express.json({ limit: '1mb' }));          // tightened from 2mb
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ─── CORS - strict production whitelist ───────────────────────────────────
const PROD_ORIGINS = [
  'https://veori.net',
  'https://www.veori.net',
  'http://localhost:3000',
  'http://localhost:5173',
];
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  : PROD_ORIGINS;

app.use(cors({
  origin: (origin, cb) => {
    // Allow server-to-server (no origin), Railway health checks
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return cb(null, true);
    // White label: an operator's custom domain, once its DNS ownership is verified.
    require('./services/brandingService').isVerifiedOrigin(origin)
      .then(ok => (ok ? cb(null, true) : cb(Object.assign(new Error(`CORS: origin ${origin} not allowed`), { status: 403 }))))
      .catch(() => cb(Object.assign(new Error(`CORS: origin ${origin} not allowed`), { status: 403 })));
  },
  credentials:      true,
  methods:          ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders:   ['Content-Type', 'Authorization', 'x-api-key'],
  exposedHeaders:   ['X-RateLimit-Limit', 'X-RateLimit-Remaining'],
  maxAge:           86400,  // preflight cache 24h
}));

// ─── Logging ──────────────────────────────────────────────────────────────────
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ─── Rate Limiting ────────────────────────────────────────────────────────────
// General API limit - 600 req per 15 min per IP (unauthenticated)
// Authenticated users get a separate higher limit applied per-route
// SECURITY: these two limiters used to branch on the mere PRESENCE of an
// Authorization header, so sending `Authorization: Bearer anything` skipped the
// anonymous limiter entirely - and the authenticated limiter was keyed on the
// caller-chosen token prefix, so rotating that string reset the counter. Public
// endpoints were effectively unlimited. Both now branch on a CRYPTOGRAPHICALLY
// VERIFIED user id, which an attacker cannot forge or rotate.
// The result is memoised on the request so we verify at most once per request.
const _JWT_SECRET = process.env.JWT_SECRET;
function verifiedUserId(req) {
  if (req._rlUserId !== undefined) return req._rlUserId;
  let id = null;
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(h.slice(7), _JWT_SECRET);
      // A 2FA-pending token is not a real session - it must not buy the higher
      // authenticated rate limit.
      if (decoded && decoded.type !== '2fa_pending') id = decoded.id || null;
    } catch { /* invalid or expired - treated as anonymous */ }
  }
  req._rlUserId = id;
  return id;
}

app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  store: new SharedStore('global_anon'),
  keyGenerator: clientKeyIp,
  // A VERIFIED session skips this limit. /api/v1 (API-key traffic) has its own
  // limiters: one per IP before authentication, one per key after it. Twilio's
  // signed callbacks skip it too: a busy campaign sends Twilio status and inbound
  // events from a handful of IPs, and a throttled callback is a lost message.
  skip: (req) => !!verifiedUserId(req) || req.originalUrl.startsWith('/api/v1/') || isSignedByTwilio(req),
  message: { success: false, error: 'Too many requests. Please wait a moment and try again.' },
}));

// Authenticated users - 2000 req per 15 min (much higher - they are paying users)
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  store: new SharedStore('global_user'),
  skip: (req) => !verifiedUserId(req), // only applies to verified sessions
  // Keyed on the verified user id - not a caller-controlled string - so the
  // counter cannot be reset by changing the token.
  keyGenerator: (req) => verifiedUserId(req) || clientKeyIp(req),
  message: { success: false, error: 'You\'re moving fast! Give it a second and try again.' },
}));

// Per-endpoint limits for expensive or abusive actions (AI, texts, calls, number
// purchases, verification codes, public forms). See middleware/rateLimits.js.
app.use('/api/', endpointRateLimits);

// Strict auth limit - 10 attempts per 15 min per IP (brute force protection)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  store: new SharedStore('auth'),
  keyGenerator: clientKeyIp,
  message: { success: false, error: 'Too many attempts. Try again in 15 minutes.' },
  skipSuccessfulRequests: true, // only count failed requests
});
// Applied per-route below after route imports

// ─── Health check (no auth, no rate limit) ────────────────────────────────────
app.get('/health', (_req, res) =>
  res.json({
    success: true,
    service: 'VEORI AI',
    version: '1.0.0',
    env: process.env.NODE_ENV || 'development',
    uptime: process.uptime(),
    supabase: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    vapi: !!process.env.VAPI_API_KEY,
    // voiceEngine = the engine a dial will ACTUALLY use, after the absolute Vapi
    // kill-switch is applied. Mirrors the dispatcher logic in vapiService.initiateCall
    // exactly: 'vapi' is rewritten to 'stream' unless the break-glass override is set.
    // So even with a stale VOICE_ENGINE=vapi on Railway, this reports 'stream' -
    // letting the operator confirm from the live /health URL that no dial can reach
    // Vapi. If this ever shows 'vapi', the break-glass flag is (deliberately) set.
    voiceEngine: (() => {
      let eng = (process.env.VOICE_ENGINE || process.env.VOICE_ENGINE_DEFAULT || 'stream').toLowerCase();
      const breakGlass = String(process.env.VAPI_CALL_OVERRIDE || '') === 'i-know-vapi-is-decommissioned';
      if (eng === 'vapi' && !breakGlass) eng = 'stream';
      return eng;
    })(),
    deepgram: !!process.env.DEEPGRAM_API_KEY,
    ai: !!process.env.ANTHROPIC_API_KEY,
    // Twilio creds gate the buy-tollfree / buy-local / toll-free SMS-verification
    // routes (they 503 without both). Surfaced here so the operator can confirm
    // provisioning will work before attempting a purchase.
    twilio: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
    // Redis gates BullMQ (the fast path for timed "call me at 5" callbacks). When
    // false, callbacks still fire via the Redis-independent 2-min sweep, just not
    // to-the-second. Surfaced so the operator can confirm the fast path is live.
    redis: !!process.env.REDIS_URL,
    // AI slot pressure - lets the operator see saturation before users feel it.
    ai_capacity: (() => { try { return require('./services/aiService').aiCapacity(); } catch { return null; } })(),
  })
);

// ─── /ready - readiness probe that actually touches the database ──────────────
// /health above is a LIVENESS probe: it answers "is this process up?" and checks
// only that env vars are present, so it stays 200 during a total database outage.
// That is correct for liveness (restarting the container would not fix a DB
// outage) but useless for knowing whether the service can actually serve.
// /ready performs a real, cheap, time-boxed query and returns 503 when the
// database is unreachable, so a load balancer can drain this instance instead of
// sending it traffic it cannot serve.
app.get('/ready', async (_req, res) => {
  const started = Date.now();
  try {
    const probe = supabaseClient
      .from('users').select('id', { count: 'exact', head: true }).limit(1);
    // Time-box it: a hung DB must fail the probe fast rather than pile up.
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('database probe timed out')), 3000));
    const { error } = await Promise.race([probe, timeout]);
    if (error) throw error;
    return res.json({ ready: true, db: 'up', latency_ms: Date.now() - started });
  } catch (err) {
    return res.status(503).json({ ready: false, db: 'down', error: err.message, latency_ms: Date.now() - started });
  }
});

app.get('/', (_req, res) =>
  res.json({ success: true, message: 'VEORI AI API 🚀 - Built to Achieve.' })
);

// ─── API Routes ───────────────────────────────────────────────────────────────
// Auth routes get strict brute-force limiter
app.use('/api/auth/login',           authLimiter);
app.use('/api/auth/register',        authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password',  authLimiter);
app.use('/api/auth/2fa/verify',      authLimiter);
app.use('/api/auth/2fa/activate',    authLimiter);
app.use('/api/auth',      authRouter);
app.use('/api/leads',     leadsRouter);
app.use('/api/calls',     callsRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/phones',    phonesRouter);
app.use('/api/deals',     dealsRouter);
app.use('/api/contracts', contractsRouter);
app.use('/api/buyers',    buyersRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/vapi',      vapiRouter);
app.use('/api/follow-ups', followUpsRouter);
app.use('/api/property-photos', propertyPhotosRouter);
app.use('/api/operator',        operatorRouter);
app.use('/api/title-companies', titleCoRouter);
app.use('/api/sequences',       sequencesRouter);
app.use('/api/compliance',      complianceRouter);
app.use('/api/aria',            ariaRouter);
app.use('/api/conversations',   conversationsRouter);
app.use('/api/academy',         academyRouter);
app.use('/api/waitlist',        waitlistRouter);
app.use('/api/notifications',   notificationsRouter);
app.use('/api/sms',             smsRouter);
app.use('/api/sms-first',       smsFirstRouter);
app.use('/api/sms-templates',   smsTemplatesRouter);
app.use('/api/v2/voices',       v2VoicesRouter); // Twilio+ElevenLabs voice layer (parallel to Vapi)
app.use('/api/v2/voice',        v2VoiceRouter);  // Twilio voice webhooks: twiml/status/recording
app.use('/api/wealth',          wealthRouter);
app.use('/api/billing',         billingRouter);
app.use('/api/feedback',        feedbackRouter);
app.use('/api/stripe',          billingRouter); // alias - /api/stripe/webhook, /api/stripe/create-checkout-session

// ─── Intelligence Feature Routes (NEW - do not modify above) ──────────────────
const leadMemoryRouter     = require('./routes/conversationMemory');
const sentimentRouter      = require('./routes/sentimentTimeline');
const dealProbRouter       = require('./routes/dealProbability');
const hotEscalationRouter  = require('./routes/hotEscalation');
const dealPredictionRouter = require('./routes/dealPrediction');
const heatmapRouter        = require('./routes/heatmap');
const dailyBriefingRouter  = require('./routes/dailyBriefing');
const cooRouter            = require('./routes/coo');
const agentsRouter         = require('./routes/agents'); // 8-agent layer (flag-fenced, plans-only)
app.use('/api/lead-memory',       leadMemoryRouter);
app.use('/api/sentiment',         sentimentRouter);
app.use('/api/deal-probability',  dealProbRouter);
app.use('/api/hot-leads',         hotEscalationRouter);
app.use('/api/deal-prediction',   dealPredictionRouter);
app.use('/api/heatmap',           heatmapRouter);
app.use('/api/briefing',          dailyBriefingRouter);
app.use('/api/coo',               cooRouter);
app.use('/api/agents',            agentsRouter); // 503 until AGENTS_ENABLED=true → zero blast radius

// ─── Advanced Acquisition Routes (Features 13-21) ─────────────────────────────
const smartListRouter       = require('./routes/smartList');
const dfdRouter             = require('./routes/drivingForDollars');
const callAnalyticsRouter   = require('./routes/callAnalytics');
const callerReputationRouter = require('./routes/callerReputation');
const rehabEstimatorRouter  = require('./routes/rehabEstimator');
const sellerTrustRouter     = require('./routes/sellerTrustScore');
const directMailRouter      = require('./routes/directMail');
const profitCalcRouter      = require('./routes/profitCalc');
app.use('/api/smart-list',         smartListRouter);
app.use('/api/dfd',                dfdRouter);
app.use('/api/call-analytics',     callAnalyticsRouter);
app.use('/api/caller-reputation',  callerReputationRouter);
app.use('/api/rehab',              rehabEstimatorRouter);
app.use('/api/seller-trust',       sellerTrustRouter);
app.use('/api/direct-mail',        directMailRouter);
app.use('/api/profit-calc',        profitCalcRouter);

// ─── Disposition Engine Routes (Features 22-27) ───────────────────────────────
const listingsRouter     = require('./routes/listings');
const dealPackageRouter  = require('./routes/dealPackage');
const fundingRouter      = require('./routes/funding');
app.use('/api/listings',       listingsRouter);
app.use('/api/deal-package',   dealPackageRouter);
app.use('/api/funding',        fundingRouter); // F17 - transactional funding marketplace

// ─── Content + Social Routes (Features 28-33) ────────────────────────────────
const socialConnectionsRouter = require('./routes/socialConnections');
const contentEngineRouter     = require('./routes/contentEngine');
const postQueueRouter         = require('./routes/postQueue');
const publishPipelineRouter   = require('./routes/publishPipeline');
app.use('/api/social-connections', socialConnectionsRouter);
app.use('/api/content',            contentEngineRouter);
app.use('/api/post-queue',         postQueueRouter);
app.use('/api/pipeline',           publishPipelineRouter);

// ─── Flutterwave Billing ─────────────────────────────────────────────────────
const flutterwaveRouter = require('./routes/flutterwaveBilling');
app.use('/api/fw-billing/webhook', express.raw({ type: 'application/json' }));
app.use('/api/fw-billing', flutterwaveRouter);

// ─── Property Marketing Engine ───────────────────────────────────────────────
const propertyMarketingRouter = require('./routes/propertyMarketing');
app.use('/api/property-marketing', propertyMarketingRouter);

// ─── Referral System ─────────────────────────────────────────────────────────
const referralsRouter = require('./routes/referrals');
app.use('/api/referrals', referralsRouter);

// ─── GDPR / CCPA Data Privacy (Compliance Item 4) ────────────────────────────
const privacyRouter = require('./routes/privacy');
app.use('/api/privacy', privacyRouter);

// ─── Seller Photo Upload (public - no auth) ───────────────────────────────────
const photoUploadRouter = require('./routes/photoUpload');
app.use('/api/photo-upload', photoUploadRouter);

// ─── Email Opt-Out / Unsubscribe (public - no auth, Feature C) ────────────────
const emailOptOutRouter = require('./routes/emailOptOut');
app.use('/api/email', emailOptOutRouter);

// ─── Admin Dashboard ─────────────────────────────────────────────────────────
const adminRouter = require('./routes/admin');
app.use('/api/admin', adminRouter);

// ─── Virtual Tours Routes (Features 34-38) ───────────────────────────────────
const virtualToursRouter = require('./routes/virtualTours');
const publicTourRouter   = require('./routes/publicTour');
app.use('/api/tours', virtualToursRouter);
app.use('/api/tour',  publicTourRouter);

// ─── Lead Engine (Autonomous Public Records Sourcing) ─────────────────────────
const leadEngineRouter = require('./routes/leadEngine');
app.use('/api/lead-engine', leadEngineRouter);
const { startLeadEngineScheduler } = require('./services/leadEngine');
try {
  startLeadEngineScheduler();
  console.log('[LeadEngine] Scheduler active - pulling leads every 24h');
} catch (e) {
  console.warn('[LeadEngine] Scheduler failed to start:', e.message);
}

// ─── BullMQ Job Queue (replaces all setInterval business logic) ───────────────
const { initWorkers } = require('./services/queueService');
let queueWorkersRunning = false;
try {
  // initWorkers() returns false when REDIS_URL is unset (it does NOT throw in
  // that case), so the fallback must key off the return value too - previously
  // "no Redis configured" silently meant NO sequence scanning at all.
  queueWorkersRunning = initWorkers() === true;
} catch (err) {
  console.warn('[Queue] BullMQ init failed (Redis may be unavailable):', err.message);
}
if (!queueWorkersRunning) {
  // Fallback: hourly sequence scan when the BullMQ cron isn't running.
  // Armed ONLY when workers are confirmed absent, so it can never double-fire
  // alongside the queue's */15 sequence-scan repeatable job.
  const { processReadySequences } = require('./services/sequenceEngine');
  setInterval(() => {
    processReadySequences().catch(err => console.error('[SequenceScan] fallback tick error:', err.message));
  }, 60 * 60 * 1000);
  console.warn('[Queue] Running WITHOUT BullMQ - hourly interval fallback armed for sequence scans');
}

// NOTE: The 5-minute autoSyncVapiCalls poller was removed - Vapi is
// decommissioned (voice engine is Twilio Media Streams / "stream"), so the
// poller only burned an outbound API call every 5 min against a dead provider.
// Manual backfill for legacy Vapi-era calls remains available via
// POST /api/vapi/sync-calls (requireAuth), which the Leads page still exposes.

// ─── Callback safety-net sweep (Redis-INDEPENDENT) ────────────────────────────
// A "call me at 5" callback is normally fired by a BullMQ delayed job. If Redis
// is down / unset / the enqueuing box restarts, that job is lost. This plain
// setInterval sweep is the backstop: every 2 min it dispatches any due voice
// callback whose follow_ups row is still 'scheduled', with an atomic claim so it
// never double-dials alongside the queue. Guarantees callbacks go out on time
// even with BullMQ fully offline.
const { pollDueCallbacks } = require('./services/followUpProcessor');
const CALLBACK_SWEEP_MS = Number(process.env.CALLBACK_SWEEP_MS) || 2 * 60 * 1000;
setInterval(() => {
  pollDueCallbacks().catch(err => console.error('[CallbackSweep] tick error:', err.message));
}, CALLBACK_SWEEP_MS);

// ─── Title follow-up sweep (Redis-INDEPENDENT) ────────────────────────────────
// scheduleTitleFollowUps() inserts follow_ups rows (contact_type='title_company',
// status='pending') when a deal goes under contract, but no queue job is enqueued
// for them - this sweep is what actually sends the due title-company touches.
// Atomic per-row claim inside prevents double-sends across overlapping ticks.
const { pollDueTitleFollowUps } = require('./services/titleService');
const TITLE_SWEEP_MS = Number(process.env.TITLE_SWEEP_MS) || 10 * 60 * 1000;
setInterval(() => {
  pollDueTitleFollowUps().catch(err => console.error('[TitleSweep] tick error:', err.message));
}, TITLE_SWEEP_MS);

// ─── Learning loop: nightly lesson distillation (Redis-INDEPENDENT) ───────────
// Studies each active operator's VERIFIED call outcomes and refreshes the
// evidence-backed lessons the live voice brain injects into its prompt - the
// mechanism that makes every call smarter than the last. First run 10 min after
// boot (off the boot spike), then every 24h. Disable with LEARNING_LOOP=off.
if (String(process.env.LEARNING_LOOP || 'on') !== 'off') {
  const { distillAllActiveOperators } = require('./services/learningLoopService');
  const LEARNING_SWEEP_MS = Number(process.env.LEARNING_SWEEP_MS) || 24 * 60 * 60 * 1000;
  // Same nightly cycle, two phases: (1) verify matured judge decisions against real
  // outcomes (deterministic - calls/deals/replies), (2) distill lessons from verified
  // material. Verification runs FIRST so distillation always sees the freshest truth.
  const learningTick = async () => {
    try {
      const { verifyDecisionOutcomes } = require('./services/decisionLearningService');
      const v = await verifyDecisionOutcomes({});
      if (v.verified) console.log(`[LearningLoop] verified ${v.verified} decisions (${v.correct} correct, ${v.incorrect} incorrect, ${v.held} human-held)`);
    } catch (err) { console.warn('[LearningLoop] decision verification failed:', err.message); }
    await distillAllActiveOperators();
  };
  setTimeout(() => {
    learningTick().catch(err => console.warn('[LearningLoop] initial cycle failed:', err.message));
    setInterval(() => {
      learningTick().catch(err => console.warn('[LearningLoop] nightly cycle failed:', err.message));
    }, LEARNING_SWEEP_MS);
  }, 10 * 60 * 1000);
}

// ─── Public REST API v1 (API keys) + developer settings ──────────────────────
// Unauthenticated/invalid-key attempts are limited per IP before the key check.
app.use('/api/v1', rateLimit({
  windowMs: 60 * 1000,
  max: Math.max(1, parseInt(process.env.PUBLIC_API_IP_RATE_LIMIT_PER_MINUTE, 10) || 600),
  standardHeaders: true,
  legacyHeaders: false,
  store: new SharedStore('public_api_ip'),
  keyGenerator: clientKeyIp,
  message: { error: { code: 'rate_limited', message: 'Too many requests from this address' } },
}));
app.use('/api/v1', require('./routes/publicApi'));
app.use('/api/developer', require('./routes/developer'));
app.use('/api/team', require('./routes/team'));
app.use('/api/branding', require('./routes/branding'));
app.use('/api/esign', require('./routes/esign'));
app.use('/api/crm', require('./routes/crm'));
app.use('/api/onboarding', require('./routes/onboarding'));
app.use('/api/intelligence', require('./routes/intelligence'));
app.use('/api/portfolio', require('./routes/portfolio'));
// Mirror the agent registry into agent_registry (best-effort; the in-memory registry is authoritative).
require('./intelligence/registry').syncToDatabase()
  .then(n => console.log(`[Intelligence] ${n} agents registered`))
  .catch(err => console.error('[Intelligence] registry sync failed:', err.message));

// Deal Death Prevention sweep: deterministic checks on every under-contract deal
// (no model calls). Deals are claimed per interval, so overlapping servers never
// double-check. Disable with DEAL_MONITOR=off.
if (String(process.env.DEAL_MONITOR || 'on') !== 'off') {
  const monitor = require('./intelligence/engines/monitor');
  let monitoring = false;
  setInterval(() => {
    if (monitoring) return;
    monitoring = true;
    monitor.sweep()
      .then(s => { if (s.opened || s.resolved || s.failed || s.closed_out) console.log('[DealMonitor]', JSON.stringify(s)); })
      .catch(err => console.error('[DealMonitor] sweep failed:', err.message))
      .finally(() => { monitoring = false; });
  }, (Number(process.env.DEAL_MONITOR_SWEEP_MS) || 5 * 60 * 1000));
}

// Autopilot background runs are opt-in (AUTOPILOT_SWEEP_ENABLED=true). Operators can
// always run Autopilot on a deal from the Deal Room.
if (process.env.AUTOPILOT_SWEEP_ENABLED === 'true') {
  const autopilotEngine = require('./intelligence/engines/autopilot');
  let piloting = false;
  setInterval(() => {
    if (piloting) return;
    piloting = true;
    autopilotEngine.sweep()
      .then(s => console.log('[Autopilot] sweep', JSON.stringify(s)))
      .catch(err => console.error('[Autopilot] sweep failed:', err.message))
      .finally(() => { piloting = false; });
  }, (Number(process.env.AUTOPILOT_SWEEP_MS) || 60 * 60 * 1000));
}

// Webhook retry sweep. Each delivery is claimed before sending, so overlapping
// sweeps (or a sweep racing an immediate send) never deliver the same row twice.
{
  const { processDueDeliveries } = require('./services/webhookService');
  let sweeping = false;
  setInterval(() => {
    if (sweeping) return;
    sweeping = true;
    processDueDeliveries()
      .catch(err => console.error('[Webhooks] sweep failed:', err.message))
      .finally(() => { sweeping = false; });
  }, 60 * 1000);
}

// CRM sync sweep: pushes queued leads to connected CRMs, 40 per tick, with retries.
{
  const { processDueJobs } = require('./services/crmService');
  let syncing = false;
  setInterval(() => {
    if (syncing) return;
    syncing = true;
    processDueJobs()
      .catch(err => console.error('[CRM] sweep failed:', err.message))
      .finally(() => { syncing = false; });
  }, 15 * 1000);
}

// ─── New Features (Features: Missed Call Text-Back, SMS Inbox, Appointments) ──
const missedCallsRouter  = require('./routes/missedCalls');
const appointmentsRouter = require('./routes/appointments');
app.use('/api/missed-calls',  missedCallsRouter);
app.use('/api/appointments',  appointmentsRouter);

// ─── Error Handling ───────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── Startup security-config audit ────────────────────────────────────────────
// Webhook verification now FAILS CLOSED in production. That is the correct
// posture - an unverified inbound webhook is a forged seller reply, a forged
// call status or a forged email event - but a missing secret would otherwise
// show up only as a mysterious 503 later. This prints the exact problem at boot,
// so it is visible in the deploy log the moment it happens.
if (process.env.NODE_ENV === 'production') {
  const webhookSecrets = [
    ['TWILIO_AUTH_TOKEN',     'inbound SMS + call status webhooks will return 503'],
    ['RESEND_WEBHOOK_SECRET', 'email delivery/engagement webhooks will return 503'],
    ['EMAIL_INBOUND_SECRET',  'inbound email webhook will return 503'],
  ];
  const missing = webhookSecrets.filter(([k]) => !process.env[k]);
  const allowUnverified = String(process.env.ALLOW_UNVERIFIED_WEBHOOKS || '') === 'true';
  if (missing.length) {
    console.error('┌─ SECURITY CONFIG WARNING ───────────────────────────────────');
    console.error('│ These webhook secrets are NOT set in production:');
    for (const [k, effect] of missing) console.error(`│   • ${k} - ${effect}`);
    if (allowUnverified) {
      console.error('│');
      console.error('│ ALLOW_UNVERIFIED_WEBHOOKS=true is set, so these endpoints are');
      console.error('│ ACCEPTING UNVERIFIED EVENTS. Anyone who knows the URL can forge');
      console.error('│ them. Set the secrets above and remove this override.');
    } else {
      console.error('│');
      console.error('│ Those endpoints now REJECT unverified events (503) rather than');
      console.error('│ trusting them. Set the secrets in the Railway service variables.');
      console.error('│ To temporarily restore delivery: ALLOW_UNVERIFIED_WEBHOOKS=true');
    }
    console.error('└─────────────────────────────────────────────────────────────');
  } else {
    console.log('[startup] All webhook verification secrets present.');
  }
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────
const server = http.createServer(app);

// Railway sends SIGTERM on every deploy. Without this the process was killed
// outright and in-flight requests were cut mid-work - including a dial partway
// through initiation. Now we stop accepting connections, drain what is running,
// and only force-exit if something is still hanging after the grace window.
try {
  require('./services/observability').installGracefulShutdown(server, {
    timeoutMs: Number(process.env.SHUTDOWN_GRACE_MS || 15000),
  });
} catch (e) {
  console.warn('[index] graceful shutdown not installed:', e.message);
}

// ─── Real-time streaming voice engine (VOICE_ENGINE=stream) ───────────────────
// ADDITIVE: attaches a WebSocket handler for /api/v2/voice/media-stream to the
// SAME http server. Inert unless a call is routed through the streaming path
// (VOICE_ENGINE=stream), which only Twilio's <Connect><Stream> ever connects to.
// All other routes/behaviour are byte-identical with the flag unset.
try {
  require('./services/mediaStreamServer').attach(server);
} catch (e) {
  console.warn('[index] mediaStreamServer attach skipped:', e.message);
}

// ─── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════╗
║         VEORI AI Backend v1.0            ║
║   Autonomous Real Estate Acquisitions    ║
║         Built to Achieve. 🚀            ║
╚══════════════════════════════════════════╝
  Port      : ${PORT}
  Env       : ${process.env.NODE_ENV || 'development'}
  Supabase  : ${process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ Connected' : '⚠️  Key missing'}
  Anthropic : ${process.env.ANTHROPIC_API_KEY ? '✅ Connected' : '⚠️  Key missing'}
  Voice eng : ${(() => {
    // Report the ENGINE THE DISPATCHER WILL ACTUALLY USE (matches vapiService).
    // Default is 'stream' (in-house Twilio+Deepgram+ElevenLabs). A stale
    // VOICE_ENGINE=vapi is neutralised to 'stream' unless the break-glass override
    // VAPI_CALL_OVERRIDE=i-know-vapi-is-decommissioned is set, so the banner shows
    // the real, resolved path - no more misleading 'elevenlabs' or silent Vapi.
    let eng = (process.env.VOICE_ENGINE || process.env.VOICE_ENGINE_DEFAULT || 'stream').toLowerCase();
    const breakGlass = String(process.env.VAPI_CALL_OVERRIDE || '') === 'i-know-vapi-is-decommissioned';
    if (eng === 'vapi' && !breakGlass) eng = 'stream (vapi env ignored - decommissioned)';
    const dg = process.env.DEEPGRAM_API_KEY ? ' (Deepgram ✅)' : ' (⚠️  DEEPGRAM_API_KEY missing)';
    return eng.startsWith('stream') ? eng + dg : eng;
  })()}
  `);

  // ─── Rehydrate active campaigns after a restart ─────────────────────────────
  // The dialer session (in-memory Map + setInterval) is wiped on every restart,
  // but the DB still says status:'active' → a zombie campaign that dials nothing.
  // Re-arm each live campaign's dialer here so calls resume automatically without
  // the operator having to re-click Start. Best-effort; never blocks boot.
  try {
    const { rehydrateActiveCampaigns } = require('./services/campaignManager');
    rehydrateActiveCampaigns().catch(err =>
      console.warn('[Campaign] rehydrate on boot failed:', err.message));
  } catch (e) {
    console.warn('[Campaign] rehydrate wiring skipped:', e.message);
  }
});

module.exports = app;
