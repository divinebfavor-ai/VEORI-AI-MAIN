// Run with:  node --test src/__tests__/
//
// The visitor's IP: Vercel-proxied requests use x-vercel-forwarded-for, direct
// requests use Express's proxy-resolved req.ip, and junk values are ignored.

const test = require('node:test');
const assert = require('node:assert');
const { clientIp, clientKeyIp } = require('../utils/clientIp');

const req = (headers, ip) => ({ headers, ip });

test('through Vercel the visitor comes from x-vercel-forwarded-for', () => {
  assert.strictEqual(clientIp(req({ 'x-vercel-id': 'cpt1::abc', 'x-vercel-forwarded-for': '102.88.166.10' }, '13.244.67.1')), '102.88.166.10');
});

test('without the Vercel marker the header is ignored', () => {
  assert.strictEqual(clientIp(req({ 'x-vercel-forwarded-for': '1.2.3.4' }, '102.88.166.10')), '102.88.166.10');
});

test('mapped IPv6 is normalised; junk falls back, then to null', () => {
  assert.strictEqual(clientIp(req({}, '::ffff:102.88.166.10')), '102.88.166.10');
  assert.strictEqual(clientIp(req({ 'x-vercel-id': 'x', 'x-vercel-forwarded-for': 'not-an-ip' }, '102.88.166.10')), '102.88.166.10');
  assert.strictEqual(clientIp(req({}, undefined)), null);
  assert.strictEqual(clientKeyIp(req({}, undefined)), 'unknown');
});
