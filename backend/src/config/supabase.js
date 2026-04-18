const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn('⚠️  SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — database features disabled');
}

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
