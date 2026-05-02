const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const WEBHOOK_URL = process.env.VAPI_WEBHOOK_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/vapi/webhook` : null);

async function sync() {
  console.log('Fetching phone numbers from Vapi...');
  const { data: vapiNumbers } = await axios.get('https://api.vapi.ai/phone-number', {
    headers: { Authorization: `Bearer ${VAPI_API_KEY}` },
  });
  const numbers = Array.isArray(vapiNumbers) ? vapiNumbers : (vapiNumbers?.results || []);
  console.log(`Found ${numbers.length} numbers in Vapi`);

  let userId, userEmail;
  // Try public users table first
  const { data: pubUsers } = await supabase.from('users').select('id, email').limit(1);
  if (pubUsers?.[0]?.id) {
    userId = pubUsers[0].id; userEmail = pubUsers[0].email;
  } else {
    // Fall back to auth.users
    const { data: authData } = await supabase.auth.admin.listUsers({ perPage: 1 });
    const authUser = authData?.users?.[0];
    if (!authUser) { console.error('No user found in users or auth.users'); process.exit(1); }
    userId = authUser.id; userEmail = authUser.email;
  }
  console.log(`Syncing to user: ${userEmail} (${userId})`);

  const { data: existing } = await supabase.from('phone_numbers').select('vapi_phone_number_id').eq('user_id', userId);
  const existingIds = new Set((existing || []).map(p => p.vapi_phone_number_id).filter(Boolean));
  console.log(`Already synced: ${existingIds.size} numbers`);

  // Always reset daily counts
  await supabase.from('phone_numbers').update({ daily_calls_made: 0, last_reset_date: new Date().toISOString().split('T')[0] }).eq('user_id', userId);
  console.log('Daily counts reset.');

  const toImport = numbers.filter(n => n.id && n.number && !existingIds.has(n.id));
  if (!toImport.length) {
    console.log('All numbers already synced.');
    const { data: all } = await supabase.from('phone_numbers').select('number, vapi_phone_number_id, health_status, is_active').eq('user_id', userId);
    console.log('Numbers in system:', JSON.stringify(all, null, 2));
    return;
  }

  if (WEBHOOK_URL) {
    await Promise.all(toImport.map(n =>
      axios.patch(`https://api.vapi.ai/phone-number/${n.id}`, { serverUrl: WEBHOOK_URL }, {
        headers: { Authorization: `Bearer ${VAPI_API_KEY}` },
      }).then(() => console.log(`Webhook set on ${n.number}`)).catch(e => console.warn(`Webhook failed for ${n.number}:`, e.message))
    ));
  }

  const records = toImport.map(n => ({
    id: uuidv4(),
    user_id: userId,
    number: n.number,
    friendly_name: n.name || n.number,
    area_code: n.number?.replace(/\D/g, '').slice(1, 4) || null,
    vapi_phone_number_id: n.id,
    health_status: 'healthy',
    is_active: true,
    daily_call_limit: 50,
    daily_calls_made: 0,
    spam_score: 100,
    last_reset_date: new Date().toISOString().split('T')[0],
  }));

  const { data: inserted, error } = await supabase.from('phone_numbers').insert(records).select();
  if (error) { console.error('Insert error:', error); process.exit(1); }
  console.log(`Imported ${inserted.length} numbers:`);
  inserted.forEach(n => console.log(`  ${n.number} → ${n.vapi_phone_number_id}`));
}

sync().catch(e => { console.error(e.message); process.exit(1); });
