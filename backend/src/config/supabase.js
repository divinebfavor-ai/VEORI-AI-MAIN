// ─── Supabase Client ──────────────────────────────────────────────────────────
// dotenv is loaded ONCE in index.js — never here
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mmlfmknklsxzasaybbrp.supabase.co';
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  '';

if (!SUPABASE_KEY) {
  // Warn but never exit — Railway may still be injecting env vars
  console.warn('[Supabase] WARNING: No key found. Set SUPABASE_SERVICE_ROLE_KEY in Railway dashboard.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY || 'placeholder', {
  auth: { autoRefreshToken: false, persistSession: false },
});

module.exports = supabase;
