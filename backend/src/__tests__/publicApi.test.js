// Run with:  node --test src/__tests__/
//
// Public API building blocks: key hashing and format, webhook signing, and the
// address checks that stop a webhook URL from reaching internal services.

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const { hashKey, KEY_PREFIX, SCOPES } = require('../services/apiKeyService');
const w = require('../services/webhookService');

test('API keys are stored as SHA-256 hashes, never raw', () => {
  const raw = KEY_PREFIX + 'abc';
  assert.strictEqual(hashKey(raw), crypto.createHash('sha256').update(raw).digest('hex'));
  assert.notStrictEqual(hashKey(raw), raw);
  assert.ok(SCOPES.includes('leads:read') && SCOPES.includes('webhooks:manage'));
});

test('webhook signature is HMAC-SHA256 over "<timestamp>.<body>"', () => {
  const body = JSON.stringify({ id: 'e1', type: 'lead.created' });
  const expected = crypto.createHmac('sha256', 'whsec_x').update(`1700000000.${body}`).digest('hex');
  assert.strictEqual(w.sign('whsec_x', 1700000000, body), expected);
  assert.notStrictEqual(w.sign('whsec_y', 1700000000, body), expected);
});

test('internal addresses are blocked, public ones allowed', () => {
  for (const ip of ['10.0.0.1', '172.16.5.4', '192.168.0.10', '127.0.0.1', '169.254.169.254', '100.64.1.1', '0.0.0.0', '::1', 'fd12::1', 'fe80::1', '::ffff:10.0.0.1', '::ffff:a00:1']) {
    assert.strictEqual(w.isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '93.184.216.34', '2606:4700::1111', '::ffff:808:808']) {
    assert.strictEqual(w.isPrivateAddress(ip), false, ip);
  }
});

test('webhook URLs must be https, public and credential-free', () => {
  assert.strictEqual(w.validateUrl('https://hooks.example.com/veori'), 'https://hooks.example.com/veori');
  for (const bad of ['http://example.com', 'https://localhost/x', 'https://10.1.1.1/', 'https://u:p@example.com', 'ftp://x', 'not a url', 'https://svc.internal/']) {
    assert.throws(() => w.validateUrl(bad), (e) => e.status === 400, bad);
  }
});

test('every documented event has a description', () => {
  assert.ok(w.EVENT_NAMES.length >= 9);
  for (const name of w.EVENT_NAMES) assert.ok(w.EVENTS[name].length > 10, name);
});
