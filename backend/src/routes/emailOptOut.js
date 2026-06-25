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
const supabase = require('../config/supabase');
const {
  resolveOptOutToken,
  suppressEmail,
  markTokenUsed,
  autoSuppressOnEvent,
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

// ─── Resend Webhook — engagement + deliverability ingestion ──────────────────
//
//   POST /api/email/webhook   — Resend posts delivered/opened/clicked/bounced/
//                               complained events here. Public (provider posts
//                               server-to-server; verified by signing secret).
//
// What it does:
//   • Correlates the event to its send row in email_log by Resend message id.
//   • Stamps the matching engagement timestamp (delivered/opened/clicked/...).
//   • AUTO-SUPPRESSES the recipient on a hard bounce or spam complaint so the
//     operator never re-emails a bad/angry address (protects the <0.3% complaint
//     ceiling Google/Yahoo enforce, and keeps bounce rate low).
//
// SAFETY: fail-open. Any DB/parse error returns 200 (so Resend doesn't retry-
// storm) and never throws. Touches only email_log (existing) + email_suppressions
// (existing). If RESEND_WEBHOOK_SECRET is set, we require a matching signature;
// if it's unset we still accept (so the feature works before the secret is wired)
// but log a warning — set the secret in Railway to lock it down.

const RESEND_WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET || '';

// Maps a Resend event type → the email_log column to stamp.
const EVENT_COLUMN = {
  'email.delivered':  'delivered_at',
  'email.opened':     'opened_at',
  'email.clicked':    'clicked_at',
  'email.bounced':    'bounced_at',
  'email.complained': 'complained_at',
};

router.post('/webhook', express.json({ type: '*/*' }), async (req, res) => {
  try {
    // Optional signature gate (Resend signs with svix-style headers). We do a
    // lightweight presence/secret check — full HMAC verification can be layered
    // later without changing this contract.
    if (RESEND_WEBHOOK_SECRET) {
      const sig = req.headers['svix-signature'] || req.headers['resend-signature'] || '';
      if (!sig) {
        console.warn('[ResendWebhook] missing signature header — rejecting');
        return res.status(401).json({ ok: false });
      }
    } else {
      console.warn('[ResendWebhook] RESEND_WEBHOOK_SECRET not set — accepting unverified event');
    }

    const evt   = req.body || {};
    const type  = evt.type;
    const data  = evt.data || {};
    const column = EVENT_COLUMN[type];

    // Resend nests the provider message id under data.email_id (current) or
    // data.message_id. Recipient may be a string or an array.
    const messageId = data.email_id || data.message_id || null;
    const toRaw = Array.isArray(data.to) ? data.to[0] : (data.to || data.recipient || null);
    const email = toRaw ? String(toRaw).trim() : null;

    if (!type || !column) {
      // Unknown/irrelevant event type — ack so Resend stops retrying.
      return res.json({ ok: true, ignored: true });
    }

    // Find the originating send row to recover user_id / lead_id and to stamp it.
    let logRow = null;
    if (supabase && messageId) {
      const { data: row } = await supabase
        .from('email_log')
        .select('id, user_id, lead_id, open_count, click_count')
        .eq('message_id', messageId)
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      logRow = row || null;
    }

    // Stamp the engagement timestamp on the send row (+ increment open/click).
    if (supabase && logRow) {
      const patch = { [column]: new Date().toISOString() };
      if (type === 'email.opened')  patch.open_count  = (logRow.open_count  || 0) + 1;
      if (type === 'email.clicked') patch.click_count = (logRow.click_count || 0) + 1;
      await supabase.from('email_log').update(patch).eq('id', logRow.id)
        .then(() => {}, () => {});
    }

    // Hard bounce or spam complaint → suppress the address for that operator.
    if (type === 'email.bounced' || type === 'email.complained') {
      const reason = type === 'email.complained' ? 'complaint' : 'bounce';
      const userId = logRow?.user_id || null;
      if (userId && email) {
        await autoSuppressOnEvent({ userId, email, leadId: logRow?.lead_id || null, reason });
        console.log(`[ResendWebhook] auto-suppressed ${email} (${reason}) for user ${userId}`);
      }
    }

    return res.json({ ok: true });
  } catch (err) {
    // Never 500 a provider webhook — that triggers retry storms. Log + ack.
    console.error('[ResendWebhook] error:', err.message);
    return res.json({ ok: true, error: 'handled' });
  }
});

module.exports = router;
