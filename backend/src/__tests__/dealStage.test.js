// Run with:  node --test src/__tests__/
//
// Covers dealStageService.changeDealStage - the single path for deal stage moves:
// validation, ownership, idempotency (no double buyer outreach), and that each
// stage runs its automation exactly once.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const src = (p) => path.join(__dirname, '..', p);
function stubModule(relPath, exportsObj) {
  const file = require.resolve(src(relPath));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exportsObj };
}

// ─── Fake supabase ────────────────────────────────────────────────────────────
const db = {};
function reset(deal) {
  db.deal = deal;               // row returned by a deals select (null = not found/not owned)
  db.updateRows = null;         // rows returned by the deals update (null => [updated deal])
  db.writes = [];
  db.calls = { blast: 0, titleAssign: 0, titlePackage: 0, ritual: 0, playbook: 0, activity: [] };
}
function builder(table) {
  const st = { op: 'select', payload: null };
  const result = () => {
    if (st.op === 'update') {
      db.writes.push({ table, op: 'update', payload: st.payload, or: st.or });
      if (table === 'deals') {
        const rows = db.updateRows !== null ? db.updateRows : [{ ...db.deal, ...st.payload }];
        return { data: rows, error: null };
      }
      return { data: null, error: null };
    }
    if (st.op === 'insert') {
      db.writes.push({ table, op: 'insert', payload: st.payload });
      return { data: null, error: null };
    }
    if (table === 'deals') return { data: db.deal, error: null };
    return { data: null, error: null, count: 0 };
  };
  const b = {
    select() { return b; }, eq() { return b; }, limit() { return b; },
    or(f) { st.or = f; return b; },
    maybeSingle() { return Promise.resolve(result()); },
    single() { return Promise.resolve(result()); },
    insert(p) { st.op = 'insert'; st.payload = p; return b; },
    update(p) { st.op = 'update'; st.payload = p; return b; },
    then(res, rej) { return Promise.resolve(result()).then(res, rej); },
  };
  return b;
}
stubModule('config/supabase.js', { from: (t) => builder(t) });
stubModule('services/dealActivityService.js', {
  logActivity: async (a) => { db.calls.activity.push(a); return a; },
});
stubModule('services/buyerDispoService.js', {
  startBuyerBlast: async () => { db.calls.blast += 1; return { matched: 3, enqueued: 3, campaignId: 'c1' }; },
});
stubModule('services/titleService.js', {
  autoAssignTitleCompany: async () => { db.calls.titleAssign += 1; return { name: 'Test Title' }; },
  sendDealPackageToTitle: async () => { db.calls.titlePackage += 1; },
  scheduleTitleFollowUps: async () => {},
});
stubModule('services/learningLoopService.js', { logPrediction: async () => {}, verifyPrediction: async () => {} });
stubModule('services/aiLearningService.js', { recordDealOutcome: async () => {} });
stubModule('services/dataMotService.js', { recordWinningPlaybook: async () => { db.calls.playbook += 1; } });
stubModule('services/closeRitualService.js', { runCloseRitual: async () => { db.calls.ritual += 1; } });

const { changeDealStage, StageError, STAGE_KEYS } = require('../services/dealStageService');

const baseDeal = { id: 'deal-1', user_id: 'user-1', lead_id: null, status: 'offer_sent', created_at: new Date().toISOString() };

test('an unknown stage is rejected with 400', async () => {
  reset({ ...baseDeal });
  await assert.rejects(
    changeDealStage({ dealId: 'deal-1', userId: 'user-1', stage: 'under contract' }),
    (e) => e instanceof StageError && e.status === 400,
  );
  assert.strictEqual(db.writes.length, 0);
});

test('a deal the user does not own is 404 and nothing is written', async () => {
  reset(null);
  await assert.rejects(
    changeDealStage({ dealId: 'deal-1', userId: 'someone-else', stage: 'closed' }),
    (e) => e instanceof StageError && e.status === 404,
  );
  assert.strictEqual(db.writes.length, 0);
});

test('moving under contract texts buyers and sends the title package once', async () => {
  reset({ ...baseDeal });
  const out = await changeDealStage({ dealId: 'deal-1', userId: 'user-1', stage: 'under_contract', awaitAutomation: true });
  assert.strictEqual(out.changed, true);
  assert.strictEqual(out.from, 'offer_sent');
  assert.strictEqual(db.calls.blast, 1);
  assert.strictEqual(db.calls.titleAssign, 1);
  assert.strictEqual(db.calls.titlePackage, 1);
  const upd = db.writes.find(w => w.table === 'deals' && w.op === 'update');
  assert.strictEqual(upd.payload.status, 'under_contract');
  assert.ok(upd.payload.stage_changed_at);
  assert.match(upd.or, /status\.neq\.under_contract/);
  assert.strictEqual(db.calls.activity[0].metadata.to, 'under_contract');
});

test('re-saving the current stage changes nothing and starts no outreach', async () => {
  reset({ ...baseDeal, status: 'under_contract' });
  const out = await changeDealStage({ dealId: 'deal-1', userId: 'user-1', stage: 'under_contract', awaitAutomation: true });
  assert.strictEqual(out.changed, false);
  assert.strictEqual(db.calls.blast, 0);
  assert.strictEqual(db.writes.length, 0);
});

test('when a simultaneous request already moved the deal, automation does not run again', async () => {
  reset({ ...baseDeal });
  db.updateRows = []; // conditional update matched no row
  const out = await changeDealStage({ dealId: 'deal-1', userId: 'user-1', stage: 'under_contract', awaitAutomation: true });
  assert.strictEqual(out.changed, false);
  assert.strictEqual(db.calls.blast, 0);
  assert.strictEqual(db.calls.activity.length, 0);
});

test('closing runs the close ritual and records a won outcome', async () => {
  reset({ ...baseDeal, status: 'closing_prep' });
  await changeDealStage({ dealId: 'deal-1', userId: 'user-1', stage: 'closed', awaitAutomation: true });
  assert.strictEqual(db.calls.ritual, 1);
  assert.strictEqual(db.calls.playbook, 1);
  const outcome = db.writes.find(w => w.table === 'deal_outcome_learning');
  assert.strictEqual(outcome?.payload.outcome, 'closed');
  assert.strictEqual(db.calls.blast, 0);
});

test('marking lost records a dead outcome without the close ritual', async () => {
  reset({ ...baseDeal });
  await changeDealStage({ dealId: 'deal-1', userId: 'user-1', stage: 'lost', awaitAutomation: true });
  assert.strictEqual(db.writes.find(w => w.table === 'deal_outcome_learning')?.payload.outcome, 'dead');
  assert.strictEqual(db.calls.ritual, 0);
});

test('stage keys match the frontend constants', () => {
  const fs = require('node:fs');
  const front = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'constants', 'dealStages.js'), 'utf8');
  const frontKeys = [...front.matchAll(/key: '([a-z_]+)'/g)].map(m => m[1]);
  assert.deepStrictEqual(frontKeys, STAGE_KEYS);
});
