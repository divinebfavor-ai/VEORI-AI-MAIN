// Run with:  node --test src/__tests__/
//
// Covers contract delivery: each signer gets their OWN link, the operator's link
// never goes to the other party, nothing is reported sent unless a provider
// accepted it, and a contract someone already signed can't be re-sent (which
// would erase the signature).

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

process.env.FRONTEND_URL = 'https://app.test';
const src = (p) => path.join(__dirname, '..', p);
function stubModule(relPath, exportsObj) {
  const file = require.resolve(src(relPath));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exportsObj };
}

const state = {};
function reset({ prior = null, operator = {} } = {}) {
  state.prior = prior;
  state.operator = { email: 'op@test.com', full_name: 'Olive Operator', company_name: 'Olive Homes', ...operator };
  state.signers = [];
  state.emails = [];
  state.sms = [];
  state.gateAllowed = true;
  state.emailResult = { success: true, messageId: 'm1' };
}

function builder(table) {
  const st = { op: 'select', payload: null, filters: {} };
  const exec = () => {
    if (table === 'contracts') {
      if (st.op === 'select') return { data: state.prior, error: null };
      const row = { id: 'contract-1', contract_type: st.payload.contract_type || 'psa', ...st.payload };
      state.contract = { ...(state.contract || {}), ...row };
      return { data: state.contract, error: null };
    }
    if (table === 'users') return { data: state.operator, error: null };
    if (table === 'contract_signers') {
      if (st.op === 'delete') { state.signers = []; return { data: null, error: null }; }
      if (st.op === 'insert') { state.signers = st.payload; return { data: st.payload, error: null }; }
    }
    return { data: null, error: null };
  };
  const b = {
    select() { return b; }, eq() { return b; },
    maybeSingle() { return Promise.resolve(exec()); },
    single() { return Promise.resolve(exec()); },
    insert(p) { st.op = 'insert'; st.payload = p; return b; },
    update(p) { st.op = 'update'; st.payload = p; return b; },
    delete() { st.op = 'delete'; return b; },
    then(res, rej) { return Promise.resolve(exec()).then(res, rej); },
  };
  return b;
}
stubModule('config/supabase.js', { from: (t) => builder(t) });
stubModule('services/emailService.js', {
  sendEmail: async (e) => { state.emails.push(e); return state.emailResult; },
});
stubModule('services/smsService.js', {
  sendSMS: async (to, text) => { state.sms.push({ to, text }); return 'SM1'; },
});
stubModule('agents/complianceGate.js', {
  complianceGate: async () => (state.gateAllowed
    ? { allowed: true, hardStops: [] }
    : { allowed: false, hardStops: [{ code: 'TCPA_QUIET_HOURS' }] }),
});

const contractService = require('../services/contractService');

const deal = {
  id: 'deal-1', user_id: 'user-1', lead_id: 'lead-1',
  property_address: '12 Oak St', property_city: 'Austin', property_state: 'TX',
  offer_price: 150000, arv: 250000,
  leads: { first_name: 'Sam', last_name: 'Seller', email: 'sam@test.com', phone: '+15125550000' },
};
const tokenOf = (url) => url.split('/sign/')[1];

test('each signer is emailed their own link; the public link is the seller\'s', async () => {
  reset();
  const out = await contractService.send(deal, 'psa', { userId: 'user-1' });

  const seller = state.signers.find(s => s.signer_role === 'seller');
  const operator = state.signers.find(s => s.signer_role === 'buyer');
  assert.ok(seller && operator);
  assert.notStrictEqual(seller.access_token, operator.access_token);
  assert.strictEqual(operator.email, 'op@test.com');

  assert.strictEqual(tokenOf(out.signing_url), seller.access_token);
  assert.strictEqual(tokenOf(out.operator_signing_url), operator.access_token);

  const toSeller = state.emails.find(e => e.to === 'sam@test.com');
  const toOperator = state.emails.find(e => e.to === 'op@test.com');
  assert.ok(toSeller.body.includes(seller.access_token));
  assert.ok(!toSeller.body.includes(operator.access_token), 'seller must never get the operator link');
  assert.ok(toOperator.body.includes(operator.access_token));
  assert.ok(!toOperator.body.includes(seller.access_token));

  assert.strictEqual(state.sms.length, 1);
  assert.ok(state.sms[0].text.includes(seller.access_token));
  assert.strictEqual(out.status, 'sent');
});

test('the buyer on an assignment gets the buyer link, not the assignor link', async () => {
  reset();
  const out = await contractService.send(
    { ...deal, buyers: { name: 'Bea Buyer', email: 'bea@test.com', phone: '+15125551111' } },
    'assignment', { userId: 'user-1', sms: false },
  );
  const buyer = state.signers.find(s => s.signer_role === 'buyer');
  const assignor = state.signers.find(s => s.signer_role === 'assignor');
  assert.strictEqual(tokenOf(out.signing_url), buyer.access_token);
  const toBuyer = state.emails.find(e => e.to === 'bea@test.com');
  assert.ok(toBuyer.body.includes(buyer.access_token));
  assert.ok(!toBuyer.body.includes(assignor.access_token));
  assert.strictEqual(state.sms.length, 0, 'sms:false sends no text');
});

test('with no email provider the result says simulated, not sent', async () => {
  reset();
  state.emailResult = { success: true, simulated: true };
  state.gateAllowed = false; // text blocked by quiet hours
  const out = await contractService.send(deal, 'psa', { userId: 'user-1' });
  assert.strictEqual(out.status, 'created_not_delivered');
  const sellerEmail = out.deliveries.find(d => d.role === 'seller' && d.channel === 'email');
  const sellerSms = out.deliveries.find(d => d.role === 'seller' && d.channel === 'sms');
  assert.strictEqual(sellerEmail.status, 'simulated');
  assert.strictEqual(sellerSms.status, 'skipped');
  assert.strictEqual(state.sms.length, 0);
});

test('a seller with no email or phone is reported as not reached', async () => {
  reset();
  const out = await contractService.send({ ...deal, leads: { first_name: 'Sam' } }, 'psa', { userId: 'user-1' });
  assert.strictEqual(out.status, 'created_not_delivered');
  assert.strictEqual(out.deliveries.find(d => d.role === 'seller').detail, 'no email address on file');
});

test('a contract someone already signed cannot be re-sent', async () => {
  reset({ prior: { id: 'contract-1', signing_status: 'partially_signed' } });
  await assert.rejects(
    contractService.send(deal, 'psa', { userId: 'user-1' }),
    (e) => e instanceof contractService.ContractError && e.status === 409,
  );
  assert.strictEqual(state.emails.length, 0);
});
