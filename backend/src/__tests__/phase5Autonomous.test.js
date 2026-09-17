// Run with:  node --test src/__tests__/
//
// Phase 5: Deal Death Prevention rules, Deal Rescue diagnosis, Opportunity
// Discovery, the alert monitor (open once / refresh / resolve / notify) and the
// Autopilot gates. An in-memory table store stands in for Supabase; nothing is sent.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

// In-memory Supabase stand-in with the filters these engines use.
function fakeDb(seed = {}) {
  const tables = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map(r => ({ ...r }))]));
  let seq = 0;
  const t = (name) => (tables[name] = tables[name] || []);
  function query(name) {
    const filters = [];
    let op = 'select', payload = null, single = null, lim = null, returning = false;
    const q = {
      select() { if (op !== 'select') returning = true; return q; },
      insert(rows) { op = 'insert'; payload = rows; return q; },
      update(patch) { op = 'update'; payload = patch; return q; },
      upsert(rows) { op = 'insert'; payload = rows; return q; },
      eq(c, v) { filters.push(r => r[c] === v); return q; },
      in(c, vs) { filters.push(r => vs.includes(r[c])); return q; },
      is(c, v) { filters.push(r => (r[c] ?? null) === v); return q; },
      gte(c, v) { filters.push(r => r[c] >= v); return q; },
      gt(c, v) { filters.push(r => r[c] > v); return q; },
      lt(c, v) { filters.push(r => r[c] < v); return q; },
      not() { return q; }, or() { return q; }, order() { return q; },
      limit(n) { lim = n; return q; },
      maybeSingle() { single = 'maybe'; return q; },
      single() { single = 'one'; return q; },
      then(resolve, reject) { return exec().then(resolve, reject); },
    };
    async function exec() {
      const rows = t(name);
      let data;
      if (op === 'insert') {
        const list = (Array.isArray(payload) ? payload : [payload]).map(r => ({ id: r.id || `${name}-${++seq}`, created_at: new Date().toISOString(), started_at: new Date().toISOString(), ...r }));
        if (name === 'deal_alerts') {
          for (const r of list) if (rows.some(x => x.status === 'open' && x.deal_id === r.deal_id && x.alert_key === r.alert_key)) return { data: null, error: { code: '23505', message: 'duplicate' } };
        }
        rows.push(...list);
        data = list;
      } else if (op === 'update') {
        data = rows.filter(r => filters.every(f => f(r)));
        data.forEach(r => Object.assign(r, payload));
        if (!returning && single == null) return { data: null, error: null };
      } else {
        data = rows.filter(r => filters.every(f => f(r)));
      }
      if (lim != null) data = data.slice(0, lim);
      data = data.map(r => ({ ...r }));
      if (single === 'one') return data.length ? { data: data[0], error: null } : { data: null, error: { message: 'no rows' } };
      if (single === 'maybe') return { data: data[0] || null, error: null };
      return { data, error: null };
    }
    return q;
  }
  return { from: query, tables };
}

const shared = fakeDb();
const file = require.resolve(path.join(__dirname, '..', 'config/supabase.js'));
require.cache[file] = { id: file, filename: file, loaded: true, exports: shared };
delete process.env.ANTHROPIC_API_KEY;

const G = require('../intelligence/dealGraph');
const { AGENTS } = require('../intelligence/agents');
const { deathPreventionAlerts } = require('../intelligence/agents/autonomous');
const monitor = require('../intelligence/engines/monitor');
const autopilot = require('../intelligence/engines/autopilot');
const perms = require('../intelligence/permissions');
const superAgent = require('../intelligence/superAgent');

const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();
const NOW = Date.parse('2026-09-17T15:00:00Z');

