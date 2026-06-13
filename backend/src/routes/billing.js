/**
 * Billing — Stripe
 *
 * If STRIPE_SECRET_KEY is set → Stripe handles all checkouts.
 * (Flutterwave is the current live processor and runs on its own route,
 *  /api/fw-billing — see routes/flutterwaveBilling.js. This file is kept
 *  Stripe-ready for the planned switch to Stripe.)
 *
 * Stripe API docs: https://stripe.com/docs/api
 */
const express = require('express');
const router  = express.Router();
const { createClient } = require('@supabase/supabase-js');

let _supabase = null;
function getSupabase() {
  if (!_supabase) _supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  return _supabase;
}

const { requireAuth: auth } = require('../middleware/auth');

// ─── Plan config ──────────────────────────────────────────────────────────────
// stripePriceId = Stripe price ID
const PLANS = {
  founding_member: {
    stripePriceId:  process.env.STRIPE_FOUNDING_MEMBER_PRICE_ID || 'price_1Tb3xAAW61xZuN5nilAyqg7j',
    name:           'Founding Member',
    dials:          7000,
    amount:         39700,
    founding:       true,
  },
  starter: {
    stripePriceId:  process.env.STRIPE_STARTER_PRICE_ID || 'price_1Tb1UhAW61xZuN5nBiMP6Spu',
    name:           'Starter Plan',
    dials:          3000,
    amount:         49900,
  },
  growth: {
    stripePriceId:  process.env.STRIPE_GROWTH_PRICE_ID || 'price_1Tb1Y8AW61xZuN5nim5LCiud',
    name:           'Growth Plan',
    dials:          7000,
    amount:         99900,
  },
  pro: {
    stripePriceId:  process.env.STRIPE_PRO_PRICE_ID || 'price_1Tb1YBAW61xZuN5nD6W0YZgB',
    name:           'Pro Plan',
    dials:          15000,
    amount:         179900,
  },
  scale: {
    stripePriceId:  process.env.STRIPE_SCALE_PRICE_ID || 'price_1Tb1YEAW61xZuN5njVCI31UY',
    name:           'Scale Plan',
    dials:          30000,
    amount:         399900,
  },
  enterprise: {
    stripePriceId:  process.env.STRIPE_ENTERPRISE_PRICE_ID || 'price_1Tb1YFAW61xZuN5nQZ9zbss7',
    name:           'Enterprise Plan',
    dials:          50000,
    amount:         599900,
  },
};

function planByStripePriceId(priceId) {
  return Object.entries(PLANS).find(([, v]) => v.stripePriceId === priceId)?.[0] || null;
}

// ─── Stripe checkout ──────────────────────────────────────────────────────────
async function createStripeCheckout({ email, name, plan, planConfig }) {
  const Stripe  = require('stripe');
  const stripe  = Stripe(process.env.STRIPE_SECRET_KEY);
  const siteUrl = process.env.SITE_URL || process.env.APP_URL || 'https://veori.net';

  const session = await stripe.checkout.sessions.create({
    mode:                 'subscription',
    payment_method_types: ['card'],
    customer_email:       email,
    metadata:             { name, plan },
    line_items:           [{ price: planConfig.stripePriceId, quantity: 1 }],
    subscription_data:    { metadata: { name, plan } },
    success_url:          `${siteUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:           `${siteUrl}/#pricing`,
    allow_promotion_codes:      true,
    billing_address_collection: 'auto',
  });

  return session.url;
}

// ─── POST /api/billing/checkout ───────────────────────────────────────────────
router.post('/checkout', async (req, res) => {
  try {
    const { name, email, plan = 'founding_member' } = req.body;

    if (!email || !name) {
      return res.status(400).json({ error: 'Name and email are required.' });
    }

    const planConfig = PLANS[plan];
    if (!planConfig) {
      return res.status(400).json({ error: `Unknown plan: ${plan}` });
    }

    let url = null;

    if (process.env.STRIPE_SECRET_KEY) {
      url = await createStripeCheckout({ email, name, plan, planConfig });
    } else {
      return res.status(503).json({ error: 'Payment system not yet configured. Please contact support.' });
    }

    if (!url) throw new Error('No checkout URL returned');
    res.json({ url });
  } catch (err) {
    console.error('[billing/checkout]', err.message);
    res.status(500).json({ error: 'Failed to create checkout. Please try again or contact support.' });
  }
});

// Alias used in some frontend calls — identical logic, just a different path
router.post('/create-checkout-session', async (req, res) => {
  try {
    const plan = req.body.plan || req.body.planName?.toLowerCase() || 'founding_member';
    const { name, email } = req.body;

    if (!email || !name) return res.status(400).json({ error: 'Name and email are required.' });
    const planConfig = PLANS[plan];
    if (!planConfig) return res.status(400).json({ error: `Unknown plan: ${plan}` });

    let url = null;
    if (process.env.STRIPE_SECRET_KEY) {
      url = await createStripeCheckout({ email, name, plan, planConfig });
    } else {
      return res.status(503).json({ error: 'Payment system not yet configured.' });
    }
    if (!url) throw new Error('No checkout URL returned');
    res.json({ url });
  } catch (err) {
    console.error('[billing/create-checkout-session]', err.message);
    res.status(500).json({ error: 'Failed to create checkout. Please try again or contact support.' });
  }
});

