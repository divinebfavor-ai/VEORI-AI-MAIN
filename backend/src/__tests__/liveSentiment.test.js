// Run with:  node --test src/__tests__/
// Live call sentiment: per-utterance labels and the running read shown in Live Monitor.

const test = require('node:test');
const assert = require('node:assert');
const { scoreUtterance, nextReading } = require('../services/liveSentiment');

test('utterances get the expected label', () => {
  assert.strictEqual(scoreUtterance('we are behind on payments, how much would you pay').label, 'Motivated');
  assert.strictEqual(scoreUtterance("I'm not sure, I need to talk to my wife").label, 'Hesitant');
  assert.strictEqual(scoreUtterance('not interested').label, 'Cold');
  assert.strictEqual(scoreUtterance('is this a scam').label, 'Hostile');
  assert.strictEqual(scoreUtterance('hello who is this').label, 'Neutral');
  assert.strictEqual(scoreUtterance('').score, 50);
});

test('hostility shows immediately even after a warm call', () => {
  let r = null;
  for (const t of ['I need to sell', 'how fast can you close']) r = nextReading(r, t, 1);
  assert.strictEqual(r.label, 'Motivated');
  r = nextReading(r, 'this is a scam, I am calling my lawyer', 3);
  assert.strictEqual(r.label, 'Hostile');
  assert.strictEqual(r.trend, 'cooling');
});

test('the running score moves gradually and reports its trend', () => {
  let r = nextReading(null, 'hello', 1);
  assert.strictEqual(r.score, 50);
  r = nextReading(r, 'what would you offer for it', 2);
  assert.ok(r.score > 50 && r.trend === 'warming');
});