const rep = ({ deal = {}, lead = {}, contracts = [], titleLogs = [], buyer = null, worksheets = {} } = {}) => {
  const r = G.compose({
    deal: { id: 'd1', lead_id: 'l1', property_address: '1 Test St', property_city: 'Austin', property_state: 'TX', property_zip: '78701', status: 'under_contract', arv: 300000, repair_estimate: 40000, seller_agreed_price: 150000, ...deal },
    lead: { id: 'l1', estimated_value: 220000, mortgage_balance: 120000, ...lead },
    buyer, owner: null, lastCall: null, contracts, titleLogs, followUps: [], comps: [],
  }, { record: null, value: null, rent: null, market: null }, {});
  r.unknowns = G.collectUnknowns(r);
  r.data_gaps = [];
  r.worksheets = Object.fromEntries(Object.entries(worksheets).map(([k, v]) => [k, { data: v }]));
  return r;
};
const keys = (alerts) => alerts.map(a => a.key).sort();

test('death prevention: only after contract', () => {
  const res = deathPreventionAlerts(rep({ deal: { status: 'negotiating' } }), NOW);
  assert.strictEqual(res.applicable, false);
  assert.deepStrictEqual(res.alerts, []);
});

test('death prevention: closing in 5 days with no title, buyer or EMD raises the right alerts', () => {
  const signed = { contract_type: 'purchase', signing_status: 'fully_signed', fully_signed_at: iso(NOW - 10 * DAY) };
  const res = deathPreventionAlerts(rep({ deal: { closing_date: iso(NOW + 5 * DAY).slice(0, 10), emd_status: 'requested' }, contracts: [signed] }), NOW);
  assert.strictEqual(res.days_to_close, 5);
  assert.deepStrictEqual(keys(res.alerts), ['emd_late', 'emd_not_received_near_close', 'no_buyer_near_close', 'title_not_opened']);
  assert.strictEqual(res.alerts.find(a => a.key === 'title_not_opened').severity, 'critical');
  assert.strictEqual(res.alerts.find(a => a.key === 'no_buyer_near_close').severity, 'critical');
});

test('death prevention: healthy contract has no alerts; passed closing is critical', () => {
  const signed = { contract_type: 'purchase', signing_status: 'fully_signed', fully_signed_at: iso(NOW - 2 * DAY) };
  const healthy = deathPreventionAlerts(rep({ deal: { closing_date: iso(NOW + 20 * DAY).slice(0, 10), emd_status: 'received' }, contracts: [signed], titleLogs: [{ status: 'opened', created_at: iso(NOW - DAY) }], buyer: { id: 'b1', name: 'B' } }), NOW);
  assert.deepStrictEqual(healthy.alerts, []);
  const passed = deathPreventionAlerts(rep({ deal: { closing_date: iso(NOW - 3 * DAY).slice(0, 10), emd_status: 'received' }, contracts: [signed], titleLogs: [{ status: 'opened' }], buyer: { id: 'b1' } }), NOW);
  assert.deepStrictEqual(keys(passed.alerts), ['closing_passed']);
  assert.strictEqual(passed.alerts[0].severity, 'critical');
  assert.match(passed.alerts[0].message, /3 day\(s\) ago/);
});

test('death prevention: missing closing date, unsigned contract and diligence issues', () => {
  const res = deathPreventionAlerts(rep({ deal: { closing_date: null }, worksheets: { due_diligence: { survey: 'issue', hoa: 'done' } } }), NOW);
  assert.deepStrictEqual(keys(res.alerts), ['diligence_issue_survey', 'no_closing_date', 'no_signed_contract', 'title_not_opened']);
});

test('deal rescue: diagnoses price, buyer and timeline causes with options and owners', async () => {
  const r = rep({ deal: { closing_date: iso(Date.now() - DAY).slice(0, 10) } });
  const out = await AGENTS.deal_rescue.run({ userId: 'u1', dealId: 'd1', understanding: r, useModel: false, disagreements: [],
    priorOutputs: { wholesale: { data: { verdict: 'above_mao', mao: 170000 } }, buyer_matching: { data: { total_matches: 0 } } } }, { persist: false });
  const causes = out.data.causes.map(c => c.cause);
  assert.deepStrictEqual(causes.slice(0, 3), ['price', 'buyer', 'timeline']);
  for (const c of out.data.causes) {
    assert.ok(c.options.length >= 2 && c.recommended_next_action && c.deadline && c.responsible_party, `${c.cause} is complete`);
  }
  assert.match(out.data.causes[0].impact, /\$170,000/);
  assert.ok(out.findings.every(f => f.claim.status === 'INFERRED'));
});

