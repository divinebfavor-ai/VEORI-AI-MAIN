/**
 * verifyTwilioSignature - Express middleware that proves an inbound webhook
 * actually came from Twilio before we act on it.
 *
 * Twilio signs every webhook it sends with your Auth Token: it HMAC-SHA1s the
 * full request URL + the POSTed form params and puts the result in the
 * X-Twilio-Signature header. twilio.validateRequest recomputes that and compares.
 * Without this check ANY anonymous POST to /api/v2/voice/status (etc.) could forge
 * a "call completed" event, overwrite a recording URL, or burn AI-scoring tokens.
 *
 * Fail-open ONLY when TWILIO_AUTH_TOKEN is unset (local/dev before config) so we
 * never break a freshly-cloned environment. In production the token is always set,
 * so every voice webhook is verified. Mirrors the proven check in routes/sms.js.
 *
 * URL note: Twilio signs the EXACT public URL it called, including the query
 * string (e.g. ?callId=…). req.originalUrl preserves that. We force https because
 * Railway terminates TLS at the proxy and Twilio always calls the https URL.
 * PUBLIC_BASE_URL, when set, is the authoritative host (avoids a spoofed Host
 * header changing the signed string).
 */
const twilio = require('twilio');

// The exact URL Twilio signed. Prefer the configured public host over the
// (spoofable) Host header.
function signedUrl(req) {
  const publicBase = process.env.PUBLIC_BASE_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null);
  const host = publicBase ? publicBase.replace(/^https?:\/\//i, '').replace(/\/+$/, '') : req.get('host');
  return `https://${host}${req.originalUrl}`;
}

// True only for a request carrying a valid Twilio signature. Used by the global
// rate limiter so Twilio's own callbacks are never throttled and lost.
function isSignedByTwilio(req) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const sig = req.get('X-Twilio-Signature');
  if (!authToken || !sig) return false;
  // routes/sms.js signs against the Host header; accept either form.
  const urls = [signedUrl(req), `https://${req.get('host')}${req.originalUrl}`];
  try { return urls.some(u => twilio.validateRequest(authToken, sig, u, req.body || {})); } catch { return false; }
}

function verifyTwilioSignature(req, res, next) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    // FAIL CLOSED in production. Previously this fell straight through to
    // next(), so if TWILIO_AUTH_TOKEN were ever missing or rotated out on the
    // live service, anyone could POST forged inbound SMS and call-status events
    // - driving real replies, scoring and outbound dials. Local/dev still passes
    // through so nobody is blocked while developing.
    if (process.env.NODE_ENV === 'production') {
      console.error(`[TwilioWebhook] REJECTED ${req.originalUrl} - TWILIO_AUTH_TOKEN is not set in production; cannot verify signature`);
      return res.sendStatus(503);
    }
    console.warn('[TwilioWebhook] TWILIO_AUTH_TOKEN not set - allowing unverified request (non-production only)');
    return next();
  }

  const sig = req.get('X-Twilio-Signature');
  if (!sig) {
    console.warn(`[TwilioWebhook] Rejected ${req.originalUrl} - missing X-Twilio-Signature`);
    return res.sendStatus(403);
  }

  const url = signedUrl(req);

  const valid = twilio.validateRequest(authToken, sig, url, req.body || {});
  if (!valid) {
    console.warn(`[TwilioWebhook] Rejected ${req.originalUrl} - invalid Twilio signature`);
    return res.sendStatus(403);
  }
  return next();
}

module.exports = { verifyTwilioSignature, isSignedByTwilio };
