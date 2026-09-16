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

// Identity routes act on the signed-in person, never on a team workspace.
function isIdentityRoute(req) {
  const url = req.originalUrl || '';
  return url === '/api/auth' || url.startsWith('/api/auth/') || url.startsWith('/api/auth?');
}

// Team members work in the owner's workspace: req.user.id becomes the owner's id
// and req.user.actorId is the signed-in person. Role rules are enforced here so
// no route can forget them.
async function applyTeamContext(req, res, decoded) {
  if (isIdentityRoute(req)) {
    req.user = { ...decoded, actorId: decoded.id, actorEmail: decoded.email, teamRole: 'self', teamOwnerId: decoded.id };
    return true;
  }
  const team = require('../services/teamService');
  try {
    req.user = await team.resolveContext(decoded);
  } catch (e) {
    console.error('[Auth] team context failed:', e.message);
    res.status(503).json({ success: false, error: 'Could not verify your team access. Try again.' });
    return false;
  }
  const denied = team.accessDenied({ role: req.user.teamRole, method: req.method, url: req.originalUrl });
  if (denied) {
    res.status(403).json({ success: false, error: denied, code: 'TEAM_ROLE_FORBIDDEN' });
    return false;
  }
  return true;
}

async function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Missing or invalid Authorization header' });
  }
  let decoded;
  try {
    decoded = jwt.verify(auth.slice(7), JWT_SECRET);
  } catch {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
  if (isPending2FA(decoded)) {
    return res.status(401).json({
      success: false,
      error: 'Two-factor authentication is not complete',
      code: 'TWO_FA_REQUIRED',
    });
  }
  if (await applyTeamContext(req, res, decoded)) next();
}

// Optional auth - attaches user if token present, continues if not.
// A 2FA-pending token must NOT populate req.user here either, or routes using
// optionalAuth would treat a half-authenticated caller as fully signed in.
async function optionalAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    let decoded = null;
    try { decoded = jwt.verify(auth.slice(7), JWT_SECRET); } catch { /* ignore */ }
    if (decoded && !isPending2FA(decoded)) {
      if (!(await applyTeamContext(req, res, decoded))) return;
    }
  }
  next();
}

module.exports = { requireAuth, optionalAuth, applyTeamContext };
