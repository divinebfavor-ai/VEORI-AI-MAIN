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

function errorHandler(err, req, res, next) {
  const status  = err.status || err.statusCode || 500;
  const isProd  = process.env.NODE_ENV === 'production';
  const message = err.message || 'Internal Server Error';

  // Always log full error on server
  console.error(`[Error] ${req.method} ${req.path} ${status}:`, isProd ? message : err.stack);

  // In production: only send safe, human-readable messages — never stack traces
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

module.exports = { errorHandler, notFound };
