// Run with:  node --test src/__tests__/
//
// Phone normalization and the shared DNC lookup: E.164 so inbound texts match,
// and a lookup that fails or finds duplicate rows must block contact.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const src = (p) => path.join(__dirname, '..', p);
const S = { rows: [], error: null, askedFor: null };
const file = require.resolve(src('config/supabase.js'));
require.cache[file] = { id: file, filename: file, loaded: true, exports: {
  from: () => {
    const b = {
      select() { return b; },
      eq(k, v) { S.askedFor = v; return b; },
      limit() { return Promise.resolve({ data: S.error ? null : S.rows, error: S.error }); },
    };
    return b;
  },
} };

const { toE164 } = require('../utils/phone');
const { checkInternalDnc } = require('../services/dncCheck');

test('US numbers normalize to E.164; anything else is rejected', () => {
  assert.strictEqual(toE164('7045550100'), '+17045550100');
  assert.strictEqual(toE164('(704) 555-0100'), '+17045550100');
  assert.strictEqual(toE164('+1 704-555-0100'), '+17045550100');
  assert.strictEqual(toE164('1-704-555-0100'), '+17045550100');
  assert.strictEqual(toE164('555-0100'), null);
  assert.strictEqual(toE164('0045550100'), null);  // area code can't start with 0
  assert.strictEqual(toE164('7041550100'), null);  // exchange can't start with 1
  assert.strictEqual(toE164(null), null);
});

test('DNC lookup searches the E.164 form of whatever it is given', async () => {
  S.rows = []; S.error = null;
  await checkInternalDnc('(704) 555-0100');
  assert.strictEqual(S.askedFor, '+17045550100');
});

test('two DNC rows for one number still count as listed', async () => {
  S.rows = [{ id: 'a' }, { id: 'b' }]; S.error = null;
  assert.deepStrictEqual(await checkInternalDnc('7045550100'), { onList: true, errored: false });
});

test('a failed lookup blocks contact', async () => {
  S.rows = []; S.error = { message: 'timeout' };
  assert.deepStrictEqual(await checkInternalDnc('7045550100'), { onList: true, errored: true });
});

test('a clear number is not listed', async () => {
  S.rows = []; S.error = null;
  assert.deepStrictEqual(await checkInternalDnc('7045550100'), { onList: false, errored: false });
});
