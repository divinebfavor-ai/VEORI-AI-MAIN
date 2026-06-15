/**
 * Outreach Credit Meter — lead-outreach SMS metering & enforcement.
 *
 * SECOND meter, separate from the dial meter (calls_used / monthly_dial_limit).
 *   * DIAL meter    : AI voice calls            (calls.js / campaignManager.js)
 *   * OUTREACH meter: lead-outreach SMS         (this file)
 *
 * 1 outbound lead-outreach SMS = 1 outreach credit.
 *   - Opening SMS (sendOpeningSMS) and AI outreach replies (sendReply) ARE metered.
 *   - 2FA OTP, opt-out confirmations, and manual operator replies route through
 *     the raw sendSMS() send point, which is NEVER gated. They never consume
 *     credits and are never blocked.
 *
 * Consumption order: monthly_allocation first, then topup_credits_available.
 * Top-up credits expire at billing-cycle reset (do not roll over).
 *
 * When BOTH monthly allocation AND all top-up credits are exhausted, outreach
 * hard-pauses (outreach_paused = TRUE) and reserve() returns { allowed:false }.
 *
 * Fail-OPEN philosophy: a DB hiccup must never silently swallow a customer's
 * outreach. If we cannot read the meter, we allow the send and log loudly.
 *
 * Columns (see migrations/2026-06-15_topup_and_outreach_meter.sql):
 *   monthly_allocation, outreach_used, outreach_reset_date,
 *   topup_credits_available, topup_credits_used,
 *   notified_at_80_percent, notified_at_95_percent, notified_at_100_percent,
 *   outreach_paused
 */

const supabase = require('../config/supabase');

// Notify-threshold helpers live here so the gate, the service, and the
// top-up resume path all share ONE definition.
const THRESHOLDS = [
  { pct: 80,  flag: 'notified_at_80_percent'  },
  { pct: 95,  flag: 'notified_at_95_percent'  },
  { pct: 100, flag: 'notified_at_100_percent' },
];

/**
 * Compute the live balance for an operator from an already-fetched user row.
 * Pure function — no I/O. Keeps the math in one place.
 */
function computeBalance(u) {
  const allocation     = Math.max(0, u.monthly_allocation || 0);
  const monthlyUsed    = Math.max(0, u.outreach_used || 0);
  const monthlyLeft    = Math.max(0, allocation - monthlyUsed);
  const topupLeft      = Math.max(0, u.topup_credits_available || 0);
  const totalLeft      = monthlyLeft + topupLeft;
  // Percent is of the MONTHLY allocation only (top-ups are "extra", not part of %).
  const percentUsed    = allocation > 0 ? Math.round((monthlyUsed / allocation) * 100) : 0;
  return { allocation, monthlyUsed, monthlyLeft, topupLeft, totalLeft, percentUsed };
}

/**
 * Read-only balance snapshot for an operator. Used by API endpoints / UI.
 * Returns null if the user can't be read.
 */
async function getBalance(userId) {
  if (!userId || !supabase) return null;
  const { data: u, error } = await supabase
    .from('users')
    .select('monthly_allocation, outreach_used, topup_credits_available, topup_credits_used, outreach_paused, outreach_reset_date')
    .eq('id', userId)
    .single();
  if (error || !u) return null;
  const bal = computeBalance(u);
  return { ...bal, paused: !!u.outreach_paused, reset_date: u.outreach_reset_date };
}

/**
 * Reserve `n` outreach credits for an operator before sending lead-outreach SMS.
 *
 * Returns:
 *   { allowed: true,  source: 'monthly'|'topup'|'split'|'unmetered', balance }
 *   { allowed: false, reason: 'paused'|'exhausted', balance }
 *
 * Consumption order: monthly first, then top-up. Writes are best-effort but the
 * decrement is authoritative (we read-modify-write the exact fields we touch).
 * Fires once-per-cycle 80/95/100 notifications as thresholds are crossed.
 *
 * If the operator has NO allocation configured (monthly_allocation = 0 AND no
 * top-up), the meter is treated as "not provisioned" → unmetered ALLOW. This
 * preserves behavior for free-tier / un-provisioned accounts and avoids blocking
 * an operator the billing system hasn't seeded yet.
 */
