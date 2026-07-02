// ─── Load env FIRST — before any other require ────────────────────────────────
// Railway injects env vars automatically. dotenv is only for local dev.
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

// ─── Global crash guards — keep the process alive on unhandled errors ─────────
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException — keeping process alive:', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection — keeping process alive:', reason);
});

const http    = require('http');
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');
const rateLimit = require('express-rate-limit');

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
// ─── Twilio + ElevenLabs calling layer (v2) — NEW, parallel to Vapi ──────────
const v2VoicesRouter         = require('./routes/v2voices');
const v2VoiceRouter          = require('./routes/v2voice'); // Twilio voice webhooks (twiml/status/recording)

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── Trust Railway/Vercel reverse proxy ───────────────────────────────────────
// Required for express-rate-limit to correctly read X-Forwarded-For
app.set('trust proxy', 1);

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

// ─── HPP — HTTP Parameter Pollution protection ─────────────────────────────
const hpp = require('hpp');
app.use(hpp());

// ─── NoSQL / injection sanitization ───────────────────────────────────────
const mongoSanitize = require('express-mongo-sanitize');
app.use(mongoSanitize({ replaceWith: '_' }));

// Stripe webhook needs raw body — mount BEFORE express.json()
app.use('/api/billing/webhook', require('./routes/billing'));
app.use('/api/stripe/webhook',  require('./routes/billing'));

app.use(express.json({ limit: '1mb' }));          // tightened from 2mb
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ─── CORS — strict production whitelist ───────────────────────────────────
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
    cb(new Error(`CORS: origin ${origin} not allowed`));
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
// General API limit — 600 req per 15 min per IP (unauthenticated)
// Authenticated users get a separate higher limit applied per-route
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !!req.headers.authorization, // authenticated users skip this limit
  message: { success: false, error: 'Too many requests. Please wait a moment and try again.' },
}));

// Authenticated users — 2000 req per 15 min (much higher — they are paying users)
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !req.headers.authorization, // only applies to authenticated requests
  keyGenerator: (req) => {
    // Rate limit per user token, not per IP — so office networks don't share a limit
    const token = (req.headers.authorization || '').replace('Bearer ', '').slice(0, 32);
    return token || req.ip;
  },
  message: { success: false, error: 'You\'re moving fast! Give it a second and try again.' },
}));

// Strict auth limit — 10 attempts per 15 min per IP (brute force protection)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
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
    // So even with a stale VOICE_ENGINE=vapi on Railway, this reports 'stream' —
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
  })
);

app.get('/', (_req, res) =>
  res.json({ success: true, message: 'VEORI AI API 🚀 — Built to Achieve.' })
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
app.use('/api/stripe',          billingRouter); // alias — /api/stripe/webhook, /api/stripe/create-checkout-session

// ─── Intelligence Feature Routes (NEW — do not modify above) ──────────────────
const leadMemoryRouter     = require('./routes/conversationMemory');
const sentimentRouter      = require('./routes/sentimentTimeline');
const dealProbRouter       = require('./routes/dealProbability');
const hotEscalationRouter  = require('./routes/hotEscalation');
const dealPredictionRouter = require('./routes/dealPrediction');
const heatmapRouter        = require('./routes/heatmap');
const dailyBriefingRouter  = require('./routes/dailyBriefing');
const cooRouter            = require('./routes/coo');
app.use('/api/lead-memory',       leadMemoryRouter);
app.use('/api/sentiment',         sentimentRouter);
app.use('/api/deal-probability',  dealProbRouter);
app.use('/api/hot-leads',         hotEscalationRouter);
app.use('/api/deal-prediction',   dealPredictionRouter);
app.use('/api/heatmap',           heatmapRouter);
app.use('/api/briefing',          dailyBriefingRouter);
app.use('/api/coo',               cooRouter);

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
app.use('/api/funding',        fundingRouter); // F17 — transactional funding marketplace

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

// ─── Seller Photo Upload (public — no auth) ───────────────────────────────────
const photoUploadRouter = require('./routes/photoUpload');
app.use('/api/photo-upload', photoUploadRouter);

// ─── Email Opt-Out / Unsubscribe (public — no auth, Feature C) ────────────────
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
  console.log('[LeadEngine] Scheduler active — pulling leads every 24h');
} catch (e) {
  console.warn('[LeadEngine] Scheduler failed to start:', e.message);
}

