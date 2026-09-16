// Run with:  node --test src/__tests__/
//
// Dropbox Sign: off without a key; with a key, contracts go out through Dropbox
// Sign (no Veori signing links handed out), callbacks are verified with the
// event hash, and a fully-signed event marks the contract once.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const crypto = require('node:crypto');

const src = (p) => path.join(__dirname, '..', p);
function stubModule(relPath, exportsObj) {
  const file = require.resolve(src(relPath));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exportsObj };
}

const S = { contract: null, signers: [], updates: [], sent: [], emails: [], activity: [], stage: [] };
function builder(table) {
  const st = { op: 'select', payload: null, eqs: [], neqs: [] };
  const exec = () => {
    if (table === 'contracts') {
      if (st.op === 'select') return { data: S.contract, error: null };
      if (st.op === 'insert' || st.op === 'update') {
        S.updates.push({ table, payload: st.payload, neqs: st.neqs });
        if (st.neqs.some(([k, v]) => k === 'signing_status' && S.contract?.signing_status === v)) return { data: [], error: null };
        S.contract = { ...(S.contract || { id: 'c1', contract_type: 'psa', content: 'TEXT' }), ...st.payload };
        return { data: st.op === 'update' && st.neqs.length ? [S.contract] : S.contract, error: null };
      }
    }
    if (table === 'contract_signers') {
      if (st.op === 'delete') { S.signers = []; return { data: null, error: null }; }
      if (st.op === 'insert') { S.signers = st.payload.map(x => ({ ...x })); return { data: S.signers, error: null }; }
      if (st.op === 'update') {
        S.updates.push({ table, payload: st.payload, eqs: st.eqs });
        const sigId = st.eqs.find(([k]) => k === 'provider_signature_id');
        if (sigId) {
          const row = S.signers.find(r => r.provider_signature_id === sigId[1] && r.status !== 'signed');
          if (!row) return { data: [], error: null };
          Object.assign(row, st.payload); return { data: [row], error: null };
        }
        const id = st.eqs.find(([k]) => k === 'id');
        if (id) Object.assign(S.signers.find(r => r.id === id[1]) || {}, st.payload);
        return { data: null, error: null };
      }
      return { data: S.signers, error: null };
    }
    if (table === 'users') return { data: { email: 'op@test.com', full_name: 'Olive Operator' }, error: null };
    if (table === 'deals') return { data: st.op === 'select' ? { id: 'deal-1', user_id: 'user-1', status: 'negotiating', property_address: '12 Oak St' } : null, error: null };
    return { data: null, error: null };
  };
  const b = {
    select() { return b; }, limit() { return b; }, in() { return b; },
    eq(k, v) { st.eqs.push([k, v]); return b; }, neq(k, v) { st.neqs.push([k, v]); return b; },
    maybeSingle() { return Promise.resolve(exec()); }, single() { return Promise.resolve(exec()); },
    insert(p) { st.op = 'insert'; st.payload = p; return b; }, update(p) { st.op = 'update'; st.payload = p; return b; },
    delete() { st.op = 'delete'; return b; },
    then(res, rej) { return Promise.resolve(exec()).then(res, rej); },
  };
  return b;
}
stubModule('config/supabase.js', { from: (t) => builder(t) });
stubModule('services/emailService.js', { sendEmail: async (e) => { S.emails.push(e); return { success: true }; } });
stubModule('services/smsService.js', { sendSMS: async () => 'SM1' });
stubModule('services/dealActivityService.js', { logActivity: async (a) => { S.activity.push(a); } });
stubModule('services/webhookService.js', { emitEvent: () => 0 });
stubModule('services/dealStageService.js', {
  STAGE_KEYS: ['lead', 'contacted', 'offer_sent', 'negotiating', 'under_contract', 'sent_to_title', 'closing_prep', 'closed', 'lost'],
  changeDealStage: async (a) => { S.stage.push(a.stage); return { changed: true }; },
});
let dropboxEnabled = false;
stubModule('services/dropboxSignService.js', {
  isEnabled: () => dropboxEnabled,
  sendSignatureRequest: async (req) => {
    S.sent.push(req);
    return { requestId: 'sr_123', signatures: req.signers.map((s, i) => ({ signature_id: `sig_${i}`, signer_email_address: s.email, order: i })) };
  },
  verifyEvent: () => true,
});

const contractService = require('../services/contractService');
const deal = { id: 'deal-1', user_id: 'user-1', property_address: '12 Oak St', leads: { first_name: 'Sam', email: 'sam@test.com' } };

function reset() {
  Object.assign(S, { contract: null, signers: [], updates: [], sent: [], emails: [], activity: [], stage: [] });
}

