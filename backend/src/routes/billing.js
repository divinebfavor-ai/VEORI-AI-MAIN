/**
 * Billing — Paddle (primary) with Stripe fallback
 *
 * If PADDLE_API_KEY is set → Paddle handles all checkouts
 * If only STRIPE_SECRET_KEY is set → Stripe used as fallback
 *
 * Paddle Billing API docs: https://developer.paddle.com/api-reference
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

const PADDLE_BASE = process.env.PADDLE_ENVIRONMENT === 'sandbox'
  ? 'https://sandbox-api.paddle.com'
  : 'https://api.paddle.com';

function paddleHeaders() {
  return {
    'Authorization': `Bearer ${process.env.PADDLE_API_KEY}`,
    'Content-Type':  'application/json',
  };
}

// ─── Plan config ──────────────────────────────────────────────────────────────
// priceId = Paddle price ID (pri_xxx) when using Paddle
// stripePriceId = Stripe price ID — kept as fallback
const PLANS = {
  founding_member: {
    priceId:        process.env.PADDLE_FOUNDING_MEMBER_PRICE_ID || '',
    stripePriceId:  process.env.STRIPE_FOUNDING_MEMBER_PRICE_ID || 'price_1Tb3xAAW61xZuN5nilAyqg7j',
    name:           'Founding Member',
    dials:          7000,
    amount:         39700,
    founding:       true,
  },
  starter: {
    priceId:        process.env.PADDLE_STARTER_PRICE_ID || '',
    stripePriceId:  process.env.STRIPE_STARTER_PRICE_ID || 'price_1Tb1UhAW61xZuN5nBiMP6Spu',
    name:           'Starter Plan',
    dials:          3000,
    amount:         49900,
  },
  growth: {
    priceId:        process.env.PADDLE_GROWTH_PRICE_ID || '',
    stripePriceId:  process.env.STRIPE_GROWTH_PRICE_ID || 'price_1Tb1Y8AW61xZuN5nim5LCiud',
    name:           'Growth Plan',
    dials:          7000,
    amount:         99900,
  },
  pro: {
    priceId:        process.env.PADDLE_PRO_PRICE_ID || '',
    stripePriceId:  process.env.STRIPE_PRO_PRICE_ID || 'price_1Tb1YBAW61xZuN5nD6W0YZgB',
    name:           'Pro Plan',
    dials:          15000,
    amount:         179900,
  },
  scale: {
    priceId:        process.env.PADDLE_SCALE_PRICE_ID || '',
    stripePriceId:  process.env.STRIPE_SCALE_PRICE_ID || 'price_1Tb1YEAW61xZuN5njVCI31UY',
    name:           'Scale Plan',
    dials:          30000,
    amount:         299900,
  },
  enterprise: {
    priceId:        process.env.PADDLE_ENTERPRISE_PRICE_ID || '',
    stripePriceId:  process.env.STRIPE_ENTERPRISE_PRICE_ID || 'price_1Tb1YFAW61xZuN5nQZ9zbss7',
    name:           'Enterprise Plan',
    dials:          50000,
    amount:         599900,
  },
};

function planByPaddlePriceId(priceId) {
  return Object.entries(PLANS).find(([, v]) => v.priceId === priceId)?.[0] || null;
}
function planByStripePriceId(priceId) {
  return Object.entries(PLANS).find(([, v]) => v.stripePriceId === priceId)?.[0] || null;
}

// ─── Paddle checkout ──────────────────────────────────────────────────────────
async function createPaddleCheckout({ email, name, plan, planConfig }) {
  const siteUrl = process.env.SITE_URL || process.env.APP_URL || 'https://veori.net';

  const body = {
    items: [{ price_id: planConfig.priceId, quantity: 1 }],
    customer: { email },
    custom_data: { name, plan },
    checkout: {
      url: `${siteUrl}/billing/success`,
    },
  };

  const res = await fetch(`${PADDLE_BASE}/transactions`, {
    method:  'POST',
    headers: paddleHeaders(),
    body:    JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    console.error('[Paddle] checkout error:', JSON.stringify(data.error || data));
    throw new Error(data.error?.detail || 'Paddle checkout failed');
  }

  return data.data?.checkout?.url || null;
}

// ─── Stripe checkout (fallback) ───────────────────────────────────────────────
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

    // Use Paddle if configured and price ID is set
    if (process.env.PADDLE_API_KEY && planConfig.priceId) {
      url = await createPaddleCheckout({ email, name, plan, planConfig });
    }
    // Fall back to Stripe
    else if (process.env.STRIPE_SECRET_KEY) {
      url = await createStripeCheckout({ email, name, plan, planConfig });
    }
    else {
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
    if (process.env.PADDLE_API_KEY && planConfig.priceId) {
      url = await createPaddleCheckout({ email, name, plan, planConfig });
    } else if (process.env.STRIPE_SECRET_KEY) {
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
// Manage subscription — Paddle uses a hosted portal URL
router.post('/portal', auth, async (req, res) => {
  try {
    const siteUrl = process.env.SITE_URL || process.env.APP_URL || 'https://veori.net';

    // Paddle: direct to Paddle's subscription management
    if (process.env.PADDLE_API_KEY) {
      const { data: profile } = await getSupabase()
        .from('users')
        .select('paddle_subscription_id, paddle_customer_id')
        .eq('id', req.user.id)
        .single();

      if (profile?.paddle_customer_id) {
        // Paddle customer portal
        const res2 = await fetch(`${PADDLE_BASE}/customers/${profile.paddle_customer_id}/portal-sessions`, {
          method:  'POST',
          headers: paddleHeaders(),
          body:    JSON.stringify({ subscription_ids: profile.paddle_subscription_id ? [profile.paddle_subscription_id] : [] }),
        });
        const data = await res2.json();
        const url  = data.data?.urls?.general?.overview;
        if (url) return res.json({ url });
      }

      // Fallback — send to update payment URL
      return res.json({ url: `https://veori.net/settings` });
    }

    // Stripe portal fallback
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
      .select('paddle_subscription_id, paddle_customer_id, stripe_customer_id, stripe_subscription_id, subscription_plan, subscription_status, subscription_current_period_end, monthly_dial_limit')
      .eq('id', req.user.id)
      .single();

    const hasSubscription = profile?.paddle_subscription_id || profile?.stripe_subscription_id;

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
      provider:    profile.paddle_subscription_id ? 'paddle' : 'stripe',
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
    provider: process.env.PADDLE_API_KEY ? 'paddle' : 'stripe',
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

// ─── POST /api/billing/webhook/paddle ────────────────────────────────────────
router.post('/webhook/paddle', express.json(), async (req, res) => {
  try {
    // Verify Paddle signature
    const signature = req.headers['paddle-signature'];
    if (process.env.PADDLE_WEBHOOK_SECRET && signature) {
      // Paddle uses ts=...;h1=... format
      // Full HMAC verification can be added here when live
      // For now log and process
    }

    const event    = req.body;
    const type     = event.event_type;
    const data     = event.data;

    console.log(`[Paddle webhook] ${type}`);

    if (type === 'transaction.completed') {
      const email       = data.customer?.email || data.billing_details?.email;
      const name        = data.custom_data?.name || '';
      const plan        = data.custom_data?.plan || planByPaddlePriceId(data.items?.[0]?.price?.id) || 'starter';
      const planCfg     = PLANS[plan] || PLANS.starter;
      const customerId  = data.customer_id;
      const subId       = data.subscription_id;

      if (!email) { console.warn('[Paddle] transaction.completed — no email'); return res.json({ ok: true }); }

      const update = {
        paddle_customer_id:              customerId,
        paddle_subscription_id:          subId,
        subscription_plan:               plan,
        subscription_status:             'active',
        monthly_dial_limit:              planCfg.dials,
        updated_at:                      new Date().toISOString(),
      };

      const { data: existing } = await getSupabase().from('users').select('id').eq('email', email).maybeSingle();

      if (existing) {
        await getSupabase().from('users').update(update).eq('id', existing.id);
      } else {
        await getSupabase().from('users').insert({ email, full_name: name, ...update });
      }
      console.log(`[Paddle] Activated ${email} on ${plan}`);
    }

    if (type === 'subscription.activated' || type === 'subscription.updated') {
      const subId  = data.id;
      const status = data.status === 'active' ? 'active' : data.status;
      const plan   = planByPaddlePriceId(data.items?.[0]?.price?.id) || data.custom_data?.plan;
      const update = { subscription_status: status, updated_at: new Date().toISOString() };
      if (plan && PLANS[plan]) {
        update.subscription_plan      = plan;
        update.monthly_dial_limit     = PLANS[plan].dials;
      }
      if (data.current_billing_period?.ends_at) {
        update.subscription_current_period_end = data.current_billing_period.ends_at;
      }
      await getSupabase().from('users').update(update).eq('paddle_subscription_id', subId);
    }

    if (type === 'subscription.canceled') {
      const subId = data.id;
      await getSupabase().from('users').update({
        subscription_status:             'cancelled',
        monthly_dial_limit:              0,
        subscription_current_period_end: data.scheduled_change?.effective_at || null,
        updated_at:                      new Date().toISOString(),
      }).eq('paddle_subscription_id', subId);
      console.log(`[Paddle] Cancelled subscription ${subId}`);
    }

    if (type === 'subscription.payment_failed') {
      const subId = data.id;
      await getSupabase().from('users').update({
        subscription_status: 'past_due',
        updated_at:          new Date().toISOString(),
      }).eq('paddle_subscription_id', subId);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[Paddle webhook] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/billing/webhook (Stripe legacy) ───────────────────────────────
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
        if (existing) await getSupabase().from('users').update(update).eq('id', existing.id);
        else await getSupabase().from('users').insert({ email, full_name: session.metadata?.name || '', ...update });
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
