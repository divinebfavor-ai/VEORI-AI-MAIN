#!/usr/bin/env node
/**
 * Real end-to-end verification for A2P 10DLC registration (per-customer brand).
 *
 * Repeatedly advances the state machine for one user, printing each phase, until it hits
 * an async approval gate (brand PENDING) or completes. Full ACTIVE status arrives LATER
 * (TCR vetting is async, hours to days) - re-run this to keep advancing after approvals.
 *
 * Requirements:
 *   - TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN in the environment (Railway).
 *   - TWILIO_PRIMARY_CUSTOMER_PROFILE_SID set (Veori's approved primary profile).
 *   - TWILIO_A2P_MIGRATION.sql applied.
 *   - The user must already have a Twilio subaccount and COMPLETE business data
 *     (run with --email and the script prints any missing fields).
 *
 * Usage:
 *   node scripts/verify-a2p-registration.js --email=customer@example.com
 *
 * This incurs real TCR fees at the brand + campaign steps. A2P only - does not send SMS.
 */
require('dotenv').config();
const supabase = require('../src/config/supabase');
const a2p = require('../src/services/a2pRegistrationService');

(async () => {
  for (const k of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PRIMARY_CUSTOMER_PROFILE_SID']) {
    if (!process.env[k]) { console.error(`ABORT: ${k} is not set in the environment.`); process.exit(1); }
  }
  const email = (process.argv.find(a => a.startsWith('--email=')) || '').split('=')[1];
  if (!email) { console.error('ABORT: pass --email=<existing user email>'); process.exit(1); }

  const { data: user, error } = await supabase.from('users').select('id, email, subscription_plan, twilio_subaccount_sid').eq('email', email).single();
  if (error || !user) { console.error('ABORT: no user with email', email); process.exit(1); }
  if (!a2p.STEPS) { /* noop */ }
  console.log(`User ${user.email} (${user.id}) plan=${user.subscription_plan} subaccount=${user.twilio_subaccount_sid || 'NONE'}\n`);

  // Advance until we reach an async wait, completion, or a blocker. Cap iterations.
  for (let i = 0; i < 6; i++) {
    const r = await a2p.advance(user.id);
    console.log(`advance #${i + 1}:`, JSON.stringify(r));
    if (!r.ok) { console.error('\nBLOCKED:', r.reason, r.missing ? '\nmissing fields: ' + r.missing.join(', ') : ''); process.exit(1); }
    if (r.done) { console.log('\nVERIFIED: registration reached ACTIVE.'); break; }
    if (r.waiting) { console.log(`\nWAITING on TCR approval (${r.step}). Re-run this later to continue.`); break; }
  }

  const { data: after } = await supabase.from('users')
    .select('a2p_registration_step, a2p_customer_profile_sid, a2p_trust_bundle_sid, a2p_brand_sid, a2p_brand_status, a2p_campaign_sid, a2p_campaign_status, a2p_messaging_service_sid, a2p_last_error')
    .eq('id', user.id).single();
  console.log('\n=== A2P STATE ON USER RECORD ===');
  console.log(JSON.stringify(after, null, 2));
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