async function reserve(userId, n = 1) {
  // No user context (e.g. system-level send) → cannot meter → allow.
  if (!userId || !supabase) return { allowed: true, source: 'unmetered', balance: null };

  let u;
  try {
    const { data, error } = await supabase
      .from('users')
      .select('monthly_allocation, outreach_used, topup_credits_available, topup_credits_used, outreach_paused')
      .eq('id', userId)
      .single();
    if (error || !data) {
      // Fail OPEN — never silently swallow outreach on a read error.
      console.warn(`[Outreach] meter read failed for ${userId} — allowing send (fail-open):`, error?.message);
      return { allowed: true, source: 'unmetered', balance: null };
    }
    u = data;
  } catch (e) {
    console.warn(`[Outreach] meter read threw for ${userId} — allowing send (fail-open):`, e.message);
    return { allowed: true, source: 'unmetered', balance: null };
  }

  const bal = computeBalance(u);

  // Un-provisioned account (no plan allocation, no top-up) → don't meter.
  if (bal.allocation === 0 && bal.topupLeft === 0) {
    return { allowed: true, source: 'unmetered', balance: bal };
  }

  // Already hard-paused → block.
  if (u.outreach_paused) {
    return { allowed: false, reason: 'paused', balance: bal };
  }

  // Not enough credits across monthly + top-up → pause + block.
  if (bal.totalLeft < n) {
    await supabase.from('users')
      .update({ outreach_paused: true })
      .eq('id', userId)
      .catch(() => {});
    return { allowed: false, reason: 'exhausted', balance: { ...bal, totalLeft: bal.totalLeft } };
  }

  // ── Split the spend: monthly first, then top-up ──────────────────────────
  const fromMonthly = Math.min(n, bal.monthlyLeft);
  const fromTopup   = n - fromMonthly;

  const newMonthlyUsed = bal.monthlyUsed + fromMonthly;
  const newTopupLeft   = bal.topupLeft - fromTopup;
  const newTopupUsed   = (u.topup_credits_used || 0) + fromTopup;

  const update = { outreach_used: newMonthlyUsed };
  if (fromTopup > 0) {
    update.topup_credits_available = newTopupLeft;
    update.topup_credits_used      = newTopupUsed;
  }

  // If this spend drains everything, pause immediately so the next call blocks.
  const afterTotalLeft = bal.totalLeft - n;
  if (afterTotalLeft <= 0) update.outreach_paused = true;

  await supabase.from('users').update(update).eq('id', userId).catch((e) => {
    console.error(`[Outreach] decrement write failed for ${userId}:`, e.message);
  });

  // Fire-once threshold notifications based on the NEW monthly usage percent.
  const newPercent = bal.allocation > 0 ? Math.round((newMonthlyUsed / bal.allocation) * 100) : 0;
  // Lazy require to dodge any circular-import risk with services that may load this file.
  setImmediate(() => {
    notifyThresholds(userId, newPercent).catch((e) =>
      console.error('[Outreach] threshold notify failed:', e.message));
  });

  const source = fromTopup > 0 ? (fromMonthly > 0 ? 'split' : 'topup') : 'monthly';
  return {
    allowed: true,
    source,
    balance: {
      ...bal,
      monthlyUsed: newMonthlyUsed,
      monthlyLeft: Math.max(0, bal.allocation - newMonthlyUsed),
      topupLeft:   newTopupLeft,
      totalLeft:   afterTotalLeft,
      percentUsed: newPercent,
    },
  };
}

/**
 * Fire 80 / 95 / 100% notifications once per cycle, deduped by boolean flags.
 * Crossing a threshold sets its flag and sends email + in-app. Re-entry is a
 * no-op once the flag is set; flags are cleared by the monthly reset.
 */
async function notifyThresholds(userId, percent) {
  if (!userId || !supabase || percent <= 0) return;

  const { data: u } = await supabase
    .from('users')
    .select('email, full_name, notified_at_80_percent, notified_at_95_percent, notified_at_100_percent, monthly_allocation, outreach_used, topup_credits_available')
    .eq('id', userId)
    .single();
  if (!u) return;

  // Highest crossed-but-not-yet-notified threshold.
  let target = null;
  for (const t of THRESHOLDS) {
    if (percent >= t.pct && !u[t.flag]) target = t;
  }
  if (!target) return;

  // Mark every threshold at/under the target as notified (so a jump from 70→100
  // doesn't later re-fire 80 and 95 separately).
  const flagUpdate = {};
  for (const t of THRESHOLDS) {
    if (target.pct >= t.pct) flagUpdate[t.flag] = true;
  }
  await supabase.from('users').update(flagUpdate).eq('id', userId).catch(() => {});

  const allocation = u.monthly_allocation || 0;
  const used       = u.outreach_used || 0;
  const topup      = u.topup_credits_available || 0;
  const remaining  = Math.max(0, allocation - used) + topup;

  let title, message, emailSubject;
  if (target.pct >= 100) {
    title        = '⛔ Outreach credits exhausted';
    message      = `You've used all ${allocation.toLocaleString()} monthly outreach credits${topup ? ' and your top-up balance' : ''}. Lead outreach is paused. Buy a top-up or upgrade to resume.`;
    emailSubject = 'Your Veori outreach is paused — out of credits';
  } else if (target.pct >= 95) {
    title        = '🔴 95% of outreach credits used';
    message      = `You have ${remaining.toLocaleString()} outreach credits left this cycle. Outreach will pause when they run out — consider a top-up.`;
    emailSubject = "You're at 95% of your Veori outreach credits";
  } else {
    title        = '🟡 80% of outreach credits used';
    message      = `You've used 80% of your ${allocation.toLocaleString()} monthly outreach credits. ${remaining.toLocaleString()} left this cycle.`;
    emailSubject = "You're at 80% of your Veori outreach credits";
  }

  // In-app notification (matches the notifications table shape used elsewhere).
  await supabase.from('notifications').insert({
    operator_id: userId,
    type:        'outreach_credits',
    title,
    message,
    is_read:     false,
    created_at:  new Date().toISOString(),
  }).catch(() => {});

  // Email (best-effort, never throws upward).
  if (u.email) {
    try {
      const emailService = require('./emailService');
      await emailService.sendEmail({
        userId,
        to:        u.email,
        subject:   emailSubject,
        body:      `Hi ${u.full_name || 'there'},\n\n${message}\n\nManage your plan and top-ups in your Veori billing dashboard.\n\n— The Veori Team`,
        emailType: 'outreach_credits',
      });
    } catch (e) {
      console.error('[Outreach] threshold email failed:', e.message);
    }
  }
}

module.exports = { getBalance, reserve, computeBalance, notifyThresholds, THRESHOLDS };
