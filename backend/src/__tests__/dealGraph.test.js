// Run with:  node --test src/__tests__/
//
// Deal Understanding Engine (pure compose step): honest provenance for existing
// records, derived numbers from the calculation engine, operator edits as
// USER_PROVIDED, conflicts kept visible, and every UNKNOWN explained.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const file = require.resolve(path.join(__dirname, '..', 'config/supabase.js'));
require.cache[file] = { id: file, filename: file, loaded: true, exports: { from: () => ({}) } };

const G = require('../intelligence/dealGraph');

const records = (over = {}) => ({
  deal: { id: 'd1', lead_id: 'l1', property_address: '12 Oak St', property_city: 'Austin', property_state: 'TX', property_zip: '78701', status: 'negotiating', deal_type: 'wholesale', arv: 300000, repair_estimate: 40000, offer_price: 160000, seller_agreed_price: null, buyer_price: null, seller_name: 'Sam Seller', estimated_value: null, ...over.deal },
  lead: { id: 'l1', first_name: 'Sam', last_name: 'Seller', phone: '+15125550100', property_address: '12 Oak St', estimated_value: 210000, mortgage_balance: 90000, probate_case: true, consent: false, ...over.lead },
  buyer: null, owner: { company_name: 'Acme Homes' },
  lastCall: { motivation_score: 78, ai_summary: 'Wants to sell fast', created_at: '2026-09-10T10:00:00Z' },
  contracts: [], titleLogs: [], followUps: [], comps: [],
});
const noProvider = { record: null, value: null, rent: null, market: null };

test('existing record values are UNVERIFIED, operator deal terms USER_PROVIDED, call analysis INFERRED', () => {
  const rep = G.compose(records(), noProvider);
  assert.strictEqual(rep.financial.arv.status, 'UNVERIFIED');
  assert.strictEqual(rep.financial.arv.value, 300000);
  assert.strictEqual(rep.transaction.offer_price.status, 'USER_PROVIDED');
  assert.strictEqual(rep.people.seller.motivation_score.status, 'INFERRED');
  assert.strictEqual(rep.property.distress.probate.value, true);
  assert.strictEqual(rep.property.condition.status, 'UNKNOWN');
});

test('equity and MAO come from the calculation engine and inherit the weakest input status', () => {
  const rep = G.compose(records(), noProvider);
  assert.strictEqual(rep.financial.equity.value, 120000);
  assert.strictEqual(rep.financial.equity.status, 'UNVERIFIED', 'unverified inputs cannot produce a CALCULATED fact');
  assert.strictEqual(rep.financial.mao_calculated.value, 170000);
  assert.strictEqual(rep.financial.mao_calculated.calculation.name, 'wholesale_mao');
  assert.strictEqual(rep.financial.spread.status, 'UNKNOWN');
});

test('provider estimates beat unverified records; disagreements are recorded as conflicts', () => {
  const provider = { ...noProvider, value: { found: true, value: { value: 260000, status: 'ESTIMATED', source: 'RentCast', source_tier: 'licensed_provider', as_of: '2026-09-17T00:00:00Z', confidence: null }, comparables: [
    { address: '1 A St', price: 255000, price_type: 'listed', listing_status: 'Inactive', source: 'RentCast', retrieved_at: '2026-09-17T00:00:00Z' },
  ] } };
  const rep = G.compose(records(), provider);
  assert.strictEqual(rep.financial.as_is_value.value, 260000);
  assert.strictEqual(rep.financial.as_is_value.status, 'ESTIMATED');
  assert.ok(rep.conflicts.some(c => c.field === 'financial.as_is_value'));
  assert.deepStrictEqual(rep.financial.comparable_evidence.value, { sold: 0, listings: 1 });
});

test('operator edits become USER_PROVIDED and fill unknowns', () => {
  const rep = G.compose(records(), noProvider, { 'property.condition': { value: 'heavy rehab', set_at: '2026-09-17T00:00:00Z' }, 'transaction.asking_price': { value: 185000, set_at: '2026-09-17T00:00:00Z' } });
  assert.strictEqual(rep.property.condition.status, 'USER_PROVIDED');
  assert.strictEqual(rep.transaction.asking_price.value, 185000);
});

test('every unknown says why it matters and how to get it', () => {
  const rep = G.compose(records(), noProvider);
  const unknowns = G.collectUnknowns(rep);
  const sqft = unknowns.find(u => u.field === 'property.sqft');
  assert.ok(sqft && /value|rehab|rent/.test(sqft.why_it_matters) && sqft.how_to_get);
  assert.ok(unknowns.find(u => u.field === 'property.liens.summary'));
  assert.ok(unknowns.every(u => u.why_it_matters && u.how_to_get));
  assert.ok(!unknowns.some(u => u.field.startsWith('conflicts')));
});
