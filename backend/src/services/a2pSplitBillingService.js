/**
 * Split billing on A2P approval
 *
 * While a customer's A2P registration is pending, billing is "bundled" (Veori absorbs the
 * Twilio cost). Once APPROVED, billing switches to "split": the customer is charged, on
 * Veori's Stripe, as TWO SEPARATE charges:
 *   1. Platform fee   - Veori's revenue ($65 per 1,000 outreach of their plan allocation)
 *   2. Twilio usage   - passthrough of their metered usage ($30.50 per 1,000 outreach used)
 *
 * Twilio cannot bill a subaccount's card directly (subaccount usage bills to Veori's master
 * account), so BOTH charges run through Veori's Stripe against the customer's card-on-file;
 * Veori pays Twilio for the subaccount. The two charges are distinct Stripe PaymentIntents
 * so they reconcile separately.
 *
 * Flag-gated by A2P_SPLIT_BILLING_ENABLED. Idempotent: only flips a customer once.
 */

const supabase = require('../config/supabase');

const RATES = { platformPerK: 65, usagePerK: 30.5 }; // USD per 1,000 outreach

const round2 = (n) => Math.round(n * 100) / 100;

// Pure + exported: the two amounts, from plan allocation (platform) and actual usage (passthrough).
function computeCharges(user, rates = RATES) {
  const planVolume = Math.max(0, Number(user.monthly_allocation) || 0);
  const usedVolume = Math.max(0, Number(user.outreach_used) || 0);
  return {
    platformFee: round2((planVolume / 1000) * rates.platformPerK),
    usageCost:   round2((usedVolume / 1000) * rates.usagePerK),
  };
}

function realStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not configured');
  return require('stripe')(key);
}

// The customer's default card. Returns a payment-method id or null.
async function defaultPaymentMethod(stripe, customerId) {
  const cust = await stripe.customers.retrieve(customerId);
  const pm = cust && cust.invoice_settings && cust.invoice_settings.default_payment_method;
  if (pm) return typeof pm === 'string' ? pm : pm.id;
  const list = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 1 });
  return (list && list.data && list.data[0] && list.data[0].id) || null;
}

async function chargeOnce(stripe, { customerId, paymentMethod, dollars, description, kind, userId, idempotencyKey }) {
  return stripe.paymentIntents.create(
    {
      amount:         Math.round(dollars * 100),
      currency:       'usd',
      customer:       customerId,
      payment_method: paymentMethod,
      off_session:    true,
      confirm:        true,
      description,
      metadata:       { kind, user_id: userId },
    },
    // Stripe-enforced deduplication. Without this, a retry or a concurrent call
    // placed a SECOND real charge on a live card - and these are large
    // (the platform fee is $65 per 1,000 of plan volume, i.e. $3,250 on a 50k
    // plan). The key is deterministic per user+charge-kind+activation, so any
    // repeat of the same logical charge collapses onto the first.
    idempotencyKey ? { idempotencyKey } : undefined
  );
}

/**
 * On approval, switch a customer from bundled to split billing and place the two separate
 * charges. Idempotent, best-effort-safe. `stripeFactory` is injectable for tests.
 *
 * @returns {Promise<{ok, skipped?, reason?, platformFee?, usageCost?, platformChargeId?, usageChargeId?}>}
 */
async function applySplitOnApproval(userId, { stripeFactory = realStripe, now = new Date() } = {}) {
  const { data: u, error } = await supabase
    .from('users')
    .select('id, email, a2p_registration_step, a2p_billing_mode, stripe_customer_id, monthly_allocation, outreach_used')
    .eq('id', userId)
    .single();
  if (error) throw error;
  if (!u) return { ok: false, skipped: true, reason: 'user not found' };

  if (u.a2p_registration_step !== 'active') return { ok: false, skipped: true, reason: 'A2P not approved yet' };
  if (u.a2p_billing_mode === 'split')       return { ok: false, skipped: true, reason: 'already on split billing' };
  if (!u.stripe_customer_id)                return { ok: false, skipped: true, reason: 'no Stripe customer / card on file' };

  const stripe = stripeFactory();
  const pm = await defaultPaymentMethod(stripe, u.stripe_customer_id);
  if (!pm) return { ok: false, skipped: true, reason: 'no default payment method on the Stripe customer' };

  const { platformFee, usageCost } = computeCharges(u);

  // CLAIM BEFORE CHARGING. The 'already on split' guard above was read at the
  // top of this function but the flag was only written at the BOTTOM, after both
  // charges - so two concurrent invocations both passed the guard and both
  // charged the card. This conditional update is atomic: exactly one caller can
  // move the row out of its current mode, and `.select()` tells us whether we
  // were that caller.
  const { data: claimed, error: claimErr } = await supabase
    .from('users')
    .update({ a2p_billing_mode: 'split', a2p_split_activated_at: now.toISOString() })
    .eq('id', userId)
    .neq('a2p_billing_mode', 'split')
    .select('id');
  if (claimErr) throw claimErr;
  if (!claimed || claimed.length === 0) {
    return { ok: false, skipped: true, reason: 'already on split billing (claimed concurrently)' };
  }

  // Deterministic per user + charge kind + activation month, so a retry inside
  // Stripe's idempotency window collapses onto the original charge rather than
  // creating a second one.
  const cycle = now.toISOString().slice(0, 7);   // YYYY-MM
  const keyFor = (kind) => `veori:a2p:${kind}:${userId}:${cycle}`;

  // Two SEPARATE charges - never combined.
  let platformChargeId = null, usageChargeId = null;
  try {
    if (platformFee > 0) {
      const pi = await chargeOnce(stripe, { customerId: u.stripe_customer_id, paymentMethod: pm, dollars: platformFee,
        description: 'Veori platform fee', kind: 'platform_fee', userId, idempotencyKey: keyFor('platform_fee') });
      platformChargeId = pi.id;
    }
    if (usageCost > 0) {
      const pi = await chargeOnce(stripe, { customerId: u.stripe_customer_id, paymentMethod: pm, dollars: usageCost,
        description: 'Twilio usage (passthrough)', kind: 'twilio_usage', userId, idempotencyKey: keyFor('twilio_usage') });
      usageChargeId = pi.id;
    }
  } catch (chargeErr) {
    // Release the claim so a genuine retry can run. Without this, a declined
    // card would leave the account marked as split-billed but never charged -
    // silently free service. Any charge that DID succeed before the failure is
    // protected from duplication by its idempotency key on the retry.
    await supabase.from('users')
      .update({ a2p_billing_mode: u.a2p_billing_mode, a2p_split_activated_at: null })
      .eq('id', userId);
    throw chargeErr;
  }

  await supabase.from('users').update({
    a2p_platform_charge_id: platformChargeId,
    a2p_usage_charge_id:    usageChargeId,
  }).eq('id', userId);

  return { ok: true, platformFee, usageCost, platformChargeId, usageChargeId };
}

module.exports = { RATES, computeCharges, realStripe, applySplitOnApproval };
