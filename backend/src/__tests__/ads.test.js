// Veori Ads: the pre-flight gate, the arithmetic behind the market score, the
// compliance screen, the non-duplication engine and the learning weight shift.
// Nothing here checks copy quality; it checks that nothing is invented, nothing
// unlawful is stored, and nothing repeats.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

// ── A supabase stand-in the modules query the same way production does ──────
const tables = {};
function query(name) {
  const filters = [];
  let limit = Infinity;
  const q = {
    select() { return q; }, order() { return q; }, maybeSingle() { return q.then ? q : q; },
    limit(n) { limit = n; return q; },
    eq(c, v) { filters.push(r => r[c] === v); return q; },
    neq(c, v) { filters.push(r => r[c] !== v); return q; },
    ilike(c, v) { filters.push(r => String(r[c] || '').toLowerCase() === String(v).toLowerCase()); return q; },
    gte(c, v) { filters.push(r => String(r[c]) >= String(v)); return q; },
    lte(c, v) { filters.push(r => String(r[c]) <= String(v)); return q; },
    not(c, op, v) { filters.push(r => (op === 'is' && v === null ? r[c] != null : true)); return q; },
    insert(row) { const r = { id: 'new-' + Math.random().toString(36).slice(2), ...row }; (tables[name] = tables[name] || []).push(r); return { select: () => ({ single: async () => ({ data: r, error: null }) }) }; },
    upsert(row) { (tables[name] = tables[name] || []).push(row); return { select: () => ({ single: async () => ({ data: row, error: null }) }) }; },
    update() { return q; },
    rows() { return (tables[name] || []).filter(r => filters.every(f => f(r))).slice(0, limit); },
    then(res, rej) { return Promise.resolve({ data: q.rows(), error: null, count: q.rows().length }).then(res, rej); },
  };
  const orig = q.maybeSingle;
  q.maybeSingle = () => Promise.resolve({ data: q.rows()[0] || null, error: null });
  void orig;
  return q;
}
const file = require.resolve(path.join(__dirname, '..', 'config/supabase.js'));
require.cache[file] = { id: file, filename: file, loaded: true, exports: { from: query } };
process.env.ADS_LEARNING_SALT = process.env.ADS_LEARNING_SALT || 'test-salt';

const marketPulse = require('../ads/marketPulse');
const compliance = require('../ads/compliance');
const dedupe = require('../ads/dedupe');
const learning = require('../ads/learning');
const connectors = require('../ads/connectors');
const catalog = require('../ads/catalog');
const copy = require('../ads/copy');
const creative = require('../ads/creative');
const preflight = require('../ads/preflight');

const reset = () => { for (const k of Object.keys(tables)) delete tables[k]; };
const U = 'user-1';
const lead = (over = {}) => ({ id: 'l' + Math.random().toString(36).slice(2), user_id: U, created_at: '2026-06-01T00:00:00Z', property_city: 'Austin', property_state: 'TX', property_zip: '78701', estimated_value: 300000, estimated_equity: 120000, distress_signals: [], secondary_tags: [], tags: [], ...over });

// ── Connectors declare themselves missing rather than pretending ────────────
test('no advertising data source is connected, and each gap says what it costs', () => {
  const s = connectors.status();
  assert.strictEqual(s.filter(x => x.connected).length, 0);
  assert.ok(s.find(x => x.id === 'meta_ad_library'));
  const gaps = connectors.gapsFor(['competitor_ads', 'keyword_volume']);
  assert.strictEqual(gaps.length, 2);
  for (const g of gaps) {
    assert.strictEqual(g.status, 'UNKNOWN');
    assert.ok(g.why_missing && g.what_veori_does_instead && g.how_to_close_it, 'a gap must say why, what instead, and how to close it');
  }
});

// ── Market score ────────────────────────────────────────────────────────────
test('a thin market produces no score at all rather than a made-up one', () => {
  const leads = Array.from({ length: 5 }, () => lead());
  const comps = marketPulse.components({ leads, deals: [], baseline: { leads: 5, deals: 0 } });
  const s = marketPulse.opportunityScore(comps, leads.length);
  assert.strictEqual(s.score, null);
  assert.strictEqual(s.status, 'insufficient_data');
  assert.match(s.basis, /does not publish a number it cannot stand behind/);
});

