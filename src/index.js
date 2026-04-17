// ─── Load env FIRST — before any other require ────────────────────────────────
// Railway injects env vars automatically. dotenv is only for local dev.
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

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
const buyersRouter    = require('./routes/buyers');
const analyticsRouter = require('./routes/analytics');
const vapiRouter      = require('./routes/vapi');

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── Security ─────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

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
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, standardHeaders: true, legacyHeaders: false }));

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
app.use('/api/auth',      authRouter);
app.use('/api/leads',     leadsRouter);
app.use('/api/calls',     callsRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/phones',    phonesRouter);
app.use('/api/deals',     dealsRouter);
app.use('/api/buyers',    buyersRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/vapi',      vapiRouter);

// ─── Error Handling ───────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
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
