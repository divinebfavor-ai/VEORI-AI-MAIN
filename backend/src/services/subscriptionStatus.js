// ─── Subscription validity ────────────────────────────────────────────────────
// One place that decides whether a user's paid access is currently valid.
//
// WHY THIS EXISTS: `subscription_expires_at` was being WRITTEN on every payment
// but never READ by any gate. Every check was `subscription_status === 'active'`
// alone, so a single successful charge granted permanent access - a failed card
// renewal never actually revoked anything. This centralises the rule so a gate
// can never again drift out of sync.
//
// DELIBERATELY FAILS OPEN in two cases, because wrongly locking out a paying
// customer is worse than a few hours of extra access:
//   1. No `subscription_expires_at` on the row - legacy accounts created before
//      the column was populated must keep working.
//   2. Inside the grace window - payment webhooks retry and can lag by hours, so
//      access survives briefly past the timestamp rather than cutting out while
//      a renewal is still settling.

const GRACE_DAYS = Number(process.env.SUBSCRIPTION_GRACE_DAYS || 3);
const GRACE_MS   = GRACE_DAYS * 24 * 60 * 60 * 1000;

// The column list every caller must SELECT for these helpers to work.
const SUBSCRIPTION_FIELDS = 'subscription_status, subscription_plan, subscription_expires_at';

function isSubscriptionActive(user) {
  if (!user) return false;
  if (user.subscription_status !== 'active') return false;
  if (!user.subscription_plan) return false;

  const raw = user.subscription_expires_at;
  if (!raw) return true;                       // legacy row - see note above

  const expiresAt = new Date(raw).getTime();
  if (Number.isNaN(expiresAt)) return true;    // unparseable - do not lock out

  return Date.now() <= expiresAt + GRACE_MS;
}

// True when the paid period has ended but we are still inside the grace window.
// Lets the UI warn ("your renewal did not go through") while access still works.
function isInGracePeriod(user) {
  if (!user || user.subscription_status !== 'active') return false;
  const raw = user.subscription_expires_at;
  if (!raw) return false;
  const expiresAt = new Date(raw).getTime();
  if (Number.isNaN(expiresAt)) return false;
  const now = Date.now();
  return now > expiresAt && now <= expiresAt + GRACE_MS;
}

module.exports = { isSubscriptionActive, isInGracePeriod, SUBSCRIPTION_FIELDS, GRACE_DAYS };