test('competitive density is excluded from the score, not guessed, and the weights renormalise', () => {
  const leads = Array.from({ length: 60 }, (_, i) => lead({ id: 'l' + i, distress_signals: i % 2 ? ['vacant'] : [] }));
  const comps = marketPulse.components({ leads, deals: [], baseline: { leads: 200, deals: 10 } });
  const comp = comps.find(c => c.id === 'competition_pressure');
  assert.strictEqual(comp.status, 'unavailable');
  assert.strictEqual(comp.score, null);
  const s = marketPulse.opportunityScore(comps, leads.length);
  assert.strictEqual(s.weight_total, 100);
  assert.ok(s.weight_used < 100, 'the missing component is not counted');
  assert.ok(s.score >= 0 && s.score <= 100);
  // The score is the weighted mean of what was measured only.
  const usable = comps.filter(c => c.status === 'measured');
  const expected = Math.round(usable.reduce((t, c) => t + c.score * c.weight, 0) / usable.reduce((t, c) => t + c.weight, 0));
  assert.strictEqual(s.score, expected);
});

test('angles are ranked on counted evidence, and an angle with none is listed as having none', () => {
  const leads = [
    ...Array.from({ length: 12 }, (_, i) => lead({ id: 'v' + i, distress_signals: ['vacant'] })),
    ...Array.from({ length: 4 }, (_, i) => lead({ id: 'p' + i, probate_case: true })),
  ];
  const { ranked, no_evidence } = marketPulse.rankAngles(leads, [{ lead_id: 'v0' }, { lead_id: 'v1' }]);
  assert.strictEqual(ranked[0].angle, 'vacant');
  assert.strictEqual(ranked[0].leads, 12);
  assert.strictEqual(ranked[0].deals_from_this_situation, 2);
  assert.strictEqual(ranked[0].evidence_strength, 'moderate');
  assert.ok(no_evidence.find(x => x.angle === 'tired_landlord'), 'an angle nobody in this market matches is named, not ranked');
  assert.ok(ranked.every(r => r.leads > 0));
});

test('market parsing refuses anything it cannot resolve', () => {
  assert.strictEqual(marketPulse.resolveMarket('Austin, tx').label, 'Austin, TX');
  assert.strictEqual(marketPulse.resolveMarket('78701').kind, 'zip');
  assert.throws(() => marketPulse.resolveMarket(''), /market is required/i);
  assert.throws(() => marketPulse.resolveMarket('somewhere nice'), /City, ST/);
});

// ── Compliance ──────────────────────────────────────────────────────────────
test('fair housing: language about the person is blocked, language about the property is not', () => {
  const bad = compliance.check('Great starter home, no children, perfect for a Christian family');
  assert.strictEqual(bad.ok, false);
  const classes = bad.blocked.map(b => b.detail);
  assert.ok(classes.some(d => /familial status/.test(d)));
  assert.ok(classes.some(d => /religion/.test(d)));
  assert.strictEqual(compliance.check('If the roof is why nobody will look at it, that is the part we handle.').ok, true);
});

test('guarantees, superlatives and rescue language are blocked', () => {
  for (const s of ['We guarantee the highest price', 'Stop foreclosure today', 'Risk-free instant cash', 'We will beat any offer']) {
    assert.strictEqual(compliance.check(s).ok, false, `${s} should be blocked`);
  }
});

test('a fabricated testimonial cannot get through', () => {
  const r = compliance.check('"They closed in nine days and it was completely painless" - Sandra');
  assert.strictEqual(r.ok, false);
  assert.ok(r.blocked.find(b => b.rule === 'fabricated_testimonial'));
  assert.match(r.blocked.find(b => b.rule === 'fabricated_testimonial').detail, /never writes a testimonial/);
});

test('every figure in copy is flagged as needing a source', () => {
  const r = compliance.check('14 houses bought here, median 21 days, from $90,000 to $240,000.');
  assert.ok(r.figures_used.some(f => /14 houses/.test(f)), JSON.stringify(r.figures_used));
  assert.ok(r.figures_used.some(f => /21 days/.test(f)));
  assert.ok(r.figures_used.some(f => /90,000/.test(f)));
  assert.match(r.figures_note, /does not publish a number it cannot source/);
});

// ── Non-duplication ─────────────────────────────────────────────────────────
test('similarity is mostly structural, and a reworded repeat is still a repeat', () => {
  const a = { angle: 'vacant', psychological_driver: 'relief', hook_style: 'permission', image_format: 'text_on_plain', hook: 'The empty house is costing you every month' };
  const b = { ...a, hook: 'That empty house costs you money every single month' };
  assert.ok(dedupe.similarity(a, b).score >= 80, 'same structure, different words, still a repeat');
  const c = { angle: 'inherited', psychological_driver: 'dignity', hook_style: 'after_picture', image_format: 'hands_keys', hook: 'Picture the week it stops being yours' };
  assert.ok(dedupe.similarity(a, c).score < 30);
});

