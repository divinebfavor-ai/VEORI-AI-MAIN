// Run with:  node --test src/__tests__/
//
// These cover the two pure modules that gate money and guard a database filter.
// No framework, no new dependency - node's built-in runner only.
//
// WHY THESE TWO: isSubscriptionActive decides whether a customer gets paid
// service, so a bug either gives the product away or locks out someone who paid.
// sanitizeSearchTerm guards a string that is interpolated into a PostgREST
// filter, so a regression there reopens an injection hole.

const test = require('node:test');
const assert = require('node:assert');

process.env.SUBSCRIPTION_GRACE_DAYS = '3';
const { isSubscriptionActive, isInGracePeriod } = require('../services/subscriptionStatus');
const { sanitizeSearchTerm } = require('../utils/searchFilter');

const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();

// ─── Entitlement ─────────────────────────────────────────────────────────────

test('active subscription with a future expiry is entitled', () => {
  assert.strictEqual(isSubscriptionActive({
    subscription_status: 'active', subscription_plan: 'pro', subscription_expires_at: iso(10 * DAY),
  }), true);
});

test('active subscription that expired LONG ago is NOT entitled', () => {
  // This is the core bug the change fixed: one payment used to grant permanent
  // access because nothing ever compared the expiry to now.
  assert.strictEqual(isSubscriptionActive({
    subscription_status: 'active', subscription_plan: 'pro', subscription_expires_at: iso(-30 * DAY),
  }), false);
});

test('active subscription just inside the grace window is still entitled', () => {
  // Payment webhooks retry and lag; a payer must not be cut off over that.
  assert.strictEqual(isSubscriptionActive({
    subscription_status: 'active', subscription_plan: 'pro', subscription_expires_at: iso(-1 * DAY),
  }), true);
});

test('active subscription past the grace window is NOT entitled', () => {
  assert.strictEqual(isSubscriptionActive({
    subscription_status: 'active', subscription_plan: 'pro', subscription_expires_at: iso(-4 * DAY),
  }), false);
});

test('legacy row with no expiry recorded is entitled (fails open on purpose)', () => {
  // Deliberate: locking out an existing payer is worse than extra access.
  assert.strictEqual(isSubscriptionActive({
    subscription_status: 'active', subscription_plan: 'pro', subscription_expires_at: null,
  }), true);
});

test('unparseable expiry does not lock the customer out', () => {
  assert.strictEqual(isSubscriptionActive({
    subscription_status: 'active', subscription_plan: 'pro', subscription_expires_at: 'not-a-date',
  }), true);
});

test('active status with NO plan is not entitled', () => {
  assert.strictEqual(isSubscriptionActive({
    subscription_status: 'active', subscription_plan: null, subscription_expires_at: iso(10 * DAY),
  }), false);
});

test('cancelled subscription keeps access until the paid-through date', () => {
  // The cancel endpoint promises exactly this; every gate used to revoke instantly.
  assert.strictEqual(isSubscriptionActive({
    subscription_status: 'cancelled', subscription_plan: 'pro', subscription_expires_at: iso(5 * DAY),
  }), true);
});

test('cancelled subscription past the paid-through date is NOT entitled', () => {
  assert.strictEqual(isSubscriptionActive({
    subscription_status: 'cancelled', subscription_plan: 'pro', subscription_expires_at: iso(-1 * DAY),
  }), false);
});

test('cancelled gets NO grace window, unlike a lapsed renewal', () => {
  // A lapse is an accident worth absorbing; a cancellation is deliberate.
  const oneHourPast = { subscription_status: 'cancelled', subscription_plan: 'pro', subscription_expires_at: iso(-3600 * 1000) };
  const lapsed      = { ...oneHourPast, subscription_status: 'active' };
  assert.strictEqual(isSubscriptionActive(oneHourPast), false);
  assert.strictEqual(isSubscriptionActive(lapsed), true);
});

test('cancelled with no paid-through date is not entitled', () => {
  assert.strictEqual(isSubscriptionActive({
    subscription_status: 'cancelled', subscription_plan: 'pro', subscription_expires_at: null,
  }), false);
});

test('trialing / past_due / null user are not entitled', () => {
  for (const status of ['trial', 'trialing', 'past_due', 'unpaid', 'incomplete', undefined]) {
    assert.strictEqual(isSubscriptionActive({
      subscription_status: status, subscription_plan: 'pro', subscription_expires_at: iso(10 * DAY),
    }), false, `status ${status} should not be entitled`);
  }
  assert.strictEqual(isSubscriptionActive(null), false);
  assert.strictEqual(isSubscriptionActive(undefined), false);
});

test('grace period is reported only while actually inside it', () => {
  assert.strictEqual(isInGracePeriod({
    subscription_status: 'active', subscription_plan: 'pro', subscription_expires_at: iso(-1 * DAY),
  }), true);
  assert.strictEqual(isInGracePeriod({
    subscription_status: 'active', subscription_plan: 'pro', subscription_expires_at: iso(10 * DAY),
  }), false);
  assert.strictEqual(isInGracePeriod({
    subscription_status: 'active', subscription_plan: 'pro', subscription_expires_at: iso(-9 * DAY),
  }), false);
});

// ─── PostgREST filter sanitiser ──────────────────────────────────────────────

test('sanitiser strips every character with meaning in a PostgREST or= filter', () => {
  for (const ch of [',', '.', '(', ')', '%', '_', '*', ':', '"', "'", '\\', '<', '>']) {
    const out = sanitizeSearchTerm(`ab${ch}cd`);
    assert.ok(!out.includes(ch), `"${ch}" survived sanitisation: ${out}`);
  }
});

test('sanitiser neutralises an injected predicate but keeps the words', () => {
  const attack = 'x,user_id.neq.00000000-0000-0000-0000-000000000000';
  const out = sanitizeSearchTerm(attack);
  assert.ok(!out.includes(','), 'comma must not survive - it separates predicates');
  assert.ok(!out.includes('.'), 'dot must not survive - it separates column/operator/value');
});

test('sanitiser leaves ordinary searches usable', () => {
  assert.strictEqual(sanitizeSearchTerm('Marcus Johnson'), 'Marcus Johnson');
  assert.strictEqual(sanitizeSearchTerm('  Elm   Creek  '), 'Elm Creek');
  assert.strictEqual(sanitizeSearchTerm('4821 Elm Creek Dr.'), '4821 Elm Creek Dr');
});

test('sanitiser handles non-strings and caps length', () => {
  for (const bad of [null, undefined, 42, {}, []]) {
    assert.strictEqual(sanitizeSearchTerm(bad), '');
  }
  assert.strictEqual(sanitizeSearchTerm('a'.repeat(500)).length, 100);
});
