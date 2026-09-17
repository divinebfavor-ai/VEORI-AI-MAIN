// A token only works while it matches the account's session epoch, so a password
// reset (or "sign out everywhere") retires tokens issued before it.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

process.env.JWT_SECRET = 'test';
process.env.SESSION_EPOCH_CACHE_MS = '-1'; // negative TTL = always re-read (no caching in the test)

let epoch = 0;
let reads = 0;
const fake = {
  from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => { reads++; return { data: { session_epoch: epoch }, error: null }; } }),
  rpc: async () => { epoch++; return { data: epoch, error: null }; },
};
const file = require.resolve(path.join(__dirname, '..', 'config/supabase.js'));
require.cache[file] = { id: file, filename: file, loaded: true, exports: fake };

const jwt = require('jsonwebtoken');
const { requireAuth } = require('../middleware/auth');
const sessionEpoch = require('../services/sessionEpoch');

function call(token) {
  return new Promise(resolve => {
    const req = { headers: { authorization: `Bearer ${token}` }, originalUrl: '/api/auth/me', method: 'GET' };
    const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; resolve({ status: this.statusCode, body: b, passed: false }); return this; } };
    requireAuth(req, res, () => resolve({ status: 200, body: null, passed: true, user: req.user }));
  });
}

test('a token matching the current epoch is accepted', async () => {
  epoch = 0;
  const r = await call(jwt.sign({ id: 'u1', email: 'a@example.com', sv: 0 }, 'test'));
  assert.strictEqual(r.passed, true);
});

test('bumping the epoch retires tokens issued before it', async () => {
  epoch = 0;
  const token = jwt.sign({ id: 'u1', email: 'a@example.com', sv: 0 }, 'test');
  assert.strictEqual((await call(token)).passed, true);
  await sessionEpoch.bump('u1');
  const after = await call(token);
  assert.strictEqual(after.passed, false);
  assert.strictEqual(after.status, 401);
  assert.strictEqual(after.body.code, 'SESSION_REVOKED');
  // A token issued after the bump works again.
  const fresh = jwt.sign({ id: 'u1', email: 'a@example.com', sv: epoch }, 'test');
  assert.strictEqual((await call(fresh)).passed, true);
});

test('a token without the claim is only valid while the account has never bumped', async () => {
  epoch = 0;
  const legacy = jwt.sign({ id: 'u1', email: 'a@example.com' }, 'test');
  assert.strictEqual((await call(legacy)).passed, true);
  epoch = 3;
  assert.strictEqual((await call(legacy)).status, 401);
});
