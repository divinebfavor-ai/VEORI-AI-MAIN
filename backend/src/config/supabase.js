// ─── Supabase Client ──────────────────────────────────────────────────────────
// Load .env only in non-production (Railway injects env vars at runtime)
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mmlfmknklsxzasaybbrp.supabase.co';
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_KEY) {
  console.error('[Supabase] FATAL: No Supabase key found. Set SUPABASE_SERVICE_ROLE_KEY in Railway.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

module.exports = supabase;