// ─── POST /api/billing/portal ─────────────────────────────────────────────────
// Manage subscription — Stripe hosted billing portal
router.post('/portal', auth, async (req, res) => {
  try {
    const siteUrl = process.env.SITE_URL || process.env.APP_URL || 'https://veori.net';

    if (process.env.STRIPE_SECRET_KEY) {
      const Stripe  = require('stripe');
      const stripe  = Stripe(process.env.STRIPE_SECRET_KEY);
      const { data: profile } = await getSupabase()
        .from('users')
        .select('stripe_customer_id')
        .eq('id', req.user.id)
        .single();

      if (!profile?.stripe_customer_id) {
        return res.status(400).json({ error: 'No active subscription found.' });
      }

      const session = await stripe.billingPortal.sessions.create({
        customer:   profile.stripe_customer_id,
        return_url: `${siteUrl}/settings`,
      });
      return res.json({ url: session.url });
    }

    res.status(503).json({ error: 'Billing not configured.' });
  } catch (err) {
    console.error('[billing/portal]', err.message);
    res.status(500).json({ error: 'Failed to open billing portal.' });
  }
});

// ─── GET /api/billing/status ──────────────────────────────────────────────────
router.get('/status', auth, async (req, res) => {
  try {
    const { data: profile } = await getSupabase()
      .from('users')
      .select('stripe_customer_id, stripe_subscription_id, subscription_plan, subscription_status, subscription_current_period_end, monthly_dial_limit')
      .eq('id', req.user.id)
      .single();

    const hasSubscription = profile?.stripe_subscription_id;

    if (!hasSubscription) {
      return res.json({ subscribed: false, plan: null, status: 'none' });
    }

    const plan = profile.subscription_plan;
    res.json({
      subscribed:  ['active', 'trialing'].includes(profile.subscription_status),
      plan,
      status:      profile.subscription_status,
      periodEnd:   profile.subscription_current_period_end,
      dialLimit:   profile.monthly_dial_limit || PLANS[plan]?.dials || 0,
      planDetails: PLANS[plan]  || null,
      provider:    'stripe',
    });
  } catch (err) {
    console.error('[billing/status]', err.message);
    res.status(500).json({ error: 'Failed to get subscription status.' });
  }
});

// ─── GET /api/billing/plans ───────────────────────────────────────────────────
router.get('/plans', (_req, res) => {
  res.json({
    success:  true,
    provider: 'stripe',
    plans:    Object.entries(PLANS).map(([key, p]) => ({
      key,
      name:    p.name,
      price:   p.amount / 100,
      dials:   p.dials,
      popular: key === 'growth',
      founding: p.founding || false,
    })),
  });
});

// ─── POST /api/billing/webhook (Stripe) ──────────────────────────────────────
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(200).json({ received: true, note: 'Stripe not configured' });
  }
  try {
    const Stripe = require('stripe');
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const event  = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const email   = session.customer_email || session.customer_details?.email;
      const plan    = session.metadata?.plan || 'starter';
      const planCfg = PLANS[plan] || PLANS.starter;
      if (email) {
        const update = {
          stripe_customer_id:     session.customer,
          stripe_subscription_id: session.subscription,
          subscription_plan:      plan,
          subscription_status:    'active',
          monthly_dial_limit:     planCfg.dials,
          updated_at:             new Date().toISOString(),
        };
        const { data: existing } = await getSupabase().from('users').select('id').eq('email', email).maybeSingle();
        let userId = existing?.id || null;
        if (existing) {
          await getSupabase().from('users').update(update).eq('id', existing.id);
        } else {
          const { data: created } = await getSupabase().from('users').insert({ email, full_name: session.metadata?.name || '', ...update }).select('id').maybeSingle();
          userId = created?.id || null;
        }

        // Auto-provision phone number pool for the plan (fire and forget — mirrors Flutterwave flow)
        if (userId) {
          const { handlePlanUpgrade } = require('../services/numberProvisioning');
          handlePlanUpgrade(userId, plan)
            .then(result => console.log(`[Stripe webhook] Number provisioning for ${plan}:`, result))
            .catch(err => console.error('[Stripe webhook] Number provisioning failed:', err.message));
        }
      }
    }
    if (event.type === 'customer.subscription.deleted') {
      await getSupabase().from('users').update({ subscription_status: 'cancelled', monthly_dial_limit: 0, updated_at: new Date().toISOString() }).eq('stripe_customer_id', event.data.object.customer);
    }
    res.json({ received: true });
  } catch (err) {
    console.error('[Stripe webhook]', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

module.exports = router;
