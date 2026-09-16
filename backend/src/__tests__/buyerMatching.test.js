// Run with:  node --test src/__tests__/
//
// Covers buyer matching and reply handling: input validation, the buy-box filter
// (state, city, zip, min/max price, type), one offer per buyer per deal, and that
// a buyer's YES is tied to a deal they were actually offered - never guessed.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const src = (p) => path.join(__dirname, '..', p);
function stubModule(relPath, exportsObj) {
  const file = require.resolve(src(relPath));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exportsObj };
}

const S = { buyers: [], offers: [], inserts: [], updates: [], enqueued: [], rpc: [] };
function builder(table) {
  const st = { op: 'select', payload: null, filters: [] };
  const exec = () => {
    if (st.op === 'insert') {
      if (table === 'buyer_deal_offers' && S.offers.some(o => o.deal_id === st.payload.deal_id && o.buyer_id === st.payload.buyer_id)) {
        return { data: null, error: { code: '23505', message: 'duplicate' } };
      }
      const row = { id: `${table}-${S.inserts.length + 1}`, ...st.payload };
      S.inserts.push({ table, row });
      if (table === 'buyer_deal_offers') S.offers.push(row);
      return { data: row, error: null };
    }
    if (st.op === 'update') { S.updates.push({ table, payload: st.payload }); return { data: null, error: null }; }
    if (table === 'deals') return { data: S.deal, error: null };
    if (table === 'buyers') {
      const own = st.filters.find(f => f[0] === 'user_id');
      const pool = st.filters.find(f => f[0] === 'share_to_pool');
      if (pool) return { data: [], error: null };
      return { data: S.buyers.filter(b => !own || b.user_id === own[1]), error: null };
    }
    if (table === 'buyer_campaigns') return { data: null, error: null };
    if (table === 'buyer_deal_offers') return { data: S.offers, error: null };
    return { data: null, error: null };
  };
  const b = {
    select() { return b; }, neq() { return b; }, in() { return b; }, gte() { return b; }, order() { return b; }, limit() { return b; },
    eq(k, v) { st.filters.push([k, v]); return b; },
    range() { return Promise.resolve(exec()); },
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
stubModule('services/queueService.js', { enqueueSMS: async (j) => { S.enqueued.push(j); return `job-${S.enqueued.length}`; } });

const { normalizeBuyer } = require('../utils/buyerFields');
const { matchBuyers, startBuyerBlast, pickOfferForReply } = require('../services/buyerDispoService');

const buyer = (over) => ({ id: over.id, user_id: 'user-1', is_active: true, phone: `+1512555${String(over.id).padStart(4, '0').slice(-4)}`, buy_box_states: [], buy_box_types: [], property_cities: [], buy_box_zips: [], max_price: null, min_price: null, ...over });

test('buyer input: phone to E.164, states upper-cased, bad values rejected', () => {
  const ok = normalizeBuyer({ name: ' Bea ', phone: '(512) 555-0199', email: 'BEA@X.COM', buy_box_states: 'tx, ok', buy_box_zips: '78701', min_price: '$50,000', max_price: '200000' });
  assert.deepStrictEqual(ok.errors, []);
  assert.strictEqual(ok.row.phone, '+15125550199');
  assert.strictEqual(ok.row.email, 'bea@x.com');
  assert.deepStrictEqual(ok.row.buy_box_states, ['TX', 'OK']);
  assert.strictEqual(ok.row.min_price, 50000);

  const bad = normalizeBuyer({ name: 'X', phone: '555-01', buy_box_states: 'Texas', buy_box_zips: '787', min_price: 300, max_price: 100 });
  assert.strictEqual(bad.errors.length, 4);
  assert.strictEqual(normalizeBuyer({}).errors[0], 'name is required');
});

test('matching respects state, city, zip, min and max price', async () => {
  S.buyers = [
    buyer({ id: 1 }),                                                  // buys anything
    buyer({ id: 2, buy_box_states: ['OK'] }),                           // wrong state
    buyer({ id: 3, property_cities: ['Dallas'] }),                      // wrong city
    buyer({ id: 4, buy_box_zips: ['78702'] }),                          // wrong zip
    buyer({ id: 5, max_price: 100000 }),                                // ask too high
    buyer({ id: 6, min_price: 400000 }),                                // ask below their floor
    buyer({ id: 7, buy_box_states: ['TX'], property_cities: ['austin'], buy_box_zips: ['78701'], min_price: 150000, max_price: 250000 }),
    buyer({ id: 8, is_tire_kicker: true }),
  ];
  const deal = { id: 'deal-1', user_id: 'user-1', property_state: 'TX', property_city: 'Austin', property_zip: '78701-1234', buyer_price: 200000 };
  const matched = (await matchBuyers(deal)).map(b => b.id).sort();
  assert.deepStrictEqual(matched, [1, 7]);
});

test('a blast offers each buyer once; re-running it texts nobody again', async () => {
  S.buyers = [buyer({ id: 1 }), buyer({ id: 7, buy_box_states: ['TX'] })];
  S.offers = []; S.inserts = []; S.enqueued = []; S.rpc = [];
  S.deal = { id: 'deal-1', user_id: 'user-1', property_state: 'TX', property_address: '12 Oak St', buyer_price: 200000 };

  const first = await startBuyerBlast('deal-1', 'user-1');
  assert.strictEqual(first.enqueued, 2);
  assert.strictEqual(S.offers.length, 2);
  assert.ok(S.offers.every(o => o.match_type === 'buy_box' && o.status === 'queued'));
  assert.ok(S.enqueued[0].body.includes('Fits your buy box'));

  const second = await startBuyerBlast('deal-1', 'user-1');
  assert.strictEqual(second.enqueued, 0);
  assert.strictEqual(S.enqueued.length, 2);
});

test('no buy-box match falls back to all active buyers without claiming a fit', async () => {
  S.buyers = [buyer({ id: 2, buy_box_states: ['OK'] })];
  S.offers = []; S.enqueued = [];
  S.deal = { id: 'deal-2', user_id: 'user-1', property_state: 'TX', property_address: '9 Elm St' };
  const out = await startBuyerBlast('deal-2', 'user-1');
  assert.strictEqual(out.usedFallback, true);
  assert.strictEqual(S.offers[0].match_type, 'fallback');
  assert.ok(!S.enqueued[0].body.includes('Fits your buy box'));
});

test('a YES is tied to an offered deal; several open deals means ask, not guess', () => {
  const offers = [
    { id: 'o1', deals: { property_address: '12 Oak St' } },
    { id: 'o2', deals: { property_address: '450 Maple Ave' } },
  ];
  assert.strictEqual(pickOfferForReply([], 'yes').kind, 'none');
  assert.strictEqual(pickOfferForReply([offers[0]], 'yes').offer.id, 'o1');
  assert.strictEqual(pickOfferForReply(offers, 'yes').kind, 'ambiguous');
  assert.strictEqual(pickOfferForReply(offers, 'yes, 450 Maple please').offer.id, 'o2');
  assert.strictEqual(pickOfferForReply(offers, 'yes 12 maple').kind, 'ambiguous');
});
