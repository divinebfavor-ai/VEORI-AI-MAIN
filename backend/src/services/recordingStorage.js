// ─── Call recording storage ──────────────────────────────────────────────────
// Seller call audio lives in the PRIVATE 'call-recordings' bucket. calls.recording_url
// holds a storage reference ("storage:call-recordings/<path>"), never a link that
// plays for whoever holds it. Playback goes through an authorized endpoint that
// checks the call belongs to the workspace and hands back a short-lived signed URL.
//
// Links from other hosts (Twilio fallback, old Vapi links) pass through unchanged.

const supabase = require('../config/supabase');

const BUCKET = 'call-recordings';
const REF_PREFIX = `storage:${BUCKET}/`;
const PUBLIC_MARKER = `/storage/v1/object/public/${BUCKET}/`;
const SIGNED_TTL_SECONDS = 60 * 60;

function toRef(path) {
  return `${REF_PREFIX}${path}`;
}

// The object path inside the bucket, or null when the value isn't one of ours.
// Also recognises the public URLs stored before the bucket went private.
function storagePath(value) {
  if (!value || typeof value !== 'string') return null;
  let path = null;
  if (value.startsWith(REF_PREFIX)) path = value.slice(REF_PREFIX.length);
  else {
    const i = value.indexOf(PUBLIC_MARKER);
    if (i !== -1) path = value.slice(i + PUBLIC_MARKER.length).split('?')[0];
  }
  if (!path) return null;
  try { path = decodeURIComponent(path); } catch { return null; }
  // Decoded first, so "%2e%2e" can't slip a path out of the bucket.
  if (path.split('/').some(seg => seg === '..' || seg === '')) return null;
  return path;
}

function isStored(value) {
  return storagePath(value) !== null;
}

// A URL the caller can play. Stored recordings get a signed URL (null if signing
// fails); anything else is returned as-is.
async function playableUrl(value, ttl = SIGNED_TTL_SECONDS) {
  const path = storagePath(value);
  if (!path) return value || null;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, ttl);
  if (error) {
    console.warn('[recordingStorage] sign failed:', error.message);
    return null;
  }
  return data?.signedUrl || null;
}

async function upload(path, buffer) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: 'audio/mpeg', upsert: true });
  if (error) throw error;
  return toRef(path);
}

module.exports = { BUCKET, REF_PREFIX, SIGNED_TTL_SECONDS, toRef, storagePath, isStored, playableUrl, upload };