test('differentiation deducts for recent repeats, market overlap and industry language, and blocks below the threshold', () => {
  const d = dedupe.differentiation({
    lookback: { closest: { similarity: 95, age_days: 10 } },
    overlap: { checked: true, exact_combination_in_use: true },
    candidate: { hook: 'We buy houses in any condition, fair cash offer' },
  });
  assert.strictEqual(d.blocked, true);
  assert.ok(d.deductions.length >= 3);
  assert.ok(d.saturated_phrases_used.length >= 2);
  assert.ok(d.saturated_phrases_used.every(p => p.instead), 'every saturated phrase carries what to do instead');

  const clean = dedupe.differentiation({
    lookback: { closest: null }, overlap: { checked: true, exact_combination_in_use: false, same_angle_and_driver_in_use: false },
    candidate: { hook: 'The tax balance does not have to be cleared before you sell.' },
  });
  assert.strictEqual(clean.score, 100);
  assert.strictEqual(clean.blocked, false);
});

test('an older repeat is penalised less than a fresh one', () => {
  const at = (age) => dedupe.differentiation({ lookback: { closest: { similarity: 90, age_days: age } }, overlap: { checked: false }, candidate: { hook: 'x' } }).score;
  assert.ok(at(10) < at(60));
  assert.ok(at(60) < at(150));
});

// ── Learning ────────────────────────────────────────────────────────────────
test('the weight shifts toward the operator but never all the way', () => {
  assert.deepStrictEqual([learning.blend(0).own_weight, learning.blend(0).network_weight], [0, 100]);
  assert.strictEqual(learning.blend(25).own_weight, 80);
  assert.strictEqual(learning.blend(1000).own_weight, 80, 'the network floor never disappears');
  assert.match(learning.blend(1000).why_not_all_own, /never becomes a rule/);
});

test('a figure is only BENCHMARKED with enough results from enough distinct operators', () => {
  const row = (h, cpl) => ({ contributor_hash: h, campaign_angle: 'vacant', cpl_cents: cpl, cost_per_contract_cents: null, ctr: null, leads: 1, contracts: 0 });
  const thin = learning.summarise([row('a', 100), row('a', 200), row('b', 300)], 'campaign_angle');
  assert.strictEqual(thin[0].label, 'ESTIMATED');
  assert.match(thin[0].label_meaning, /Directional, not a benchmark/);

  const many = learning.summarise(Array.from({ length: 12 }, (_, i) => row(['a', 'b', 'c'][i % 3], 100 * (i + 1))), 'campaign_angle');
  assert.strictEqual(many[0].label, 'BENCHMARKED');
  assert.strictEqual(many[0].contributors, 3);

  const oneOperator = learning.summarise(Array.from({ length: 12 }, () => row('a', 500)), 'campaign_angle');
  assert.strictEqual(oneOperator.length, 0, 'one operator alone is never reported back to the network');
});

test('the contributor hash is one-way and not the user id', () => {
  const h = learning.contributorHash(U);
  assert.match(h, /^[a-f0-9]{64}$/);
  assert.ok(!h.includes(U));
  assert.strictEqual(h, learning.contributorHash(U));
  assert.notStrictEqual(h, learning.contributorHash('user-2'));
});

// ── Catalogue integrity ─────────────────────────────────────────────────────
test('every angle has copy, allowed drivers and a hook builder for every style', () => {
  for (const a of catalog.ANGLES) {
    assert.ok(copy.ANGLE_COPY[a.id], `${a.id} has no copy fragments`);
    for (const f of ['subject', 'burden', 'they_say', 'objection', 'after', 'permission', 'waiting', 'one_step']) {
      assert.ok(copy.ANGLE_COPY[a.id][f], `${a.id} is missing ${f}`);
    }
    assert.ok(a.drivers.length && a.drivers.every(d => catalog.DRIVER_IDS.includes(d)), `${a.id} points at a driver that does not exist`);
  }
  for (const s of catalog.HOOK_STYLES) assert.ok(copy.HOOK_BUILDERS[s.id], `no builder for hook style ${s.id}`);
  assert.strictEqual(catalog.DRIVERS.length, 7);
});

