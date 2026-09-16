// Run with:  node --test src/__tests__/
//
// Covers the outreach compliance gates:
//   • sendOpeningSMS sends nothing without consent, defers outside quiet hours,
//     and stops on an internal DNC hit - before any credit is reserved.
//   • a spoken "stop calling me" on an AI call is written to dnc_records and
//     flags the lead; "not interested" ends the call but records nothing.
//
// No network and no database: supabase, the TCPA clock, the queue and the credit
// meter are replaced in the require cache before the modules under test load.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

process.env.TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || `AC${'0'.repeat(32)}`;
process.env.TWILIO_AUTH_TOKEN  = process.env.TWILIO_AUTH_TOKEN  || 'test-token';
delete process.env.FTC_DNC_API_KEY;

const src = (p) => path.join(__dirname, '..', p);
function stubModule(relPath, exportsObj) {
  const file = require.resolve(src(relPath));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exportsObj };
}

// ─── Fake supabase: records writes, answers reads from a per-table table ──────
const db = { writes: [], rows: {} };
function builder(table) {
  const state = { table, op: 'select', payload: null };
  const result = () => {
    if (state.op === 'select') {
      const rows = db.rows[table] || [];
      return { data: state.single ? (rows[0] || null) : rows, error: null };
    }
    db.writes.push({ table, op: state.op, payload: state.payload });
    return { data: null, error: null };
  };
  const b = {
    select() { return b; }, eq() { return b; }, is() { return b; }, in() { return b; },
    limit() { return b; }, order() { return b; },
    maybeSingle() { state.single = true; return Promise.resolve(result()); },
    single() { state.single = true; return Promise.resolve(result()); },
    insert(p) { state.op = 'insert'; state.payload = p; return b; },
    update(p) { state.op = 'update'; state.payload = p; return b; },
    then(res, rej) { return Promise.resolve(result()).then(res, rej); },
  };
  return b;
}
stubModule('config/supabase.js', { from: (t) => builder(t) });

let withinWindow = true;
stubModule('services/tcpaWindow.js', {
  isWithinTcpaWindow: () => withinWindow,
  msUntilNextWindow: () => (withinWindow ? 0 : 3 * 3600 * 1000),
  tcpaLocalHour: () => 12,
  tzForState: () => 'America/New_York',
});

const enqueued = [];
stubModule('services/queueService.js', {
  enqueueSMS: async (job) => { enqueued.push(job); return 'job-1'; },
});

let creditReservations = 0;
stubModule('services/outreachCredits.js', {
  reserve: async () => { creditReservations += 1; return { allowed: false, reason: 'test' }; },
});

const { sendOpeningSMS } = require('../services/smsService');
const voiceBrain = require('../services/voiceBrainService');

function reset() {
  db.writes = []; db.rows = {}; enqueued.length = 0; creditReservations = 0; withinWindow = true;
}
const tcpaActions = () => db.writes.filter(w => w.table === 'tcpa_log').map(w => w.payload.action);
const flush = () => new Promise(r => setTimeout(r, 20));

const baseLead = { id: 'lead-1', phone: '+17045550000', property_state: 'NC', first_name: 'Sam', is_on_dnc: false };

// ─── Opening SMS ──────────────────────────────────────────────────────────────

test('opening SMS is not sent when the lead has no consent on record', async () => {
  reset();
  const out = await sendOpeningSMS({ ...baseLead, consent: null }, 'user-1');
  assert.strictEqual(out, null);
  assert.deepStrictEqual(tcpaActions(), ['sms_blocked_no_consent']);
  assert.strictEqual(enqueued.length, 0);
  assert.strictEqual(creditReservations, 0);
});

