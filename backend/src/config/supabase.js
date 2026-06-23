const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn('⚠️  SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — database features disabled');
}

// NOTE (connection scaling): the supabase-js client has no pool-size knob — it
// opens HTTP/PostgREST connections under the hood and relies on the database's
// connection ceiling. To survive many concurrent operators, point SUPABASE_URL's
// database access at the Supabase **transaction pooler** (PgBouncer, port 6543)
// rather than the direct 5432 connection. This is a Railway/Supabase config
// change (no code change needed here) — the singleton client below is correct.
const supabase = createClient(
  SUPABASE_URL  || 'https://placeholder.supabase.co',
  SUPABASE_KEY  || 'placeholder-key',
  {
    auth: { persistSession: false },
    global: { headers: { 'x-application': 'veori-ai' } },
  }
);

// Test connection
if (SUPABASE_URL && SUPABASE_KEY) {
  supabase.from('users').select('count', { count: 'exact', head: true })
    .then(({ error }) => {
      if (error) console.warn('⚠️  Supabase connection test failed:', error.message);
      else console.log('✅ Supabase connected');
    });
}

module.exports = supabase;