// ─── BullMQ Job Queue (replaces all setInterval business logic) ───────────────
const { initWorkers } = require('./services/queueService');
try {
  initWorkers();
} catch (err) {
  console.warn('[Queue] BullMQ init failed (Redis may be unavailable):', err.message);
  // Fallback: hourly sequence scan when Redis not available
  const { processReadySequences } = require('./services/sequenceEngine');
  setInterval(processReadySequences, 60 * 60 * 1000);
}

// ─── Auto VAPI sync — runs every 5 min to backfill missed recordings/transcripts
async function autoSyncVapiCalls() {
  try {
    const axios    = require('axios');
    const supabase = require('./config/supabase');
    const VAPI_API_KEY = process.env.VAPI_API_KEY;
    if (!VAPI_API_KEY) return;

    const { data: vapiResp } = await axios.get('https://api.vapi.ai/call', {
      headers: { Authorization: `Bearer ${VAPI_API_KEY}` },
      params: { limit: 50 },
      timeout: 15000,
    });

    const vapiCalls = Array.isArray(vapiResp) ? vapiResp : (vapiResp?.calls || vapiResp?.data || []);
    let synced = 0;

    for (const vc of vapiCalls) {
      if (!vc.id) continue;

      const { data: existing } = await supabase.from('calls')
        .select('id, status, transcript, recording_url, lead_id, ended_at')
        .eq('vapi_call_id', vc.id)
        .single();

      if (!existing) continue;

      // Skip if we already have everything
      const alreadyComplete = existing.status === 'ended' && existing.transcript && existing.recording_url;
      if (alreadyComplete) continue;

      const endedAt  = vc.endedAt || null;
      const startedAt = vc.startedAt || null;
      const duration  = startedAt && endedAt
        ? Math.max(0, Math.round((new Date(endedAt) - new Date(startedAt)) / 1000))
        : null;

      let transcript = vc.transcript || null;
      if (!transcript && Array.isArray(vc.messages)) {
        transcript = vc.messages
          .filter(m => m.role && m.message)
          .map(m => `${m.role === 'assistant' ? 'Alex' : 'Seller'}: ${m.message}`)
          .join('\n');
      }

      const updateFields = {};
      if (vc.status === 'ended' && existing.status !== 'ended') updateFields.status = 'ended';
      if (endedAt && !existing.ended_at) updateFields.ended_at = endedAt;
      if (duration) updateFields.duration_seconds = duration;
      if (vc.recordingUrl && !existing.recording_url) updateFields.recording_url = vc.recordingUrl;
      if (transcript && !existing.transcript) updateFields.transcript = transcript;

      if (Object.keys(updateFields).length === 0) continue;

      await supabase.from('calls').update(updateFields).eq('id', existing.id);

      // Un-stick lead status
      if (existing.lead_id && updateFields.status === 'ended') {
        const { data: lead } = await supabase.from('leads').select('status').eq('id', existing.lead_id).single();
        if (lead?.status === 'calling') {
          await supabase.from('leads').update({ status: 'contacted', last_call_date: endedAt || new Date().toISOString() }).eq('id', existing.lead_id);
        }
      }

      synced++;
    }

    if (synced > 0) console.log(`[AutoSync] Synced ${synced} calls from VAPI`);
  } catch (err) {
    console.error('[AutoSync] VAPI sync error:', err.message);
  }
}

// Run immediately at startup, then every 5 minutes
autoSyncVapiCalls();
setInterval(autoSyncVapiCalls, 5 * 60 * 1000);

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

// ─── New Features (Features: Missed Call Text-Back, SMS Inbox, Appointments) ──
const missedCallsRouter  = require('./routes/missedCalls');
const appointmentsRouter = require('./routes/appointments');
app.use('/api/missed-calls',  missedCallsRouter);
app.use('/api/appointments',  appointmentsRouter);

// ─── Error Handling ───────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── HTTP Server ──────────────────────────────────────────────────────────────
const server = http.createServer(app);

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
    // the real, resolved path — no more misleading 'elevenlabs' or silent Vapi.
    let eng = (process.env.VOICE_ENGINE || process.env.VOICE_ENGINE_DEFAULT || 'stream').toLowerCase();
    const breakGlass = String(process.env.VAPI_CALL_OVERRIDE || '') === 'i-know-vapi-is-decommissioned';
    if (eng === 'vapi' && !breakGlass) eng = 'stream (vapi env ignored — decommissioned)';
    const dg = process.env.DEEPGRAM_API_KEY ? ' (Deepgram ✅)' : ' (⚠️  DEEPGRAM_API_KEY missing)';
    return eng.startsWith('stream') ? eng + dg : eng;
  })()}
  `);
});

module.exports = app;
