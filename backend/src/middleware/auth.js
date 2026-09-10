const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('[FATAL] JWT_SECRET environment variable is not set. Refusing to start - tokens would be insecure.');
  process.exit(1);
}

// SECURITY: the 2FA "pending" token issued after a correct password but BEFORE
// the OTP/TOTP step is signed with this same JWT_SECRET, so it verifies cleanly
// here. Without the type check below it was accepted as a full session token -
// meaning anyone holding only the password could skip 2FA entirely for its 5
// minute lifetime. Only routes/auth.js#verifyTempToken may accept this type.
function isPending2FA(decoded) {
  return decoded && decoded.type === '2fa_pending';
}

async function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Missing or invalid Authorization header' });
  }
  try {
    const decoded = jwt.verify(auth.slice(7), JWT_SECRET);
    if (isPending2FA(decoded)) {
      return res.status(401).json({
        success: false,
        error: 'Two-factor authentication is not complete',
        code: 'TWO_FA_REQUIRED',
      });
    }
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

// Optional auth - attaches user if token present, continues if not.
// A 2FA-pending token must NOT populate req.user here either, or routes using
// optionalAuth would treat a half-authenticated caller as fully signed in.
async function optionalAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(auth.slice(7), JWT_SECRET);
      if (!isPending2FA(decoded)) req.user = decoded;
    } catch { /* ignore */ }
  }
  next();
}

module.exports = { requireAuth, optionalAuth };