test('no phrase Veori generates is on its own do-not-use list', () => {
  const proof = { closings: { usable: true, value: 14 }, median_days: { usable: true, value: 21 }, price_range: { usable: false } };
  for (const a of catalog.ANGLES) {
    const hooks = creative.buildHooks({ angleId: a.id, driverId: a.drivers[0], proof });
    for (const h of hooks.filter(x => x.text)) {
      for (const s of catalog.SATURATED) {
        assert.ok(!h.text.toLowerCase().includes(s.phrase), `${a.id}/${h.hook_style} uses the saturated phrase "${s.phrase}"`);
      }
      assert.strictEqual(h.compliance.ok, true, `${a.id}/${h.hook_style} failed compliance: ${JSON.stringify(h.compliance.blocked)}`);
    }
  }
});

test('an evidence-backed hook is skipped, never faked, when there is no evidence', () => {
  const noProof = { closings: { usable: false, basis: 'Only 1 closed deal here.' }, median_days: { usable: false }, price_range: { usable: false } };
  const hooks = creative.buildHooks({ angleId: 'vacant', driverId: 'relief', proof: noProof });
  const plain = hooks.find(h => h.hook_style === 'plain_number');
  assert.strictEqual(plain.text, null);
  assert.match(plain.skipped, /needs a figure from your records/);
  assert.ok(hooks.some(h => h.usable), 'the shapes that need no evidence still work');
});

test('a hook shape already used in this market is not offered again', () => {
  const proof = { closings: { usable: false, basis: 'none' }, median_days: { usable: false }, price_range: { usable: false } };
  const hooks = creative.buildHooks({ angleId: 'vacant', driverId: 'relief', proof, avoidStyles: ['permission'] });
  const used = hooks.find(h => h.hook_style === 'permission');
  assert.strictEqual(used.usable, false);
  assert.match(used.why_not, /last 180 days/);
});

// ── Driver selection ────────────────────────────────────────────────────────
test('a driver the situation does not support is refused, with the reason', () => {
  assert.throws(() => creative.chooseDriver('inherited', 'loss_aversion', { by_driver: [] }, null), /not one Veori will pair/);
  const ok = creative.chooseDriver('inherited', 'dignity', { by_driver: [] }, null);
  assert.strictEqual(ok.driver, 'dignity');
});

test('with no recorded results the driver comes from the catalogue, and says so', () => {
  const r = creative.chooseDriver('vacant', null, { by_driver: [] }, null);
  assert.strictEqual(r.driver, 'loss_aversion');
  assert.match(r.basis, /documented default, not a finding/);
});

test('with network results the driver follows them and names the blend', () => {
  const network = { by_driver: [{ value: 'relief', label: 'BENCHMARKED', results: 18 }, { value: 'loss_aversion', label: 'ESTIMATED', results: 4 }] };
  const r = creative.chooseDriver('vacant', null, network, { data_points: 10 });
  assert.strictEqual(r.driver, 'relief');
  assert.match(r.basis, /18 recorded results/);
  assert.strictEqual(r.weights.own_weight, 32);
});

// ── Deliverables ────────────────────────────────────────────────────────────
test('the image brief is complete enough to hand to a designer, and bans what must not appear', () => {
  const b = creative.imageBrief({ angleId: 'vacant', driverId: 'relief', format: 'exterior_ordinary', hook: 'The empty house is still costing you', market: 'Austin, TX' });
  for (const f of ['format', 'subject', 'composition', 'lighting', 'palette', 'text_overlay', 'must_not_appear', 'accessibility', 'aspect_ratios', 'driver_alignment', 'production_note']) {
    assert.ok(b[f], `image brief is missing ${f}`);
  }
  assert.strictEqual(b.text_overlay.text, 'The empty house is still costing you');
  assert.ok(b.aspect_ratios.length >= 4);
  assert.ok(b.must_not_appear.some(x => /legal notice/i.test(x)));
  assert.ok(b.must_not_appear.some(x => /who lives in the property/i.test(x)));
});

test('the video script has five fixed parts, every line clears compliance, and proof is never invented', () => {
  const noProof = { closings: { usable: false }, median_days: { usable: false }, price_range: { usable: false }, rule: 'r' };
  const v = creative.videoScript({ angleId: 'pre_foreclosure', driverId: 'dignity', proof: noProof, hook: 'A date you did not choose is still a date you can plan around.' });
  assert.strictEqual(v.parts.length, 5);
  assert.deepStrictEqual(v.parts.map(p => p.part), [1, 2, 3, 4, 5]);
  assert.ok(v.parts.every(p => p.line && p.job && p.rule));
  assert.strictEqual(v.ok, true, JSON.stringify(v.parts.filter(p => !p.compliance.ok).map(p => p.compliance.blocked)));
  assert.match(v.parts[3].line, /exactly what happens/, 'with no closings the proof part describes the process');
  assert.match(v.parts[3].on_screen, /No figures on screen/);

  const withProof = { closings: { usable: true, value: 14 }, median_days: { usable: true, value: 21 }, price_range: { usable: true, value: [90000, 240000] }, rule: 'r' };
  const v2 = creative.videoScript({ angleId: 'pre_foreclosure', driverId: 'dignity', proof: withProof, hook: 'x' });
  assert.match(v2.parts[3].line, /14 houses/);
  assert.match(v2.parts[3].line, /21 days/);
});

