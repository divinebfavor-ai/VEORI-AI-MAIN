/**
 * Email Opt-Out (public — no auth)
 *
 * Feature C — CAN-SPAM one-click unsubscribe. Every cold-drip email embeds a
 * link to this route with a one-time token. Hitting it adds the address to the
 * operator's email_suppressions list so future sends are blocked.
 *
 *   GET /api/email/unsubscribe/:token   — process unsubscribe, render a page
 *
 * SAFETY: read-only on everything except the NEW suppression tables. Never
 * touches leads, calls, or the existing email pipeline beyond adding a gate.
 */

const express = require('express');
const {
  resolveOptOutToken,
  suppressEmail,
  markTokenUsed,
} = require('../services/emailSuppression');

const router = express.Router();

function page(title, message) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
       background:#060E1A;color:#E8EEF5;display:flex;align-items:center;
       justify-content:center;min-height:100vh}
  .card{background:#0A1526;border:1px solid rgba(255,255,255,.08);border-radius:16px;
        padding:40px;max-width:420px;text-align:center}
  h1{font-size:20px;margin:0 0 12px;color:#00C37A}
  p{font-size:15px;line-height:1.5;color:#9FB0C3;margin:0}
</style></head><body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`;
}

router.get('/unsubscribe/:token', async (req, res) => {
  try {
    const record = await resolveOptOutToken(req.params.token);
    if (!record) {
      return res
        .status(410)
        .send(page('Link expired', 'This unsubscribe link is invalid or has already been used.'));
    }

    await suppressEmail({
      userId: record.user_id,
      email: record.email,
      leadId: record.lead_id || null,
      reason: 'unsubscribe',
    });
    await markTokenUsed(req.params.token);

    return res.send(
      page(
        'You’re unsubscribed',
        `We won’t send any more emails to ${record.email}. You can close this window.`
      )
    );
  } catch (err) {
    console.error('[EmailOptOut] error:', err.message);
    return res
      .status(500)
      .send(page('Something went wrong', 'Please try again, or reply to the email to opt out.'));
  }
});

module.exports = router;
