// ─── Observability ────────────────────────────────────────────────────────────
// Before this, the only signal the platform emitted was console output. There was
// no error tracking, no structured logs and no metrics - so at any real user
// count, customers would discover failures before the operator did.
//
// Deliberately DEPENDENCY-FREE. Sentry is supported but optional: if
// @sentry/node is installed AND SENTRY_DSN is set, errors are forwarded there
// too. With neither, everything below still works - structured JSON logs that
// Railway can index, plus an in-memory error ring buffer the operator can read
// from /health/errors. Nothing here can crash the request path: every function
// swallows its own failures, because a logging bug must never take down a dial.

const MAX_RING = 50;
const _ring = [];          // most recent errors, newest last
const _counts = new Map(); // fingerprint -> { count, first, last, sample }

let _sentry = null;
if (process.env.SENTRY_DSN) {
  try {
    // Optional peer dependency - absent in most installs, and that is fine.
    _sentry = require('@sentry/node');
    _sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
    });
    console.log('[observability] Sentry enabled');
  } catch {
    console.warn('[observability] SENTRY_DSN is set but @sentry/node is not installed - using local capture only');
    _sentry = null;
  }
}

const isProd = () => process.env.NODE_ENV === 'production';

// Group errors that are "the same problem" so a single failing route does not
// flood the buffer with 500 near-identical entries.
function fingerprint(err, ctx = {}) {
  const msg = (err?.message || String(err) || 'unknown').slice(0, 120);
  return `${ctx.method || '-'} ${ctx.route || ctx.path || '-'} :: ${msg}`;
}

// One structured line per event. JSON in production so Railway's log viewer can
// filter on the fields; readable text locally.
function emit(level, event, fields = {}) {
  try {
    const record = { level, event, ts: new Date().toISOString(), ...fields };
    if (isProd()) {
      console[level === 'error' ? 'error' : 'log'](JSON.stringify(record));
    } else {
      const extra = Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : '';
      console[level === 'error' ? 'error' : 'log'](`[${level}] ${event}${extra}`);
    }
  } catch { /* logging must never throw */ }
}

function captureError(err, ctx = {}) {
  try {
    const fp  = fingerprint(err, ctx);
    const now = new Date().toISOString();

    const prev = _counts.get(fp);
    if (prev) {
      prev.count += 1;
      prev.last = now;
    } else {
      _counts.set(fp, { count: 1, first: now, last: now, sample: (err?.message || String(err)).slice(0, 300) });
    }

    _ring.push({
      at: now,
      message: (err?.message || String(err)).slice(0, 300),
      status: ctx.status ?? null,
      method: ctx.method ?? null,
      path: ctx.path ?? null,
      user_id: ctx.userId ?? null,
      // Stack is kept in memory for the operator but never returned to a client.
      stack: isProd() ? undefined : String(err?.stack || '').split('\n').slice(0, 5).join('\n'),
    });
    while (_ring.length > MAX_RING) _ring.shift();

    emit('error', 'request_error', {
      message: (err?.message || String(err)).slice(0, 300),
      status: ctx.status ?? null,
      method: ctx.method ?? null,
      path: ctx.path ?? null,
      user_id: ctx.userId ?? null,
      occurrences: _counts.get(fp).count,
    });

    if (_sentry) {
      _sentry.withScope((scope) => {
        if (ctx.userId) scope.setUser({ id: ctx.userId });
        scope.setTag('method', ctx.method || 'unknown');
        scope.setTag('path', ctx.path || 'unknown');
        if (ctx.status) scope.setTag('status', String(ctx.status));
        _sentry.captureException(err);
      });
    }
  } catch { /* never throw from the error path */ }
}

// Operator-facing snapshot: what is failing, how often, most frequent first.
function errorSummary() {
  const top = [...
    _counts.entries()]
    .map(([fingerprintKey, v]) => ({ fingerprint: fingerprintKey, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
  return { distinct: _counts.size, recent: [..._ring].reverse(), top };
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────
// Railway sends SIGTERM on every deploy. With no handler the process was killed
// outright, cutting in-flight requests - including a dial mid-initiation. This
// stops accepting new connections, lets active requests finish, and force-exits
// only if something hangs past the grace window.
function installGracefulShutdown(server, { timeoutMs = 15000 } = {}) {
  let shuttingDown = false;

  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    emit('info', 'shutdown_started', { signal, grace_ms: timeoutMs });

    const forceExit = setTimeout(() => {
      emit('error', 'shutdown_forced', { signal, reason: 'grace period expired' });
      process.exit(1);
    }, timeoutMs);
    forceExit.unref();   // do not keep the loop alive purely for this timer

    server.close((err) => {
      clearTimeout(forceExit);
      if (err) {
        emit('error', 'shutdown_error', { signal, message: err.message });
        process.exit(1);
      }
      emit('info', 'shutdown_complete', { signal });
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  return () => shuttingDown;
}

module.exports = { captureError, errorSummary, emit, installGracefulShutdown };