test('opportunity discovery: needs 2+ signals, skips DNC and leads with deals, labels evidence', async () => {
  const db = fakeDb({
    leads: [
      { id: 'a', user_id: 'u1', property_address: '1 A St', estimated_value: 200000, mortgage_balance: 50000, probate_case: true, is_on_dnc: false, status: 'new' },
      { id: 'b', user_id: 'u1', property_address: '2 B St', estimated_value: 200000, mortgage_balance: 50000, probate_case: true, is_on_dnc: true, status: 'new' },
      { id: 'c', user_id: 'u1', property_address: '3 C St', estimated_value: 200000, mortgage_balance: 50000, probate_case: true, is_on_dnc: false, status: 'new' },
      { id: 'd', user_id: 'u1', property_address: '4 D St', is_absentee_owner: true, is_on_dnc: false, status: 'new' },
      { id: 'e', user_id: 'u2', property_address: '5 E St', estimated_value: 200000, mortgage_balance: 0, probate_case: true, is_on_dnc: false },
    ],
    deals: [{ id: 'x', user_id: 'u1', lead_id: 'c' }],
  });
  const out = await AGENTS.opportunity_discovery.run({ userId: 'u1', tools: { supabase: db } }, { persist: false });
  assert.deepStrictEqual(out.data.opportunities.map(o => o.lead_id), ['a']);
  assert.deepStrictEqual(out.data.opportunities[0].evidence.map(e => e.signal), ['high_equity', 'probate']);
  assert.strictEqual(out.data.opportunities[0].evidence_status, 'UNVERIFIED');
  assert.ok(out.missing.some(m => /MLS/.test(m.item)));
});

test('market intelligence: honest when no provider is connected', async () => {
  delete process.env.RENTCAST_API_KEY;
  const out = await AGENTS.market_intelligence.run({ userId: 'u1', understanding: rep() }, { persist: false });
  assert.strictEqual(out.status, 'insufficient_data');
  assert.match(out.summary, /No market data provider/);
});

test('monitor: opens once, refreshes, notifies critical/high only, resolves when cleared', async () => {
  const db = fakeDb();
  const a1 = { key: 'title_not_opened', severity: 'critical', message: 'Title not opened.', recommended_action: 'Open title.' };
  const a2 = { key: 'emd_late', severity: 'medium', message: 'EMD late.', recommended_action: 'Confirm EMD.' };
  const first = await monitor.reconcileAlerts({ userId: 'u1', dealId: 'd1', alerts: [a1, a2], db, address: '1 Test St' });
  assert.strictEqual(first.opened.length, 2);
  assert.strictEqual(db.tables.notifications.length, 1);
  assert.strictEqual(db.tables.notifications[0].operator_id, 'u1');
  assert.match(db.tables.notifications[0].title, /Critical risk: 1 Test St/);

  const second = await monitor.reconcileAlerts({ userId: 'u1', dealId: 'd1', alerts: [a1, a2], db });
  assert.strictEqual(second.opened.length, 0);
  assert.strictEqual(second.refreshed, 2);
  assert.strictEqual(db.tables.deal_alerts.length, 2);
  assert.strictEqual(db.tables.notifications.length, 1);

  const third = await monitor.reconcileAlerts({ userId: 'u1', dealId: 'd1', alerts: [a2], db });
  assert.strictEqual(third.resolved, 1);
  assert.strictEqual(db.tables.deal_alerts.find(a => a.alert_key === 'title_not_opened').status, 'resolved');

  // Another tenant's reconcile never touches these alerts.
  await monitor.reconcileAlerts({ userId: 'u2', dealId: 'd1', alerts: [], db });
  assert.strictEqual(db.tables.deal_alerts.find(a => a.alert_key === 'emd_late').status, 'open');

  // Recurrence after resolution opens a fresh alert.
  const again = await monitor.reconcileAlerts({ userId: 'u1', dealId: 'd1', alerts: [a1, a2], db });
  assert.strictEqual(again.opened.length, 1);
});