test('cost per lead is labelled, and never presented as a guarantee', () => {
  const none = creative.costExpectation({ by_angle: [] }, 'vacant', null);
  assert.strictEqual(none.cost_per_lead, null);
  assert.strictEqual(none.label, 'UNKNOWN');
  assert.match(none.statement, /does not estimate one/);

  const benched = creative.costExpectation({ by_angle: [{ value: 'vacant', median_cpl: 42, cpl_range: [20, 90], label: 'BENCHMARKED', label_meaning: 'Median of 14 recorded results from 4 operators.', results: 14, contributors: 4 }] }, 'vacant', null);
  assert.strictEqual(benched.label, 'BENCHMARKED');
  assert.match(benched.not_a_guarantee, /never guarantees a cost per lead/);
});

// ── The gate ────────────────────────────────────────────────────────────────
test('creative cannot be produced without a live, scored, unexpired brief', async () => {
  reset();
  tables.market_preflight_brief = [];
  await assert.rejects(() => preflight.requireBrief(U, 'Austin, TX'), (e) => e.code === 'PREFLIGHT_REQUIRED');

  tables.market_preflight_brief = [{ id: 'b1', user_id: U, market: 'Austin, TX', superseded: false, expires_at: new Date(Date.now() - 86400000).toISOString(), opportunity_score: 60, generated_at: '2026-01-01T00:00:00Z' }];
  await assert.rejects(() => preflight.requireBrief(U, 'Austin, TX'), (e) => e.code === 'PREFLIGHT_EXPIRED');

  tables.market_preflight_brief = [{ id: 'b2', user_id: U, market: 'Austin, TX', superseded: false, expires_at: new Date(Date.now() + 86400000).toISOString(), opportunity_score: null, generated_at: '2026-09-01T00:00:00Z' }];
  await assert.rejects(() => preflight.requireBrief(U, 'Austin, TX'), (e) => e.code === 'PREFLIGHT_INSUFFICIENT');

  tables.market_preflight_brief = [{ id: 'b3', user_id: U, market: 'Austin, TX', superseded: false, expires_at: new Date(Date.now() + 86400000).toISOString(), opportunity_score: 61, generated_at: '2026-09-01T00:00:00Z' }];
  const ok = await preflight.requireBrief(U, 'Austin, TX');
  assert.strictEqual(ok.id, 'b3');
});

test('a brief belonging to another operator is never returned', async () => {
  reset();
  tables.market_preflight_brief = [{ id: 'other', user_id: 'user-2', market: 'Austin, TX', superseded: false, expires_at: new Date(Date.now() + 86400000).toISOString(), opportunity_score: 90, generated_at: '2026-09-01T00:00:00Z' }];
  await assert.rejects(() => preflight.requireBrief(U, 'Austin, TX'), (e) => e.code === 'PREFLIGHT_REQUIRED');
});

// ── Readiness score ─────────────────────────────────────────────────────────
test('the creative intelligence score cannot rise above what is actually known', () => {
  const empty = preflight.creativeIntelligenceScore({
    pulse: { data_confidence: 0, angle_ranking: [] },
    completeness: { pct: 0 }, voice: { captured: false }, learnedPoints: 0,
  });
  assert.strictEqual(empty.score, 0);
  assert.match(empty.meaning, /Too little is known/);

  const full = preflight.creativeIntelligenceScore({
    pulse: { data_confidence: 100, angle_ranking: [{ leads: 80, evidence_strength: 'strong' }] },
    completeness: { pct: 100 }, voice: { captured: true }, learnedPoints: 30,
  });
  assert.strictEqual(full.score, 100);
  assert.strictEqual(full.parts.reduce((s, p) => s + p.weight, 0), 100);
});

test('no voice on file means neutral copy, not an invented personality', () => {
  const v = preflight.voiceOf(null);
  assert.strictEqual(v.captured, false);
  assert.match(v.instruction, /does not invent a personality/);
  const v2 = preflight.voiceOf({ voice: { tone: 'blunt', phrases_to_avoid: ['reach out'] }, voice_source: 'operator' });
  assert.strictEqual(v2.captured, true);
  assert.strictEqual(v2.status, 'USER_PROVIDED');
});