test('without a Dropbox Sign key, contracts use Veori signing links', async () => {
  reset(); dropboxEnabled = false;
  const out = await contractService.send(deal, 'psa', { userId: 'user-1', sms: false });
  assert.strictEqual(out.provider, 'builtin');
  assert.ok(out.signing_url);
  assert.strictEqual(S.sent.length, 0);
});

test('with a key, the request goes to Dropbox Sign: seller first, no Veori links handed out', async () => {
  reset(); dropboxEnabled = true;
  const out = await contractService.send(deal, 'psa', { userId: 'user-1' });
  assert.strictEqual(out.provider, 'dropbox_sign');
  assert.strictEqual(out.signing_url, null);
  assert.strictEqual(out.operator_signing_url, null);
  assert.strictEqual(S.sent.length, 1);
  assert.deepStrictEqual(S.sent[0].signers.map(s => s.email), ['sam@test.com', 'op@test.com']);
  assert.ok(Buffer.isBuffer(S.sent[0].pdf) && S.sent[0].pdf.slice(0, 4).toString() === '%PDF');
  assert.strictEqual(S.contract.provider_request_id, 'sr_123');
  assert.strictEqual(S.emails.length, 0, 'Dropbox Sign emails the signers; Veori does not send links');
  assert.strictEqual(out.status, 'sent');
});

test('a signer without email falls back to Veori links and records why', async () => {
  reset(); dropboxEnabled = true;
  const out = await contractService.send({ ...deal, leads: { first_name: 'Sam' } }, 'psa', { userId: 'user-1', sms: false });
  assert.strictEqual(out.provider, 'builtin');
  assert.match(out.deliveries.find(d => d.channel === 'dropbox_sign').detail, /needs an email/);
});

test('all-signed callback marks the contract once and moves the deal under contract', async () => {
  reset(); dropboxEnabled = true;
  S.contract = { id: 'c1', deal_id: 'deal-1', user_id: 'user-1', contract_type: 'psa', signing_status: 'sent', provider_request_id: 'sr_123' };
  S.signers = [
    { id: 's1', contract_id: 'c1', signer_role: 'seller', name: 'Sam', provider_signature_id: 'sig_0', status: 'pending' },
    { id: 's2', contract_id: 'c1', signer_role: 'buyer', name: 'Olive', provider_signature_id: 'sig_1', status: 'pending' },
  ];
  const sigs = [{ signature_id: 'sig_0', status_code: 'signed', signed_at: 1700000000 }, { signature_id: 'sig_1', status_code: 'signed', signed_at: 1700000100 }];
  await contractService.applyProviderEvent({ requestId: 'sr_123', eventType: 'signature_request_all_signed', signatures: sigs });
  assert.ok(S.signers.every(s => s.status === 'signed'));
  assert.strictEqual(S.contract.signing_status, 'fully_signed');
  assert.deepStrictEqual(S.stage, ['under_contract']);

  await contractService.applyProviderEvent({ requestId: 'sr_123', eventType: 'signature_request_all_signed', signatures: sigs });
  assert.deepStrictEqual(S.stage, ['under_contract'], 'a repeated callback does not run twice');
});

test('Veori signing page refuses a contract that is on Dropbox Sign', async () => {
  reset();
  S.signers = [];
  const file = require.resolve(src('config/supabase.js'));
  const original = require.cache[file].exports.from;
  require.cache[file].exports.from = (t) => {
    if (t === 'contract_signers') {
      const b = { select() { return b; }, eq() { return b; }, maybeSingle: async () => ({ data: { id: 's1', status: 'pending', contracts: { provider: 'dropbox_sign' } }, error: null }), update() { return b; }, then: (r) => Promise.resolve({ error: null }).then(r) };
      return b;
    }
    return original(t);
  };
  await assert.rejects(contractService.submitSignature('00000000-0000-4000-8000-000000000000', { printedName: 'X', signatureText: 'X' }),
    (e) => e.status === 409);
  require.cache[file].exports.from = original;
});

test('callback event hash is HMAC-SHA256(api key, event_time + event_type)', () => {
  const real = require.cache[require.resolve(src('services/dropboxSignService.js'))];
  delete require.cache[require.resolve(src('services/dropboxSignService.js'))];
  process.env.DROPBOX_SIGN_API_KEY = 'test_key';
  const dbs = require('../services/dropboxSignService');
  const good = { event: { event_time: '1700000000', event_type: 'signature_request_signed', event_hash: crypto.createHmac('sha256', 'test_key').update('1700000000signature_request_signed').digest('hex') } };
  assert.strictEqual(dbs.verifyEvent(good), true);
  assert.strictEqual(dbs.verifyEvent({ event: { ...good.event, event_hash: 'x'.repeat(64) } }), false);
  delete process.env.DROPBOX_SIGN_API_KEY;
  assert.strictEqual(dbs.verifyEvent(good), false, 'no key configured -> nothing verifies');
  require.cache[require.resolve(src('services/dropboxSignService.js'))] = real;
});
