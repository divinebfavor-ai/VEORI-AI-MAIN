#!/usr/bin/env node
/**
 * End-to-end verification for Twilio subaccount provisioning.
 *
 * Creates ONE real Twilio subaccount for a Solo-tier test user, confirms Twilio returned
 * an active SID, and confirms the SID was stored on the user record.
 *
 * Requirements:
 *   - TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN set in the environment (backend/.env).
 *   - TWILIO_SUBACCOUNT_MIGRATION.sql already applied (the twilio_subaccount_* columns).
 *
 * Usage:
 *   node scripts/verify-twilio-subaccount.js                 # creates a labeled test user
 *   node scripts/verify-twilio-subaccount.js --email=you@x   # uses an existing user
 *
 * This creates a REAL subaccount. Close it in the Twilio console afterward if it was
 * only a test. A2P registration is a separate later step and is NOT touched here.
 */
require('dotenv').config();
const crypto = require('crypto');
const supabase = require('../src/config/supabase');
const svc = require('../src/services/twilioSubaccountService');

(async () => {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    console.error('ABORT: TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are not set in the environment.');
    process.exit(1);
  }

  const emailArg = (process.argv.find(a => a.startsWith('--email=')) || '').split('=')[1];
  let userId, email, madeTestUser = false;

  if (emailArg) {
    const { data, error } = await supabase.from('users')
      .select('id, email, subscription_plan').eq('email', emailArg).single();
    if (error || !data) { console.error('ABORT: no user with email', emailArg); process.exit(1); }
    userId = data.id; email = data.email;
    if (!svc.isSubaccountTier(data.subscription_plan)) {
      console.log(`Note: user plan is '${data.subscription_plan}'; setting to 'solo' for this test.`);
      await supabase.from('users').update({ subscription_plan: 'solo' }).eq('id', userId);
    }
  } else {
    email = `twilio-subacct-test+${Date.now()}@veori.net`;
    const { data, error } = await supabase.from('users')
      .insert({ id: crypto.randomUUID(), email, full_name: 'Twilio Subaccount Test', password_hash: 'test-only', subscription_plan: 'solo', subscription_status: 'active' })
      .select('id').single();
    if (error) { console.error('ABORT: failed to create test user:', error.message); process.exit(1); }
    userId = data.id; madeTestUser = true;
    console.log(`Created test signup: ${email}  (${userId})`);
  }

  console.log(`\nProvisioning a real Twilio subaccount for ${email} ...`);
  const result = await svc.ensureSubaccountForUser(userId, 'solo');

  console.log('\n=== TWILIO RESULT ===');
  console.log(JSON.stringify(result, null, 2));

  const { data: after } = await supabase.from('users')
    .select('twilio_subaccount_sid, twilio_subaccount_status, twilio_subaccount_friendly_name, twilio_subaccount_created_at')
    .eq('id', userId).single();
  console.log('\n=== STORED ON USER RECORD ===');
  console.log(JSON.stringify(after, null, 2));

  const good = !!after?.twilio_subaccount_sid && /^AC[0-9a-fA-F]{32}$/.test(after.twilio_subaccount_sid);
  console.log(`\n${good ? 'VERIFIED' : 'FAILED'}: subaccount ${good ? 'created and SID stored' : 'not confirmed'}.`);
  console.log('Twilio console → Account → Subaccounts to view it.');
  console.log(`Cleanup: close the subaccount in Twilio if this was only a test${madeTestUser ? `, and delete test user ${userId}.` : '.'}`);
  process.exit(good ? 0 : 1);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