test('monitor: a dismissed warning stays quiet while it persists and returns after it clears and recurs', async () => {
  const db = fakeDb();
  const a = { key: 'emd_late', severity: 'high', message: 'EMD late.', recommended_action: 'Confirm EMD.' };
  const first = await monitor.reconcileAlerts({ userId: 'u1', dealId: 'd1', alerts: [a], db });
  db.tables.deal_alerts.find(x => x.id === first.opened[0].id).status = 'dismissed';
  const quiet = await monitor.reconcileAlerts({ userId: 'u1', dealId: 'd1', alerts: [a], db });
  assert.strictEqual(quiet.opened.length, 0);
  assert.strictEqual(quiet.suppressed, 1);
  assert.strictEqual(db.tables.notifications.length, 1);
  await monitor.reconcileAlerts({ userId: 'u1', dealId: 'd1', alerts: [], db });
  assert.strictEqual(db.tables.deal_alerts[0].status, 'resolved');
  const back = await monitor.reconcileAlerts({ userId: 'u1', dealId: 'd1', alerts: [a], db });
  assert.strictEqual(back.opened.length, 1);
});

test('wholesale: no offer approval is proposed once the deal is under contract', async () => {
  const pre = await AGENTS.wholesale.run({ userId: 'u1', dealId: 'd1', understanding: rep({ deal: { status: 'negotiating' } }), useModel: false }, { persist: false });
  const post = await AGENTS.wholesale.run({ userId: 'u1', dealId: 'd1', understanding: rep(), useModel: false }, { persist: false });
  assert.ok(pre.recommendations.some(r => r.action_type === 'submit_offer'));
  assert.ok(!post.recommendations.some(r => r.action_type === 'submit_offer'));
  assert.ok(post.recommendations.some(r => /already under contract/.test(r.why)));
});

test('planner: deal rescue runs after risk and before the challenger', () => {
  const waves = superAgent.planWaves(superAgent.INTENTS.deal_not_working.agents);
  const idx = (id) => waves.findIndex(w => w.includes(id));
  assert.ok(idx('risk') < idx('deal_rescue') && idx('deal_rescue') < idx('challenger'));
  assert.strictEqual(waves[waves.length - 1].length, 1);
  for (const intent of Object.keys(superAgent.INTENTS)) superAgent.planWaves(superAgent.INTENTS[intent].agents);
});

// ── Autopilot follow-up gates ───────────────────────────────────────────────
const deal = { id: 'd1', status: 'negotiating', property_address: '1 Test St' };
const lead = { id: 'l1', first_name: 'Sam', phone: '+15125550142', consent: true, is_on_dnc: false, property_state: 'TX' };
const on = { mode: 'autopilot', auto_send_sms: true, auto_place_calls: false, auto_draft: true };
function deps({ gate = { allowed: true, hardStops: [], warnings: [], requiredDisclosures: [] }, sent = 'SM1', db = fakeDb() } = {}) {
  const calls = { sms: [], gate: [] };
  return {
    calls,
    deps: {
      db, perms,
      compliance: { complianceGate: async (a) => { calls.gate.push(a); return gate; } },
      sms: { sendReply: async (...args) => { calls.sms.push(args); return sent; } },
    },
  };
}

test('autopilot follow-up: sends only when every gate passes, and masks the phone', async () => {
  const { deps: d, calls } = deps();
  const s = await autopilot.sellerFollowUp({ userId: 'u1', deal, lead, settings: on, company: 'Acme Homes', deps: d });
  assert.strictEqual(s.status, 'done');
  assert.strictEqual(calls.sms.length, 1);
  assert.match(calls.sms[0][1], /^Hi Sam, this is Acme Homes following up about 1 Test St\..*Reply STOP to opt out\.$/);
  assert.strictEqual(calls.gate[0].channel, 'sms');
  assert.ok(s.detail.includes('***-***-0142') && !JSON.stringify(s).includes('5550142'));
});

