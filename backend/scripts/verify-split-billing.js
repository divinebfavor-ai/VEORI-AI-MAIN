#!/usr/bin/env node
/**
 * Verify the bundled -> split billing transition on A2P approval.
 *
 * For an APPROVED (a2p_registration_step='active') test account, places the two separate
 * Stripe charges and confirms they process independently:
 *   1. Veori platform fee      (metadata.kind = platform_fee)
 *   2. Twilio usage passthrough (metadata.kind = twilio_usage)
 *
 * Run in STRIPE TEST MODE first (test STRIPE_SECRET_KEY + a test customer with a test card
 * on file). Requirements: STRIPE_SECRET_KEY, and the user must have stripe_customer_id +
 * a default card, monthly_allocation, and some outreach_used (so both charges are nonzero).
 *
 * Usage (via Railway so env is injected):
 *   railway run node scripts/verify-split-billing.js --email=customer@example.com
 */
require('dotenv').config();
const supabase = require('../src/config/supabase');
const split = require('../src/services/a2pSplitBillingService');

(async () => {
  if (!process.env.STRIPE_SECRET_KEY) { console.error('ABORT: STRIPE_SECRET_KEY not set.'); process.exit(1); }
  const mode = process.env.STRIPE_SECRET_KEY.startsWith('sk_live') ? 'LIVE' : 'TEST';
  console.log(`Stripe mode: ${mode}\n`);

  const email = (process.argv.find(a => a.startsWith('--email=')) || '').split('=')[1];
  const uidArg = (process.argv.find(a => a.startsWith('--user-id=')) || '').split('=')[1];
  let userId = uidArg;
  if (!userId && email) {
    const { data } = await supabase.from('users').select('id').eq('email', email).single();
    if (!data) { console.error('ABORT: no user with email', email); process.exit(1); }
    userId = data.id;
  }
  if (!userId) { console.error('ABORT: pass --email= or --user-id='); process.exit(1); }

  const { data: before } = await supabase.from('users')
    .select('a2p_registration_step, a2p_billing_mode, stripe_customer_id, monthly_allocation, outreach_used')
    .eq('id', userId).single();
  console.log('Before:', JSON.stringify(before));
  console.log('Expected charges:', JSON.stringify(split.computeCharges(before)), '\n');

  const result = await split.applySplitOnApproval(userId);
  console.log('=== RESULT ===');
  console.log(JSON.stringify(result, null, 2));

  const { data: after } = await supabase.from('users')
    .select('a2p_billing_mode, a2p_split_activated_at, a2p_platform_charge_id, a2p_usage_charge_id')
    .eq('id', userId).single();
  console.log('\n=== STORED ===');
  console.log(JSON.stringify(after, null, 2));

  const twoSeparate = result.ok && after.a2p_platform_charge_id && after.a2p_usage_charge_id
    && after.a2p_platform_charge_id !== after.a2p_usage_charge_id;
  console.log(`\n${twoSeparate ? 'VERIFIED' : 'INCOMPLETE'}: platform fee and usage charged as ${twoSeparate ? 'two separate charges' : 'NOT both separate - see reason above'}.`);
  process.exit(result.ok ? 0 : 1);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
