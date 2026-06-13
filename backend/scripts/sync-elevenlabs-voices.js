/**
 * One-time / on-demand sync: pull the ElevenLabs voice catalog into the
 * veori_voice_library table so operators can browse & pick a caller voice.
 *
 * WHY: GET /api/v2/voices reads from veori_voice_library (no API spend per page
 * load). This script seeds/refreshes that table from the live ElevenLabs API.
 *
 * RUN:  ELEVENLABS_API_KEY=<key> node scripts/sync-elevenlabs-voices.js
 *   (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are read from backend/.env)
 *
 * Writes ONLY to veori_voice_library (new table). Touches no existing table.
 */

require('dotenv').config();

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_API_URL = process.env.ELEVENLABS_API_URL || 'https://api.elevenlabs.io/v1';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function die(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

(async () => {
  if (!ELEVENLABS_API_KEY) {
    die('Missing ELEVENLABS_API_KEY. Run:  ELEVENLABS_API_KEY=<key> node scripts/sync-elevenlabs-voices.js');
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    die('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend/.env');
  }

  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  console.log('→ Fetching ElevenLabs voice catalog…');
  const res = await fetch(`${ELEVENLABS_API_URL}/voices`, {
    headers: { 'xi-api-key': ELEVENLABS_API_KEY },
  });
  if (!res.ok) {
    die(`ElevenLabs /voices request failed: ${res.status} ${res.statusText}. Check ELEVENLABS_API_KEY.`);
  }
  const body = await res.json();
  const raw = Array.isArray(body?.voices) ? body.voices : [];
  if (!raw.length) die('ElevenLabs returned 0 voices.');

  const rows = raw
    .filter((v) => v.voice_id)
    .map((v) => {
      const labels = v.labels || {};
      return {
        voice_id:          v.voice_id,
        voice_name:        v.name || 'Unnamed',
        voice_preview_url: v.preview_url || null,
        voice_gender:      labels.gender || null,
        voice_accent:      labels.accent || null,
        voice_description: v.description || labels.description || labels.descriptive || labels.use_case || null,
        is_active:         true,
        updated_at:        new Date().toISOString(),
      };
    });

  console.log(`→ Upserting ${rows.length} voices into veori_voice_library…`);
  const { data, error } = await supabase
    .from('veori_voice_library')
    .upsert(rows, { onConflict: 'voice_id' })
    .select('voice_id, voice_name');

  if (error) die(`Upsert failed: ${error.message}`);

  console.log(`\n✅ Synced ${data ? data.length : rows.length} voices.\n`);
  (data || []).slice(0, 30).forEach((v) => console.log(`  ${v.voice_name}  (${v.voice_id})`));
  if ((data || []).length > 30) console.log(`  …and ${data.length - 30} more`);
  console.log('\nDone.');
})().catch((e) => die(e.message));
