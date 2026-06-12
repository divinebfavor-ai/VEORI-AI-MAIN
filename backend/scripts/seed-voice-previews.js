/**
 * One-time seeder: fetch Vapi native-voice preview clips and host them
 * permanently in Supabase Storage (bucket: voice-previews).
 *
 * WHY: Vapi's voice preview URLs are AWS SigV4-signed S3 links that expire
 * after 1 hour, so they can't be hard-coded. We download each clip once and
 * re-host it on a public Supabase bucket, then paste the permanent public
 * URLs into VAPI_VOICES.previewUrl.
 *
 * AUTH: pass your Vapi token at runtime so nothing secret is committed:
 *   VAPI_TOKEN=<your-vapi-private-api-key-or-org-token> node scripts/seed-voice-previews.js
 *
 * Supabase service-role key is read from .env (SUPABASE_SERVICE_ROLE_KEY).
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const VAPI_TOKEN = process.env.VAPI_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'voice-previews';

// The 14 voices we surface in the Settings picker (must match VAPI_VOICES order/names).
const WANTED = [
  'Clara', 'Godfrey', 'Elliot', 'Savannah', 'Nico', 'Kai', 'Emma',
  'Sagar', 'Neil', 'Layla', 'Sid', 'Naina', 'Gustavo', 'Rohan',
];

function die(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Retry a flaky async op (transient network/fetch failures) a few times.
async function withRetry(label, fn, attempts = 6) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts) {
        process.stdout.write(`(retry ${i}/${attempts - 1}) `);
        await sleep(1000 * i);
      }
    }
  }
  throw lastErr;
}

(async () => {
  if (!VAPI_TOKEN) {
    die('Missing VAPI_TOKEN. Run:  VAPI_TOKEN=<your-vapi-token> node scripts/seed-voice-previews.js');
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    die('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 1) Fetch the full Vapi native voice library (one authenticated call).
  console.log('→ Fetching Vapi voice library…');
  const library = await withRetry('fetch voice library', async () => {
    const libRes = await fetch(
      'https://api.vapi.ai/voice-library/vapi?limit=300&version=1&currentVoiceId=Elliot',
      { headers: { Authorization: `Bearer ${VAPI_TOKEN}` } }
    );
    if (!libRes.ok) {
      throw new Error(`Voice-library request failed: ${libRes.status} ${libRes.statusText}. ` +
        `Check that VAPI_TOKEN is your Vapi private API key or dashboard org token.`);
    }
    return libRes.json();
  });
  const voices = Array.isArray(library) ? library : (library.results || library.data || []);
  if (!voices.length) die('Voice library returned 0 voices.');

  // Index by name (case-insensitive).
  const byName = new Map(voices.map(v => [String(v.name).toLowerCase(), v]));

  // Some Vapi voices (e.g. Gustavo, Rohan) exist but have no hosted preview clip.
  // Those are skipped and left as previewUrl:null — the frontend already hides the
  // preview button when previewUrl is falsy.
  const missing = WANTED.filter(n => !byName.get(n.toLowerCase())?.previewUrl);
  if (missing.length) {
    console.log(`⚠️  No preview clip available for: ${missing.join(', ')} — they will stay previewUrl:null.`);
  }
  const seedable = WANTED.filter(n => byName.get(n.toLowerCase())?.previewUrl);

  // 2) For each seedable voice: download the clip, upload to Supabase, collect public URL.
  const results = [];
  for (const name of seedable) {
    const v = byName.get(name.toLowerCase());
    const path = `${name.toLowerCase()}.wav`;
    process.stdout.write(`→ ${name}: downloading… `);

    const buf = await withRetry(`download ${name}`, async () => {
      const clipRes = await fetch(v.previewUrl);
      if (!clipRes.ok) throw new Error(`${clipRes.status} ${clipRes.statusText}`);
      return Buffer.from(await clipRes.arrayBuffer());
    });

    process.stdout.write('uploading… ');
    await withRetry(`upload ${name}`, async () => {
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, buf, { contentType: 'audio/wav', upsert: true });
      if (upErr) throw new Error(upErr.message);
    });

    const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path);
    results.push({ name, publicUrl });
    console.log('done');
  }

  // 3) Print a ready-to-paste VAPI_VOICES block.
  console.log('\n✅ All 14 clips hosted. Paste these previewUrl values into VAPI_VOICES:\n');
  for (const r of results) {
    console.log(`  ${r.name.padEnd(9)} -> ${r.publicUrl}`);
  }
  console.log('\nDone.');
})();
