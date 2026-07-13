/**
 * Account review service
 *
 * Two independent, MANUALLY-triggered pieces of lifecycle logic. Neither runs on a
 * timer, neither suspends an account, and neither auto-messages the operator beyond
 * the single explicit upgrade prompt in Feature 1.
 *
 *   Feature 1 - "deal closed" flag (admin-settable, manual):
 *     An admin flags a Starter account as having closed a deal. That flag (and only
 *     that flag - no calendar cutoff) triggers an in-app prompt inviting the operator
 *     to upgrade to Solo.
 *
 *   Feature 2 - engagement flag (manual scan):
 *     An account that is at least 3 full months old and has shown zero hot leads AND
 *     zero inbound responses is flagged for manual founder review. No suspension, no
 *     message to the operator.
 */

const supabase = require('../config/supabase');

// ── Feature 1 ────────────────────────────────────────────────────────────────
const UPGRADE_PROMPT_TYPE = 'starter_upgrade';   // notifications.type for the prompt
const UPGRADE_TARGET_PLAN = 'solo';              // plan we invite Starter accounts to
const STARTER_PLAN        = 'starter';

// ── Feature 2 ────────────────────────────────────────────────────────────────
const HOT_THRESHOLD        = 85;   // matches hotEscalation.js: motivation_score > 85 is "hot"
const REVIEW_MIN_AGE_MONTHS = 3;   // "after 3 full months"

// Pure: the date exactly `months` calendar months before `from`. Used to select
// accounts old enough to review. Exported so the boundary is unit-testable.
function monthsBefore(from, months) {
  const d = new Date(from.getTime());
  d.setMonth(d.getMonth() - months);
  return d;
}

// ── Feature 1: mark a Starter account "deal closed" → invite upgrade to Solo ──

// Idempotent: creates the upgrade prompt only if the operator has no unread one
// already. Returns true if a new prompt row was inserted.
async function ensureUpgradePrompt(userId) {
  const { data: existing, error } = await supabase
    .from('notifications')
    .select('notification_id')
    .eq('operator_id', userId)
    .eq('type', UPGRADE_PROMPT_TYPE)
    .eq('is_read', false)
    .limit(1);
  if (error) throw error;
  if (existing && existing.length) return false;

  const { error: insErr } = await supabase.from('notifications').insert({
    operator_id: userId,
    type:        UPGRADE_PROMPT_TYPE,
    title:       'Congrats on closing your deal',
    message:     'You closed a deal on the Starter plan. Ready to scale? Upgrade to Solo for 25,000 outreach a month and keep your pipeline moving.',
    link:        `/billing?plan=${UPGRADE_TARGET_PLAN}`,
    is_read:     false,
  });
  if (insErr) throw insErr;
  return true;
}

/**
 * Set (or clear) the "deal closed" flag on an account. The flag is the ONLY trigger
 * for the upgrade prompt - there is no time-based cutoff. The prompt is created only
 * for accounts actually on the Starter plan (upgrading to Solo is meaningless
 * otherwise); the flag itself is still recorded regardless.
 */
async function setDealClosed(userId, { closed = true, adminId = null } = {}) {
  const { data: user, error } = await supabase
    .from('users')
    .select('id, subscription_plan, starter_deal_closed')
    .eq('id', userId)
    .single();
  if (error) throw error;
  if (!user) return { ok: false, reason: 'user not found', userId };

  const { error: upErr } = await supabase
    .from('users')
    .update({
      starter_deal_closed:    !!closed,
      starter_deal_closed_at: closed ? new Date().toISOString() : null,
      starter_deal_closed_by: closed ? (adminId || null) : null,
    })
    .eq('id', userId);
  if (upErr) throw upErr;

  const isStarter = user.subscription_plan === STARTER_PLAN;
  let promptCreated = false;
  if (closed && isStarter) {
    promptCreated = await ensureUpgradePrompt(userId);
  }
  return { ok: true, userId, closed: !!closed, isStarter, promptCreated };
}

// ── Feature 2: engagement scan → flag for manual founder review ──────────────

async function hasHotLeads(userId) {
  const { data: byScore, error: e1 } = await supabase
    .from('leads')
    .select('id')
    .eq('user_id', userId)
    .gt('motivation_score', HOT_THRESHOLD)
    .limit(1);
  if (e1) throw e1;
  if (byScore && byScore.length) return true;

  const { data: byTag, error: e2 } = await supabase
    .from('leads')
    .select('id')
    .eq('user_id', userId)
    .contains('tags', ['HOT'])
    .limit(1);
  if (e2) throw e2;
  return !!(byTag && byTag.length);
}

async function hasResponses(userId) {
  const { data: sms, error: e1 } = await supabase
    .from('sms_messages')
    .select('id')
    .eq('user_id', userId)
    .eq('direction', 'inbound')
    .limit(1);
  if (e1) throw e1;
  if (sms && sms.length) return true;

  const { data: convo, error: e2 } = await supabase
    .from('conversations')
    .select('id')
    .eq('user_id', userId)
    .eq('direction', 'inbound')
    .limit(1);
  if (e2) throw e2;
  return !!(convo && convo.length);
}

/**
 * Scan accounts at least REVIEW_MIN_AGE_MONTHS old and flag any with zero hot leads
 * AND zero inbound responses for manual founder review. Idempotent (skips already
 * flagged accounts). Never suspends and never messages the operator. Pass
 * { dryRun: true } to preview which accounts WOULD be flagged without writing.
 */
async function scanEngagement({ now = new Date(), dryRun = false } = {}) {
  const cutoff = monthsBefore(now, REVIEW_MIN_AGE_MONTHS).toISOString();

  const { data: accounts, error } = await supabase
    .from('users')
    .select('id, email, created_at, subscription_plan, subscription_status, needs_founder_review')
    .lte('created_at', cutoff);
  if (error) throw error;

  const flaggedIds = [];
  for (const acct of accounts || []) {
    if (acct.needs_founder_review) continue;               // already flagged - idempotent
    if (await hasHotLeads(acct.id)) continue;              // has traction
    if (await hasResponses(acct.id)) continue;             // has traction

    flaggedIds.push(acct.id);
    if (!dryRun) {
      const { error: upErr } = await supabase
        .from('users')
        .update({
          needs_founder_review:      true,
          founder_review_reason:     `Zero hot leads and zero responses after ${REVIEW_MIN_AGE_MONTHS} full months`,
          founder_review_flagged_at: now.toISOString(),
        })
        .eq('id', acct.id);
      if (upErr) throw upErr;
    }
  }

  return { scanned: (accounts || []).length, flagged: flaggedIds.length, flaggedIds, dryRun: !!dryRun };
}

// List accounts currently awaiting founder review (read-only, for the admin view).
async function listFounderReview() {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, full_name, subscription_plan, subscription_status, created_at, founder_review_reason, founder_review_flagged_at')
    .eq('needs_founder_review', true)
    .order('founder_review_flagged_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

module.exports = {
  // constants
  UPGRADE_PROMPT_TYPE, UPGRADE_TARGET_PLAN, STARTER_PLAN, HOT_THRESHOLD, REVIEW_MIN_AGE_MONTHS,
  // pure
  monthsBefore,
  // feature 1
  ensureUpgradePrompt, setDealClosed,
  // feature 2
  hasHotLeads, hasResponses, scanEngagement, listFounderReview,
};
