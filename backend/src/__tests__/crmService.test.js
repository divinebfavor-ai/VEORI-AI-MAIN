// Run with:  node --test src/__tests__/
//
// CRM connectors: HubSpot create / update / email-conflict paths, the Follow Up Boss
// event payload and headers, and that a key is tested and encrypted before it is saved.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const src = (p) => path.join(__dirname, '..', p);
const saved = [];
const file = require.resolve(src('config/supabase.js'));
require.cache[file] = { id: file, filename: file, loaded: true, exports: {
  from: () => {
    const b = {
      upsert(row) { saved.push(row); return b; }, select() { return b; },
      single() { return Promise.resolve({ data: { ...saved[saved.length - 1], created_at: 'now' }, error: null }); },
    };
    return b;
  },
} };

const crm = require('../services/crmService');
const calls = [];
function fakeHttp(responses) {
  const next = (method, url, body, cfg) => {
    calls.push({ method, url, body, cfg });
    const r = responses.shift();
    if (!r) throw new Error('unexpected call ' + method + ' ' + url);
    if (r.status >= 400) { const e = new Error('http ' + r.status); e.response = { status: r.status, data: r.data }; return Promise.reject(e); }
    return Promise.resolve(r);
  };
  return {
    get: (url, cfg) => next('GET', url, null, cfg),
    post: (url, body, cfg) => next('POST', url, body, cfg),
    patch: (url, body, cfg) => next('PATCH', url, body, cfg),
  };
}
const lead = { id: 'l1', first_name: 'Sam', last_name: 'Seller', phone: '+15125550100', email: 'sam@example.com', property_address: '1 Oak St', property_city: 'Austin', property_state: 'TX', property_zip: '78701', primary_tag: 'probate' };

test('HubSpot: new contact is created with standard properties and a Bearer token', async () => {
  calls.length = 0;
  crm._setHttp(fakeHttp([{ status: 201, data: { id: '901' } }]));
  const id = await crm.PROVIDERS.hubspot.pushLead('pat-token', lead, null);
  assert.strictEqual(id, '901');
  assert.strictEqual(calls[0].url, 'https://api.hubapi.com/crm/v3/objects/contacts');
  assert.strictEqual(calls[0].cfg.headers.Authorization, 'Bearer pat-token');
  assert.deepStrictEqual(calls[0].body.properties, { firstname: 'Sam', lastname: 'Seller', email: 'sam@example.com', phone: '+15125550100', address: '1 Oak St', city: 'Austin', state: 'TX', zip: '78701' });
});

test('HubSpot: a linked contact is updated; an email conflict updates the existing contact', async () => {
  calls.length = 0;
  crm._setHttp(fakeHttp([{ status: 200, data: {} }]));
  assert.strictEqual(await crm.PROVIDERS.hubspot.pushLead('t', lead, '901'), '901');
  assert.strictEqual(calls[0].method, 'PATCH');

  calls.length = 0;
  crm._setHttp(fakeHttp([{ status: 409 }, { status: 200, data: { results: [{ id: '777' }] } }, { status: 200, data: {} }]));
  assert.strictEqual(await crm.PROVIDERS.hubspot.pushLead('t', lead, null), '777');
  assert.deepStrictEqual(calls.map(c => c.method), ['POST', 'POST', 'PATCH']);
  assert.match(calls[1].url, /contacts\/search$/);
  assert.match(calls[2].url, /contacts\/777$/);
});

test('Follow Up Boss: Seller Inquiry event with Basic auth and system headers', async () => {
  process.env.FUB_SYSTEM_NAME = 'Veori'; process.env.FUB_SYSTEM_KEY = 'sys-key';
  calls.length = 0;
  crm._setHttp(fakeHttp([{ status: 201, data: {} }]));
  await crm.PROVIDERS.followupboss.pushLead('fub-key', lead);
  const c = calls[0];
  assert.strictEqual(c.url, 'https://api.followupboss.com/v1/events');
  assert.deepStrictEqual(c.cfg.auth, { username: 'fub-key', password: '' });
  assert.strictEqual(c.cfg.headers['X-System'], 'Veori');
  assert.strictEqual(c.cfg.headers['X-System-Key'], 'sys-key');
  assert.strictEqual(c.body.type, 'Seller Inquiry');
  assert.deepStrictEqual(c.body.person.phones, [{ value: '+15125550100' }]);
  assert.deepStrictEqual(c.body.person.tags, ['Veori', 'probate']);

  crm._setHttp(fakeHttp([{ status: 204 }]));
  await assert.rejects(crm.PROVIDERS.followupboss.pushLead('fub-key', lead), /archived/);
  delete process.env.FUB_SYSTEM_NAME; delete process.env.FUB_SYSTEM_KEY;
  assert.strictEqual(crm.PROVIDERS.followupboss.available(), false);
});

test('connect: needs encryption, rejects a bad key, stores only ciphertext', async () => {
  delete process.env.PII_ENCRYPTION_KEY;
  await assert.rejects(crm.connect('u1', 'hubspot', 'pat-na1-abcdefgh'), (e) => e.status === 503);

  process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64);
  crm._setHttp(fakeHttp([{ status: 401 }]));
  await assert.rejects(crm.connect('u1', 'hubspot', 'pat-na1-abcdefgh'), (e) => e.status === 400 && /rejected/.test(e.message));

  saved.length = 0;
  crm._setHttp(fakeHttp([{ status: 200, data: { results: [] } }]));
  const conn = await crm.connect('u1', 'hubspot', 'pat-na1-abcdefgh');
  assert.strictEqual(conn.credential_hint, '…efgh');
  assert.ok(saved[0].credential_encrypted.startsWith('v1:'));
  assert.ok(!saved[0].credential_encrypted.includes('pat-na1'));
  assert.ok(!('credential_encrypted' in conn));
  delete process.env.PII_ENCRYPTION_KEY;
});
