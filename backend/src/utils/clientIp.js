// ─── The caller's real IP address ─────────────────────────────────────────────
// Verified against production headers (2026-09-17):
//  - Direct to Railway: X-Forwarded-For is "<client>, <railway edge>" and the socket
//    is Railway's internal proxy, so with `trust proxy` = 2 req.ip is the client.
//  - Through veori.net (Vercel rewrite): X-Forwarded-For holds Vercel's egress IP,
//    shared by many visitors; Vercel puts the visitor in x-vercel-forwarded-for and
//    marks the request with x-vercel-id.
// Rate limits and geo lookups must use the visitor, not a proxy every visitor shares.
//
// Limitation: a caller who hits the Railway domain directly can send their own
// x-vercel-* headers. Closing that needs a secret added at the Vercel edge.

const net = require('net');

function clean(value) {
  const ip = String(value || '').trim().replace(/^::ffff:/i, '');
  return net.isIP(ip) ? ip : null;
}

function clientIp(req) {
  if (req._clientIp !== undefined) return req._clientIp;
  let ip = null;
  if (req.headers['x-vercel-id']) {
    ip = clean(String(req.headers['x-vercel-forwarded-for'] || '').split(',')[0]);
  }
  if (!ip) ip = clean(req.ip);
  req._clientIp = ip; // null when no valid address is known
  return ip;
}

// For rate-limit keys, which need a string.
function clientKeyIp(req) {
  return clientIp(req) || 'unknown';
}

module.exports = { clientIp, clientKeyIp };
