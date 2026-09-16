// ─── Dropbox Sign (formerly HelloSign) ───────────────────────────────────────
// Turned on by setting DROPBOX_SIGN_API_KEY. Until then contracts use Veori's own
// signing page. Optional: DROPBOX_SIGN_TEST_MODE=true sends non-binding test
// requests (free on every plan) while you verify the setup.
//
// Callback: in Dropbox Sign > API settings set the account callback URL to
//   https://<your backend>/api/esign/dropbox-sign/callback
// Events are verified with event_hash = HMAC-SHA256(api key, event_time + event_type).

const crypto = require('crypto');
const axios = require('axios');

const API_BASE = 'https://api.hellosign.com/v3';

function isEnabled() {
  return !!process.env.DROPBOX_SIGN_API_KEY;
}

function authConfig() {
  return { auth: { username: process.env.DROPBOX_SIGN_API_KEY, password: '' }, timeout: 30000 };
}

/**
 * Send a signature request. Signers sign in the given order; with no form fields in
 * the PDF, Dropbox Sign appends a signature page for each signer.
 *
 * @param {object} p
 * @param {string} p.title
 * @param {string} p.subject
 * @param {string} p.message
 * @param {Buffer} p.pdf
 * @param {string} p.filename
 * @param {Array<{name:string,email:string}>} p.signers  in signing order
 * @param {object} p.metadata  small string map echoed back in callbacks
 * @returns {Promise<{ requestId: string, signatures: Array<{signature_id, signer_email_address, order}> }>}
 */
async function sendSignatureRequest({ title, subject, message, pdf, filename, signers, metadata }) {
  if (!isEnabled()) throw new Error('DROPBOX_SIGN_API_KEY is not set');
  const form = new FormData();
  form.append('title', String(title).slice(0, 255));
  form.append('subject', String(subject).slice(0, 255));
  form.append('message', String(message).slice(0, 5000));
  form.append('test_mode', process.env.DROPBOX_SIGN_TEST_MODE === 'true' ? '1' : '0');
  signers.forEach((s, i) => {
    form.append(`signers[${i}][email_address]`, s.email);
    form.append(`signers[${i}][name]`, s.name);
    form.append(`signers[${i}][order]`, String(i));
  });
  Object.entries(metadata || {}).forEach(([k, v]) => form.append(`metadata[${k}]`, String(v)));
  form.append('files[0]', new Blob([pdf], { type: 'application/pdf' }), filename);

  const { data } = await axios.post(`${API_BASE}/signature_request/send`, form, authConfig());
  const sr = data?.signature_request;
  if (!sr?.signature_request_id) throw new Error('Dropbox Sign returned no signature_request_id');
  return { requestId: sr.signature_request_id, signatures: sr.signatures || [] };
}

function verifyEvent(payload) {
  const ev = payload?.event;
  if (!ev || !isEnabled()) return false;
  const expected = crypto.createHmac('sha256', process.env.DROPBOX_SIGN_API_KEY)
    .update(`${ev.event_time}${ev.event_type}`).digest('hex');
  const got = String(ev.event_hash || '');
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

module.exports = { isEnabled, sendSignatureRequest, verifyEvent };
