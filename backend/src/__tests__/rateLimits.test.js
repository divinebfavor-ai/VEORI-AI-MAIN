// Run with:  node --test src/__tests__/
//
// Covers per-endpoint rate limits: the right policy for each path, a signed-in user
// is counted by their verified id (not a token they can rotate), anonymous callers
// by IP, and going over the limit returns a clear 429 with Retry-After.

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const jwt = require('jsonwebtoken');

delete process.env.REDIS_URL; // memory store for the test
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test';

const { endpointRateLimits, policyFor, POLICIES } = require('../middleware/rateLimits');

test('paths map to their policy; unlisted paths have none', () => {
  assert.strictEqual(policyFor('POST', '/api/calls/initiate'), 'call_start');
  assert.strictEqual(policyFor('POST', '/api/calls/initiate/'), 'call_start');
  assert.strictEqual(policyFor('GET', '/api/calls/initiate'), null);
  assert.strictEqual(policyFor('POST', '/api/phones/buy-tollfree'), 'phone_purchase');
  assert.strictEqual(policyFor('POST', '/api/auth/2fa/resend'), 'verification_code');
  assert.strictEqual(policyFor('POST', '/api/leads/5f0c/skip-trace'), 'skip_trace');
  assert.strictEqual(policyFor('POST', '/api/leads/5f0c/skip-trace/extra'), null);
  assert.strictEqual(policyFor('GET', '/api/leads'), null);
});

async function withServer(fn) {
  const app = express();
  app.set('trust proxy', false);
  app.use(express.json());
  app.use('/api/', endpointRateLimits);
  app.all('*', (_req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.close(); }
}

test('over the limit returns 429 with a plain message; users are counted separately', async () => {
  await withServer(async (base) => {
    const max = POLICIES.phone_purchase.max;
    const tokA = jwt.sign({ id: 'user-a' }, process.env.JWT_SECRET);
    const tokA2 = jwt.sign({ id: 'user-a', iat: 1 }, process.env.JWT_SECRET); // different token, same user
    const tokB = jwt.sign({ id: 'user-b' }, process.env.JWT_SECRET);
    const post = (tok) => fetch(`${base}/api/phones/buy-local`, { method: 'POST', headers: { Authorization: `Bearer ${tok}` } });

    for (let i = 0; i < max; i++) assert.strictEqual((await post(i % 2 ? tokA2 : tokA)).status, 200);
    const blocked = await post(tokA2);
    assert.strictEqual(blocked.status, 429);
    const body = await blocked.json();
    assert.strictEqual(body.code, 'RATE_LIMITED');
    assert.strictEqual(body.policy, 'phone_purchase');
    assert.match(body.error, /^Too many phone number purchases\. Try again in \d+ minutes\.$/);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);

    assert.strictEqual((await post(tokB)).status, 200, 'another user is not affected');
    const other = await fetch(`${base}/api/leads`, { headers: { Authorization: `Bearer ${tokA}` } });
    assert.strictEqual(other.status, 200, 'unlisted endpoints are not affected');
  });
});

test('a forged token does not escape the anonymous per-IP count', async () => {
  await withServer(async (base) => {
    const max = POLICIES.verification_code.max;
    for (let i = 0; i < max; i++) {
      const r = await fetch(`${base}/api/auth/2fa/resend`, { method: 'POST', headers: { Authorization: `Bearer forged-${i}` } });
      assert.strictEqual(r.status, 200);
    }
    const r = await fetch(`${base}/api/auth/2fa/resend`, { method: 'POST', headers: { Authorization: 'Bearer forged-new' } });
    assert.strictEqual(r.status, 429);
  });
});
