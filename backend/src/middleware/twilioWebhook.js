/**
 * verifyTwilioSignature — Express middleware that proves an inbound webhook
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

function verifyTwilioSignature(req, res, next) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  // No token configured yet — allow through so dev/local isn't blocked.
  if (!authToken) return next();

  const sig = req.get('X-Twilio-Signature');
  if (!sig) {
    console.warn(`[TwilioWebhook] Rejected ${req.originalUrl} — missing X-Twilio-Signature`);
    return res.sendStatus(403);
  }

  // Prefer the configured public host over the (spoofable) Host header.
  const publicBase = process.env.PUBLIC_BASE_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null);
  const host = publicBase ? publicBase.replace(/^https?:\/\//i, '').replace(/\/+$/, '') : req.get('host');
  const url = `https://${host}${req.originalUrl}`;

  const valid = twilio.validateRequest(authToken, sig, url, req.body || {});
  if (!valid) {
    console.warn(`[TwilioWebhook] Rejected ${req.originalUrl} — invalid Twilio signature`);
    return res.sendStatus(403);
  }
  return next();
}

module.exports = { verifyTwilioSignature };
