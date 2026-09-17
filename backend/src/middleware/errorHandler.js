const SAFE_ERRORS = [
  'Invalid or expired token',
  'Email already registered',
  'Invalid credentials',
  'Too many requests',
  'Too many attempts',
  'lead_id required',
  'User not found',
  'Not found',
  'Validation',
  'required',
  'limit reached',
  'blocked',
  'not allowed',
  'Invalid plan',
  'Invalid referral code',
  'Cannot refer yourself',
  'Payment',
  'Unauthorized',
]

function isSafeError(message) {
  return SAFE_ERRORS.some(s => message?.toLowerCase().includes(s.toLowerCase()))
}

// Database errors caused by the request's input, not by a fault on our side.
// Routes pass Supabase/Postgres errors straight to next(); without this a bad id
// ("abc" for a uuid) or a duplicate came back as a 500 and was logged as an outage.
const DB_INPUT_ERRORS = {
  '22P02': [400, 'Invalid id or value'],            // invalid text representation (e.g. not a uuid)
  '22007': [400, 'Invalid date or time'],           // invalid datetime format
  '22008': [400, 'Invalid date or time'],           // datetime out of range
  '22003': [400, 'Number out of range'],            // numeric out of range
  '22001': [400, 'Value too long'],                 // string too long for column
  '23502': [400, 'A required field is missing'],    // not-null violation
  '23503': [400, 'Referenced record not found'],    // foreign key violation
  '23505': [409, 'That record already exists'],     // unique violation
  '23514': [400, 'Invalid value'],                  // check constraint
  PGRST116: [404, 'Not found'],                     // .single() matched no rows
};

function mapDbError(err) {
  if (!err || err.status || err.statusCode) return null;
  const hit = DB_INPUT_ERRORS[err.code];
  return hit ? { status: hit[0], message: hit[1] } : null;
}

function errorHandler(err, req, res, next) {
  const db = mapDbError(err);
  if (db) {
    console.warn(`[Error] ${req.method} ${req.path} ${db.status}: db ${err.code}`);
    return res.status(db.status).json({ success: false, error: db.message });
  }
  // Malformed JSON body from express.json()
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: 'Request body is not valid JSON' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ success: false, error: 'Request body is too large' });
  }

  const status  = err.status || err.statusCode || 500;
  const isProd  = process.env.NODE_ENV === 'production';
  const message = err.message || 'Internal Server Error';

  // Always log full error on server
  console.error(`[Error] ${req.method} ${req.path} ${status}:`, isProd ? message : err.stack);

  // Central capture: structured log + in-memory buffer + Sentry when configured.
  // Only real faults are captured - 4xx are expected client mistakes and would
  // otherwise drown the signal. Wrapped so a logging failure can never turn a
  // handled error into an unhandled one.
  if (status >= 500) {
    try {
      require('../services/observability').captureError(err, {
        status, method: req.method, path: req.path, userId: req.user?.id,
      });
    } catch { /* observability must never break the error path */ }
  }

  // In production: only send safe, human-readable messages - never stack traces
  const clientMessage = isProd
    ? (isSafeError(message) ? message : 'Something went wrong. Please try again.')
    : message;

  res.status(status).json({
    success: false,
    error:   clientMessage,
    ...(!isProd && { stack: err.stack }),
  });
}

function notFound(req, res) {
  // Don't reveal route structure to potential attackers
  res.status(404).json({ success: false, error: 'Not found' });
}

module.exports = { errorHandler, notFound, mapDbError };
