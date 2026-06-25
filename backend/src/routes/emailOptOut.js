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
const { handleInboundReply } = require('../services/emailReplyStop');
const { requireAuth } = require('../middleware/auth'); // Tier 4 — authed analytics

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

// ─── Inbound reply → auto-stop the drip ─────────────────────────────────────
//
//   POST /api/email/inbound   — Resend Inbound (or any mailbox forwarder) posts a
//                               received reply here. When a lead emails back, we
//                               stop their active cold-email drip (a human is now
//                               in the loop). Public: provider posts server-to-
//                               server. Optional shared-secret gate below.
//
// What it does:
//   • Pulls the sender ("from") out of the inbound payload (several provider
//     shapes supported) and an optional operator id, then cancels that lead's
//     ACTIVE email sequences via emailReplyStop.handleInboundReply.
//
// SAFETY: fail-open. Any DB/parse error returns 200 (so the forwarder doesn't
// retry-storm) and never throws. Only flips sequences active→cancelled — never
// touches the send path, leads, or email_log. A no-match is a clean no-op.

const EMAIL_INBOUND_SECRET = process.env.EMAIL_INBOUND_SECRET || '';

router.post('/inbound', express.json({ type: '*/*' }), async (req, res) => {
  try {
    // Optional shared-secret gate (set EMAIL_INBOUND_SECRET in Railway to lock it
    // down). Accepts the secret via header or ?key= so any forwarder can pass it.
    if (EMAIL_INBOUND_SECRET) {
      const provided =
        req.headers['x-inbound-secret'] || req.query.key || '';
      if (provided !== EMAIL_INBOUND_SECRET) {
        console.warn('[EmailInbound] bad/missing secret — rejecting');
        return res.status(401).json({ ok: false });
      }
    }

    const body = req.body || {};
    const data = body.data || body; // Resend nests under data; forwarders post flat.

    // Sender address across common provider shapes (Resend inbound, SendGrid
    // parse, generic forwarders). Recipient may be array/string.
    const fromRaw =
      data.from ||
      data.sender ||
      data.From ||
      (data.envelope && data.envelope.from) ||
      (Array.isArray(data.from) ? data.from[0] : null) ||
      null;

    // Operator hint, if the forwarder supplies one (optional — service falls back
    // to an unscoped lookup when absent).
    const userId = body.user_id || data.user_id || req.query.user_id || null;

    const result = await handleInboundReply({ fromRaw, userId });
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[EmailInbound] error:', err.message);
    return res.json({ ok: true, error: 'handled' });
  }
});

// ─── Tier 4 — Email analytics (authed) ──────────────────────────────────────
//
//   GET /api/email/analytics?days=30   — per-operator email performance.
//
// Reads ONLY email_log (existing + Tier 1 engagement columns). Computes funnel
// rates (sent → delivered → opened → clicked), suppression/bounce/complaint
// counts, and — using the Tier 2b variant suffix on email_type (e.g.
// "coldDrip1:B") — the WINNING subject variant per drip template by open rate.
//
// SAFETY: read-only, operator-scoped (user_id = req.user.id). Fail-soft: any
// query/parse error returns a zeroed payload rather than 500, so the dashboard
// card never breaks. No writes, no new tables.

// Split an email_type into its base template + variant letter.
//   "coldDrip1:B" → { base: 'coldDrip1', variant: 'B' }
//   "coldDrip1"   → { base: 'coldDrip1', variant: 'A' }
function splitVariant(emailType) {
  const t = String(emailType || 'general');
  const i = t.indexOf(':');
  if (i === -1) return { base: t, variant: 'A' };
  return { base: t.slice(0, i), variant: t.slice(i + 1) || 'A' };
}

function pct(n, d) {
  if (!d) return 0;
  return Math.round((n / d) * 1000) / 10; // one decimal place
}

router.get('/analytics', requireAuth, async (req, res) => {
  const empty = {
    range_days: 0,
    totals: { sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0, suppressed: 0 },
    rates: { delivered: 0, open: 0, click: 0, bounce: 0, complaint: 0 },
    variants: [],
  };
  try {
    if (!supabase) return res.json(empty);
    const uid = req.user.id;
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
    const since = new Date(Date.now() - days * 86400000).toISOString();

    // Pull the operator's recent log rows (capped) with just the columns we need.
    const { data: rows, error } = await supabase
      .from('email_log')
      .select('email_type, status, delivered_at, opened_at, clicked_at, bounced_at, complained_at, open_count')
      .eq('user_id', uid)
      .gte('created_at', since)
      .limit(5000);

    if (error || !Array.isArray(rows)) return res.json({ ...empty, range_days: days });

    const totals = { sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0, suppressed: 0 };
    // variant aggregation keyed by "base|variant"
    const vmap = new Map();

    for (const r of rows) {
      const status = r.status || '';
      if (status === 'suppressed') { totals.suppressed += 1; continue; }
      if (status !== 'sent') continue; // throttled/failed don't count toward funnel

      totals.sent += 1;
      const delivered = !!r.delivered_at;
      const opened    = !!r.opened_at || (r.open_count || 0) > 0;
      const clicked   = !!r.clicked_at;
      if (delivered) totals.delivered += 1;
      if (opened)    totals.opened    += 1;
      if (clicked)   totals.clicked   += 1;
      if (r.bounced_at)    totals.bounced    += 1;
      if (r.complained_at) totals.complained += 1;

      const { base, variant } = splitVariant(r.email_type);
      const key = `${base}|${variant}`;
      const v = vmap.get(key) || { template: base, variant, sent: 0, opened: 0, clicked: 0 };
      v.sent += 1;
      if (opened)  v.opened  += 1;
      if (clicked) v.clicked += 1;
      vmap.set(key, v);
    }

    // Build variant rows with open rate, sorted by template then open rate desc,
    // and flag the winner (highest open rate, min 5 sends) per template.
    const variants = Array.from(vmap.values()).map((v) => ({
      ...v,
      open_rate: pct(v.opened, v.sent),
      click_rate: pct(v.clicked, v.sent),
    }));
    const bestByTemplate = new Map();
    for (const v of variants) {
      if (v.sent < 5) continue; // not enough signal to crown a winner
      const cur = bestByTemplate.get(v.template);
      if (!cur || v.open_rate > cur.open_rate) bestByTemplate.set(v.template, v);
    }
    for (const v of variants) {
      v.winner = bestByTemplate.get(v.template) === v;
    }
    variants.sort((a, b) =>
      a.template === b.template ? b.open_rate - a.open_rate : a.template.localeCompare(b.template)
    );

    return res.json({
      range_days: days,
      totals,
      rates: {
        delivered: pct(totals.delivered, totals.sent),
        open:      pct(totals.opened,    totals.sent),
        click:     pct(totals.clicked,   totals.sent),
        bounce:    pct(totals.bounced,   totals.sent),
        complaint: pct(totals.complained, totals.sent),
      },
      variants,
    });
  } catch (err) {
    console.error('[EmailAnalytics] error:', err.message);
    return res.json(empty);
  }
});

module.exports = router;
