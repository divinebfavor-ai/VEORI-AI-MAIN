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
const wealthRouter           = require('./routes/wealth');
const billingRouter          = require('./routes/billing');

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── Security ─────────────────────────────────────────────────────────────────
app.use(helmet());

// Stripe webhook needs raw body — mount BEFORE express.json()
app.use('/api/billing/webhook', require('./routes/billing'));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : ['http://localhost:3000', 'http://localhost:5173'];

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow no-origin requests (Postman, Railway health checks, curl)
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  })
);

// ─── Logging ──────────────────────────────────────────────────────────────────
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ─── Rate Limiting ────────────────────────────────────────────────────────────
// General API limit — 300 req per 15 min per IP
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false, message: { success: false, error: 'Too many requests. Please slow down.' } }));

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
    ai: !!process.env.ANTHROPIC_API_KEY,
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
app.use('/api/wealth',          wealthRouter);
app.use('/api/billing',         billingRouter);

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

// ─── Error Handling ───────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── HTTP Server ──────────────────────────────────────────────────────────────
const server = http.createServer(app);

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
  Vapi      : ${process.env.VAPI_API_KEY ? '✅ Connected' : '⚠️  Key missing'}
  Anthropic : ${process.env.ANTHROPIC_API_KEY ? '✅ Connected' : '⚠️  Key missing'}
  `);
});

module.exports = app;
