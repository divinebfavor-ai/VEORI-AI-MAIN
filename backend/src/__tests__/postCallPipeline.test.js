// Run with:  node --test src/__tests__/
//
// Covers postCallPipeline.runPostCallActions - what happens after a call on
// either voice engine: runs exactly once per call, creates the right deal,
// schedules the callback the seller asked for, respects DNC, and keeps going
// when one step fails.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

process.env.FRONTEND_URL = 'https://app.test';
delete process.env.CONTRACT_AUTO_AFTER_CALL;
const src = (p) => path.join(__dirname, '..', p);
function stubModule(relPath, exportsObj) {
  const file = require.resolve(src(relPath));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exportsObj };
}

const S = {};
function reset({ claimed = false, lead = {}, existingDeal = false, dnc = false } = {}) {
  Object.assign(S, {
    claimed, existingDeal, dnc,
    lead: { id: 'lead-1', user_id: 'user-1', first_name: 'Sam', last_name: 'Seller', phone: '+15125550000', email: 'sam@test.com', property_address: '12 Oak St', property_state: 'TX', has_photos: true, ...lead },
    inserts: [], rpc: [], calls: { enroll: [], memory: 0, schedule: [], missed: 0, log: [] },
    enrollThrows: false,
  });
}

function builder(table) {
  const st = { op: 'select', payload: null, isNull: false };
  const exec = () => {
    if (table === 'calls' && st.op === 'update') {
      if (S.claimed) return { data: [], error: null };
      S.claimed = true;
      return { data: [{ id: 'call-1' }], error: null };
    }
    if (st.op === 'insert') {
      S.inserts.push({ table, payload: st.payload });
      return { data: { id: `${table}-new`, ...st.payload }, error: null };
    }
    if (st.op === 'update') return { data: null, error: null };
    if (table === 'leads') return { data: S.lead, error: null };
    if (table === 'deals') return { data: S.existingDeal ? [{ id: 'deal-old' }] : [], error: null };
    if (table === 'dnc_records') return { data: S.dnc ? [{ id: 'd' }] : [], error: null };
    if (table === 'photo_upload_tokens') return { data: null, error: null, count: 0 };
    return { data: null, error: null };
  };
  const b = {
    select() { return b; }, eq() { return b; }, is() { return b; }, gte() { return b; }, limit() { return b; },
    maybeSingle() { return Promise.resolve(exec()); },
    single() { return Promise.resolve(exec()); },
    insert(p) { st.op = 'insert'; st.payload = p; return b; },
    update(p) { st.op = 'update'; st.payload = p; return b; },
    then(res, rej) { return Promise.resolve(exec()).then(res, rej); },
  };
  return b;
}
stubModule('config/supabase.js', {
  from: (t) => builder(t),
  rpc: async (name, args) => { S.rpc.push({ name, args }); return { error: null }; },
});
stubModule('services/sequenceEngine.js', {
  enrollLeadInSequence: async (u, l, type) => { if (S.enrollThrows) throw new Error('boom'); S.calls.enroll.push(type); return { id: 'seq' }; },
});
stubModule('services/dataMotService.js', { recordCallIntelligence: async () => { S.calls.memory += 1; } });
stubModule('services/dualAIService.js', {
  parseCallTime: async () => ({ requested_time: new Date(Date.now() + 5 * 3600000).toISOString(), timezone: 'America/Chicago', confidence: 0.9 }),
});
stubModule('services/queueService.js', { scheduleVapiCall: async (j) => { S.calls.schedule.push(j); return 'job-1'; } });
stubModule('services/missedCallService.js', { handleMissedCall: async () => { S.calls.missed += 1; } });
stubModule('services/directMailService.js', { checkAutoMailTrigger: async () => false, sendPostcard: async () => {} });
stubModule('services/dealActivityService.js', { logActivity: async () => ({}) });
stubModule('services/aiCommandLog.js', { logAiCommand: async (e) => { S.calls.log.push(e); return { ok: true }; } });

const { runPostCallActions } = require('../services/postCallPipeline');
const callRec = { id: 'call-1', user_id: 'user-1', lead_id: 'lead-1', campaign_id: 'camp-1', duration_seconds: 240, transcript: 'Seller: yes, let us do it' };
const inserted = (t) => S.inserts.filter(i => i.table === t).map(i => i.payload);

test('a verbal yes creates one deal at negotiating (not under contract) and records memory', async () => {
  reset();
  const out = await runPostCallActions({ callRec, outcome: 'verbal_yes', aiAnalysis: { motivation_score: 88 } });
  assert.strictEqual(out.ran, true);
  const deals = inserted('deals');
  assert.strictEqual(deals.length, 1);
  assert.strictEqual(deals[0].status, 'negotiating');
  assert.strictEqual(deals[0].lead_id, 'lead-1');
  assert.strictEqual(S.calls.memory, 1);
  assert.deepStrictEqual(S.rpc.map(r => r.name), ['increment_campaign_stats']);
  assert.strictEqual(S.rpc[0].args.p_answered, 1);
});

test('the second run for the same call does nothing', async () => {
  reset({ claimed: true });
  const out = await runPostCallActions({ callRec, outcome: 'verbal_yes', aiAnalysis: { motivation_score: 88 } });
  assert.strictEqual(out.ran, false);
  assert.strictEqual(S.inserts.length, 0);
  assert.strictEqual(S.calls.memory, 0);
});

test('an appointment books the appointment and the AI callback at the requested time', async () => {
  reset();
  await runPostCallActions({ callRec, outcome: 'appointment', aiAnalysis: { motivation_score: 70, ai_summary: 'Wants to meet' } });
  assert.strictEqual(inserted('deals')[0].status, 'contacted');
  const appt = inserted('appointments')[0];
  const fu = inserted('follow_ups')[0];
  assert.ok(appt && fu);
  assert.strictEqual(appt.scheduled_at, fu.next_follow_up_at);
  assert.ok(new Date(fu.next_follow_up_at) > new Date());
  assert.strictEqual(S.calls.schedule.length, 1);
  assert.strictEqual(S.calls.schedule[0].leadId, 'lead-1');
  assert.deepStrictEqual(S.calls.enroll, ['callback_requested']);
});

test('no second deal when the lead already has one', async () => {
  reset({ existingDeal: true });
  const out = await runPostCallActions({ callRec, outcome: 'verbal_yes', aiAnalysis: {} });
  assert.strictEqual(inserted('deals').length, 0);
  assert.match(out.results.find(r => r.step === 'deal').detail, /already exists/);
});

test('a lead on the DNC list is not enrolled in a follow-up sequence', async () => {
  reset({ dnc: true });
  await runPostCallActions({ callRec, outcome: 'not_interested', aiAnalysis: {} });
  assert.deepStrictEqual(S.calls.enroll, []);
});

test('a no-answer triggers the missed-call step and no deal', async () => {
  reset();
  await runPostCallActions({ callRec: { ...callRec, transcript: null, duration_seconds: 0 }, outcome: 'no_answer', aiAnalysis: {} });
  assert.strictEqual(S.calls.missed, 1);
  assert.strictEqual(inserted('deals').length, 0);
  assert.strictEqual(S.rpc[0].args.p_answered, 0);
});

test('one failing step is reported and the rest still run', async () => {
  reset();
  S.enrollThrows = true;
  const out = await runPostCallActions({ callRec, outcome: 'offer_made', aiAnalysis: { motivation_score: 60 } });
  assert.strictEqual(out.results.find(r => r.step === 'sequence').status, 'failed');
  assert.strictEqual(S.calls.memory, 1);
  assert.strictEqual(S.calls.log[0].status, 'partial');
});
