// Run with:  node --test src/__tests__/
//
// Covers the follow-up sequence engine: the 3/7/14/30/60/90 nurture cadence,
// channel choice per lead (no text without consent), a step claimed by one scan
// can't run twice, DNC leads stop, and calls wait for local calling hours.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const src = (p) => path.join(__dirname, '..', p);
function stubModule(relPath, exportsObj) {
  const file = require.resolve(src(relPath));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exportsObj };
}

const S = {};
function reset({ claimOk = true, inHours = true } = {}) {
  Object.assign(S, { claimOk, inHours, updates: [], sms: [], emails: [], calls: [], logs: [] });
}
function builder(table) {
  const st = { op: 'select', payload: null, eqs: [] };
  const exec = () => {
    if (table === 'sequences' && st.op === 'update') {
      S.updates.push({ payload: st.payload, eqs: st.eqs });
      const isClaim = st.eqs.some(([k]) => k === 'next_action_at');
      if (isClaim) return { data: S.claimOk ? [{ id: 'seq-1' }] : [], error: null };
      return { data: [], error: null };
    }
    if (table === 'dnc_records') return { data: null, error: null };
    return { data: null, error: null };
  };
  const b = {
    select() { return b; }, limit() { return b; }, lte() { return b; },
    eq(k, v) { st.eqs.push([k, v]); return b; },
    maybeSingle() { return Promise.resolve(exec()); },
    single() { return Promise.resolve(exec()); },
    update(p) { st.op = 'update'; st.payload = p; return b; },
    insert(p) { st.op = 'insert'; st.payload = p; return b; },
    then(res, rej) { return Promise.resolve(exec()).then(res, rej); },
  };
  return b;
}
stubModule('config/supabase.js', { from: (t) => builder(t) });
stubModule('services/smsService.js', {
  sendSMSDirect: async (j) => { S.sms.push(j); return 'SM1'; },
  escalateToCall: async (lead) => { S.calls.push(lead.id); },
});
stubModule('services/emailService.js', {
  sendEmail: async (e) => { S.emails.push(e); return { success: true }; },
  templates: new Proxy({}, { get: () => () => ({ subject: 'Hi', body: 'Body' }) }),
});
stubModule('services/tcpaWindow.js', { isWithinTcpaWindow: () => S.inHours, msUntilNextWindow: () => 3600000 });
stubModule('services/emailSuppression.js', { mintOptOutToken: async () => 'tok' });
stubModule('services/voicemailService.js', { dropVoicemail: async () => {} });
stubModule('services/emailSpintax.js', { spin: (t) => t });
stubModule('services/emailSubjectAB.js', { chooseSubject: (tpl, vars, seed, subject) => ({ subject, variant: 'A' }) });
stubModule('services/aiCommandLog.js', { logAiCommand: async (e) => { S.logs.push(e); return { ok: true }; } });

const { SEQUENCE_DEFINITIONS, resolveStepAction, executeSequenceStep } = require('../services/sequenceEngine');

const lead = (over = {}) => ({ id: 'lead-1', first_name: 'Sam', phone: '+15125550000', email: 'sam@test.com', property_state: 'TX', consent: null, is_on_dnc: false, ...over });
const seq = (over = {}) => ({ id: 'seq-1', user_id: 'user-1', lead_id: 'lead-1', sequence_type: 'nurture', current_step: 0, next_action_at: '2026-09-17T10:00:00+00:00', status: 'active', leads: lead(), users: { ai_caller_name: 'Alex', company_name: 'Acme' }, ...over });

test('nurture touches on day 3, 7, 14, 30, 60 and 90; auto_sourced uses it', () => {
  assert.deepStrictEqual(SEQUENCE_DEFINITIONS.nurture.map(s => s.day), [3, 7, 14, 30, 60, 90]);
  assert.strictEqual(SEQUENCE_DEFINITIONS.auto_sourced, SEQUENCE_DEFINITIONS.nurture);
});

test('a text is chosen only with consent; otherwise email, then call', () => {
  const step = SEQUENCE_DEFINITIONS.nurture[0]; // sms, email, call
  assert.strictEqual(resolveStepAction(step, lead({ consent: true })), 'sms');
  assert.strictEqual(resolveStepAction(step, lead()), 'email');
  assert.strictEqual(resolveStepAction(step, lead({ email: null })), 'call');
  assert.strictEqual(resolveStepAction(step, lead({ email: null, phone: null })), null);
  assert.strictEqual(resolveStepAction({ action: 'sms', message: 'x' }, lead()), null);
});

test('a lead without consent gets the email, not a text', async () => {
  reset();
  await executeSequenceStep(seq());
  assert.strictEqual(S.sms.length, 0);
  assert.strictEqual(S.emails.length, 1);
  assert.strictEqual(S.emails[0].to, 'sam@test.com');
  const advance = S.updates.find(u => u.payload.current_step === 1);
  assert.ok(advance, 'sequence advances to step 2');
});

test('a step another scan already claimed does not run again', async () => {
  reset({ claimOk: false });
  await executeSequenceStep(seq({ leads: lead({ consent: true }) }));
  assert.strictEqual(S.sms.length + S.emails.length + S.calls.length, 0);
});

test('a lead on the DNC list stops the sequence without contact', async () => {
  reset();
  await executeSequenceStep(seq({ leads: lead({ is_on_dnc: true, consent: true }) }));
  assert.strictEqual(S.sms.length + S.emails.length + S.calls.length, 0);
  assert.ok(S.updates.some(u => u.payload.status === 'cancelled'));
});

test('a call step outside calling hours is deferred, not skipped', async () => {
  reset({ inHours: false });
  await executeSequenceStep(seq({ current_step: 1, leads: lead({ email: null }) })); // day 7: call first
  assert.strictEqual(S.calls.length, 0);
  assert.ok(!S.updates.some(u => u.payload.current_step === 2), 'does not advance');
  assert.ok(S.updates.some(u => u.payload.next_action_at && !u.eqs.some(([k]) => k === 'next_action_at')));
});

test('inside calling hours the call is placed and the step advances', async () => {
  reset();
  await executeSequenceStep(seq({ current_step: 1, leads: lead({ email: null }) }));
  assert.deepStrictEqual(S.calls, ['lead-1']);
  assert.ok(S.updates.some(u => u.payload.current_step === 2));
});