test('autopilot follow-up: each missing condition stops the send with a reason', async () => {
  const cases = [
    [{ settings: { ...on, mode: 'copilot' } }, 'drafted', /Copilot/],
    [{ settings: { ...on, auto_send_sms: false } }, 'drafted', /turned off/],
    [{ lead: { ...lead, consent: false } }, 'blocked', /consent/],
    [{ lead: { ...lead, is_on_dnc: true } }, 'blocked', /do-not-contact/],
    [{ lead: { ...lead, phone: null } }, 'skipped', /no phone/],
    [{ company: null }, 'skipped', /company name/],
    [{ deal: { ...deal, status: 'under_contract' } }, 'skipped', /Not applicable/],
    [{ gate: { allowed: false, hardStops: [{ detail: 'Outside the recipient-local calling window.' }], warnings: [], requiredDisclosures: [] } }, 'blocked', /calling window/],
    [{ gate: { allowed: true, hardStops: [], warnings: [], requiredDisclosures: ['Disclosure text'] } }, 'drafted', /disclosure/],
    [{ sent: null }, 'failed', /did not send/],
    [{ db: fakeDb({ sms_messages: [{ user_id: 'u1', lead_id: 'l1', direction: 'inbound', sent_at: new Date().toISOString() }] }) }, 'skipped', /last 72 hours/],
  ];
  for (const [over, status, re] of cases) {
    const { deps: d, calls } = deps(over);
    const s = await autopilot.sellerFollowUp({ userId: 'u1', deal: over.deal || deal, lead: over.lead || lead, settings: over.settings || on, company: 'company' in over ? over.company : 'Acme Homes', deps: d });
    assert.strictEqual(s.status, status, `${JSON.stringify(over).slice(0, 80)} → ${s.detail}`);
    assert.match(s.detail, re);
    if (status !== 'failed') assert.strictEqual(calls.sms.length, 0, 'nothing sent');
  }
});

test('autopilot run: refuses in copilot mode and records every step in autopilot mode', async () => {
  const db = fakeDb({
    deals: [{ id: 'd1', user_id: 'u1', lead_id: 'l1', status: 'negotiating', property_address: '1 Test St', last_autopilot_at: null }],
    leads: [{ ...lead, user_id: 'u1' }], users: [{ id: 'u1', company_name: 'Acme Homes' }],
  });
  const fakePerms = { ...perms, getSettings: async () => ({ ...on, mode: 'copilot' }) };
  await assert.rejects(autopilot.run({ userId: 'u1', dealId: 'd1', deps: { db, perms: fakePerms } }), e => e.status === 409);

  const synthesis = {
    run_id: 'r1', intent_label: 'Complete acquisition analysis', missing: [{}], data_gaps: [], confidence: { score: 61 },
    agents: [{ agent: 'wholesale', status: 'complete', summary: 'ok' }, { agent: 'challenger', status: 'complete', summary: 'ok' }],
    challenges: [], disagreements: [], approvals_requested: [{ id: 'ap1', action_type: 'submit_offer', reason: 'Offer $150,000' }], pending_approvals: [{ id: 'ap1' }],
    best_next_action: { action: 'Approve the offer', why: 'Price is under MAO' },
  };
  const invoked = [];
  const { deps: d, calls } = deps({ db });
  const result = await autopilot.run({ userId: 'u1', dealId: 'd1', deps: { ...d, perms: { ...perms, getSettings: async () => on }, superAgent: { run: async (p) => { invoked.push(p); return synthesis; } }, monitor: { checkDeal: async () => { throw new Error('not for pre-contract'); } } } });
  assert.strictEqual(result.status, 'completed');
  assert.strictEqual(invoked[0].intent, 'full_analysis');
  assert.deepStrictEqual(result.steps.map(s => s.step), ['permissions', 'contract_monitoring', 'understand_and_verify', 'analyze', 'challenge', 'rescue', 'approvals', 'seller_follow_up', 'best_next_action']);
  assert.match(result.steps.find(s => s.step === 'approvals').detail, /Offer \$150,000/);
  assert.strictEqual(calls.sms.length, 1);
  assert.strictEqual(db.tables.autopilot_runs[0].status, 'completed');
  assert.ok(db.tables.deals[0].last_autopilot_at);

  // Immediate second run is refused (claim gap).
  await assert.rejects(autopilot.run({ userId: 'u1', dealId: 'd1', deps: { ...d, perms: { ...perms, getSettings: async () => on } } }), e => e.status === 429);
});
