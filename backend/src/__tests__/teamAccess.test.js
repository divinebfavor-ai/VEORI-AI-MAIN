// Run with:  node --test src/__tests__/
// Team role rules enforced in middleware/auth.js for every route.

const test = require('node:test');
const assert = require('node:assert');
const { accessDenied } = require('../services/teamService');

const can = (role, method, url) => accessDenied({ role, method, url }) === null;

test('the owner can do everything', () => {
  for (const url of ['/api/billing/checkout', '/api/developer/api-keys', '/api/phones/buy-local', '/api/leads']) {
    assert.ok(can('owner', 'POST', url), url);
  }
});

test('admin: everything but billing, referrals and privacy', () => {
  assert.ok(can('admin', 'POST', '/api/developer/api-keys'));
  assert.ok(can('admin', 'POST', '/api/phones/buy-local'));
  assert.ok(can('admin', 'PUT', '/api/leads/abc'));
  assert.ok(!can('admin', 'GET', '/api/billing/status'));
  assert.ok(!can('admin', 'POST', '/api/referrals/payout'));
  assert.ok(!can('admin', 'DELETE', '/api/privacy/account'));
});

test('member: day-to-day work, no money, keys or number purchases', () => {
  assert.ok(can('member', 'POST', '/api/leads/bulk'));
  assert.ok(can('member', 'PATCH', '/api/deals/1/stage'));
  assert.ok(can('member', 'GET', '/api/phones'));
  assert.ok(!can('member', 'POST', '/api/phones/buy-tollfree'));
  assert.ok(!can('member', 'PUT', '/api/operator/profile'));
  assert.ok(!can('member', 'GET', '/api/developer/api-keys'));
  assert.ok(!can('member', 'GET', '/api/fw-billing/plans'));
});

test('viewer: reads only, but can still manage their own sign-in and team membership', () => {
  assert.ok(can('viewer', 'GET', '/api/leads'));
  assert.ok(!can('viewer', 'POST', '/api/leads'));
  assert.ok(!can('viewer', 'DELETE', '/api/buyers/1'));
  assert.ok(can('viewer', 'POST', '/api/auth/2fa/setup/totp'));
  assert.ok(can('viewer', 'POST', '/api/team/leave'));
  assert.ok(can('viewer', 'POST', '/api/feedback'));
});

test('prefix matching does not over-match similar paths', () => {
  assert.ok(can('member', 'GET', '/api/billingual-notes'));
  assert.ok(!can('member', 'GET', '/api/billing?x=1'));
});