test('opening SMS outside calling hours is queued for the next window, not sent', async () => {
  reset();
  withinWindow = false;
  const out = await sendOpeningSMS({ ...baseLead, consent: true }, 'user-1');
  assert.strictEqual(out, null);
  assert.strictEqual(enqueued.length, 1);
  assert.strictEqual(enqueued[0].to, baseLead.phone);
  assert.ok(enqueued[0].delay > 0);
  assert.match(enqueued[0].jobIdSuffix, /^-opening-qh-\d{4}-\d{2}-\d{2}$/);
  assert.deepStrictEqual(tcpaActions(), ['sms_deferred_quiet_hours']);
  assert.strictEqual(creditReservations, 0);
});

test('opening SMS to a number on the internal DNC list is blocked before credits', async () => {
  reset();
  db.rows.dnc_records = [{ id: 'dnc-1' }];
  const out = await sendOpeningSMS({ ...baseLead, consent: true }, 'user-1');
  assert.strictEqual(out, null);
  assert.deepStrictEqual(tcpaActions(), ['sms_blocked_compliance']);
  assert.strictEqual(enqueued.length, 0);
  assert.strictEqual(creditReservations, 0);
});

test('opening SMS with consent, inside hours and not on DNC reaches the credit gate', async () => {
  reset();
  const out = await sendOpeningSMS({ ...baseLead, consent: true }, 'user-1');
  assert.strictEqual(out, null); // the stubbed meter refuses, so nothing is sent
  assert.strictEqual(creditReservations, 1);
});

// ─── Spoken opt-out on a call ─────────────────────────────────────────────────

test('"stop calling me" on a call records DNC and flags the lead', async () => {
  reset();
  const turn = await voiceBrain.nextTurn({
    callId: 'call-1', speech: 'Please stop calling me.',
    call: { user_id: 'user-1' }, lead: { ...baseLead }, operator: {},
  });
  await flush();
  assert.strictEqual(turn.end, true);
  const dncInsert = db.writes.find(w => w.table === 'dnc_records' && w.op === 'insert');
  assert.ok(dncInsert, 'dnc_records insert expected');
  assert.strictEqual(dncInsert.payload.phone, baseLead.phone);
  assert.strictEqual(dncInsert.payload.user_id, 'user-1');
  assert.strictEqual(dncInsert.payload.source, 'voice_request');
  const leadUpdate = db.writes.find(w => w.table === 'leads' && w.op === 'update');
  assert.strictEqual(leadUpdate?.payload.is_on_dnc, true);
  assert.ok(tcpaActions().includes('voice_request_opt_out'));
});

test('"not interested" ends the call but does not add the number to DNC', async () => {
  reset();
  const turn = await voiceBrain.nextTurn({
    callId: 'call-2', speech: "I'm not interested.",
    call: { user_id: 'user-1' }, lead: { ...baseLead }, operator: {},
  });
  await flush();
  assert.strictEqual(turn.end, true);
  assert.strictEqual(db.writes.some(w => w.table === 'dnc_records'), false);
});

test('an already-listed number is not inserted twice', async () => {
  reset();
  db.rows.dnc_records = [{ id: 'dnc-1' }];
  await voiceBrain.nextTurn({
    callId: 'call-3', speech: 'take me off your list',
    call: { user_id: 'user-1' }, lead: { ...baseLead }, operator: {},
  });
  await flush();
  assert.strictEqual(db.writes.some(w => w.table === 'dnc_records' && w.op === 'insert'), false);
  assert.strictEqual(db.writes.find(w => w.table === 'leads')?.payload.is_on_dnc, true);
});

test('objecting to the recording ends the call and does not add the number to DNC', async () => {
  reset();
  const turn = await voiceBrain.nextTurn({
    callId: 'call-4', speech: "I don't want to be recorded",
    call: { user_id: 'user-1' }, lead: { ...baseLead }, operator: {},
  });
  await flush();
  assert.strictEqual(turn.end, true);
  assert.match(turn.reply, /recorded line/);
  assert.strictEqual(db.writes.some(w => w.table === 'dnc_records'), false);
});
