// Run with:  node --test src/__tests__/
// White label: only real raster images are accepted as logos (checked by content).
const test = require('node:test');
const assert = require('node:assert');
const { sniffImage } = require('../services/brandingService');

test('logo type is decided by file content, not name', () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(12)]);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
  assert.deepStrictEqual(sniffImage(png), { ext: 'png', type: 'image/png' });
  assert.deepStrictEqual(sniffImage(jpg), { ext: 'jpg', type: 'image/jpeg' });
  assert.deepStrictEqual(sniffImage(webp), { ext: 'webp', type: 'image/webp' });
  assert.strictEqual(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="x"/>')), null);
  assert.strictEqual(sniffImage(Buffer.from('GIF89a..........')), null);
  assert.strictEqual(sniffImage(Buffer.alloc(3)), null);
});
