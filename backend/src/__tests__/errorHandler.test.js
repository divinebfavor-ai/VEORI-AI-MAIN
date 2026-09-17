// Run with:  node --test src/__tests__/
//
// Input-caused database errors become 4xx with a plain message instead of a 500.

const test = require('node:test');
const assert = require('node:assert');
const { errorHandler } = require('../middleware/errorHandler');

function run(err) {
  const res = { code: null, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  const warn = console.warn, error = console.error;
  console.warn = () => {}; console.error = () => {};
  try { errorHandler(err, { method: 'GET', path: '/x' }, res, () => {}); } finally { console.warn = warn; console.error = error; }
  return res;
}

test('bad uuid, duplicate and missing row map to 400, 409 and 404', () => {
  assert.deepStrictEqual([run({ code: '22P02', message: 'invalid input syntax for type uuid' }).code], [400]);
  assert.strictEqual(run({ code: '23505', message: 'duplicate key' }).code, 409);
  assert.strictEqual(run({ code: 'PGRST116', message: 'JSON object requested' }).code, 404);
  assert.strictEqual(run({ code: '22P02' }).body.error, 'Invalid id or value');
});

test('malformed JSON is a 400; real faults stay 500', () => {
  assert.strictEqual(run(Object.assign(new SyntaxError('Unexpected token'), { type: 'entity.parse.failed', status: 400 })).code, 400);
  assert.strictEqual(run(new Error('boom')).code, 500);
  assert.strictEqual(run(Object.assign(new Error('x'), { code: '22P02', status: 422 })).code, 422, 'explicit status wins');
});
