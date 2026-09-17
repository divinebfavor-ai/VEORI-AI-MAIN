// Identify an uploaded image from its bytes, never from the client's Content-Type.
// A browser can claim any MIME type; "image/svg+xml" in particular can carry script,
// which becomes stored XSS on the public storage domain once the file is served.

const SIGNATURES = [
  { ext: 'png',  type: 'image/png',  test: b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: 'jpg',  type: 'image/jpeg', test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'gif',  type: 'image/gif',  test: b => b.slice(0, 6).toString('latin1') === 'GIF87a' || b.slice(0, 6).toString('latin1') === 'GIF89a' },
  { ext: 'webp', type: 'image/webp', test: b => b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP' },
  // HEIC/HEIF: what an iPhone camera produces.
  { ext: 'heic', type: 'image/heic', test: b => b.slice(4, 8).toString('latin1') === 'ftyp' && /^(heic|heix|hevc|heim|heis|hevm|mif1|msf1)$/.test(b.slice(8, 12).toString('latin1')) },
];

/** @returns {{ext:string,type:string}|null} null when the bytes are not a supported image. */
function sniffImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) return null;
  for (const s of SIGNATURES) { try { if (s.test(buffer)) return { ext: s.ext, type: s.type }; } catch { /* keep checking */ } }
  return null;
}

const ALLOWED_IMAGE_TYPES = SIGNATURES.map(s => s.type);

module.exports = { sniffImage, ALLOWED_IMAGE_TYPES };
