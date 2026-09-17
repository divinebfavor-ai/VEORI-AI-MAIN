// Run with:  node --test src/__tests__/
//
// Covers private call recordings: storage references and the old public URLs both
// resolve to an object path, paths that try to escape the bucket are refused, and
// only our own recordings are signed - other links pass through untouched.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const signed = [];
const file = require.resolve(path.join(__dirname, '..', 'config/supabase.js'));
require.cache[file] = {
  id: file, filename: file, loaded: true,
  exports: {
    storage: {
      from: (bucket) => ({
        createSignedUrl: async (p, ttl) => { signed.push({ bucket, p, ttl }); return { data: { signedUrl: `https://signed.example/${p}?token=t` }, error: null }; },
      }),
    },
  },
};

const rs = require('../services/recordingStorage');

test('storage references and legacy public URLs map to the object path', () => {
  assert.strictEqual(rs.toRef('CA1/RE1.mp3'), 'storage:call-recordings/CA1/RE1.mp3');
  assert.strictEqual(rs.storagePath('storage:call-recordings/CA1/RE1.mp3'), 'CA1/RE1.mp3');
  assert.strictEqual(
    rs.storagePath('https://x.supabase.co/storage/v1/object/public/call-recordings/CA1/RE1.mp3'),
    'CA1/RE1.mp3',
  );
});

test('other hosts, empty values and path escapes are not treated as ours', () => {
  assert.strictEqual(rs.storagePath('https://storage.vapi.ai/abc.wav'), null);
  assert.strictEqual(rs.storagePath(null), null);
  assert.strictEqual(rs.storagePath('storage:call-recordings/../voice-previews/a.mp3'), null);
  assert.strictEqual(rs.storagePath('storage:call-recordings//etc'), null);
  assert.strictEqual(rs.storagePath('storage:call-recordings/%2e%2e/voice-previews/a.mp3'), null);
  assert.strictEqual(rs.storagePath('storage:call-recordings/%E0%A4%A'), null);
});

test('only stored recordings are signed, for one hour', async () => {
  signed.length = 0;
  const url = await rs.playableUrl('storage:call-recordings/CA1/RE1.mp3');
  assert.ok(url.startsWith('https://signed.example/CA1/RE1.mp3'));
  assert.deepStrictEqual(signed, [{ bucket: 'call-recordings', p: 'CA1/RE1.mp3', ttl: 3600 }]);
  assert.strictEqual(await rs.playableUrl('https://storage.vapi.ai/abc.wav'), 'https://storage.vapi.ai/abc.wav');
  assert.strictEqual(await rs.playableUrl(null), null);
  assert.strictEqual(signed.length, 1);
});
