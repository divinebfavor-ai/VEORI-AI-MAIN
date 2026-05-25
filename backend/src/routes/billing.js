const express = require('express');
const router  = express.Router();
const Stripe  = require('stripe');
const { createClient } = require('@supabase/supabase-js');

// Lazy init — avoids crashing the server at startup if env vars aren't loaded yet
let _stripe   = null;
let _supabase = null;
function getStripe() {
  if (!_stripe) _stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  return _stripe;
}
function getSupabase() {
  if (!_supabase) _supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  return _supabase;
}

const { requireAuth: auth } = require('../middleware/auth');

// ─── Plan config ──────────────────────────────────────────────────────────────
const PLANS = {
  starter: {
    priceId:    process.env.STRIPE_STARTER_PRICE_ID    || 'price_1Tb1UhAW61xZuN5nBiMP6Spu',
    name:       'Starter Plan',
    dials:      3000,
    amount:     49900,
  },
  growth: {
    priceId:    process.env.STRIPE_GROWTH_PRICE_ID     || 'price_1Tb1Y8AW61xZuN5nim5LCiud',
    name:       'Growth Plan',
    dials:      7000,
    amount:     99900,
  },
  pro: {
    priceId:    process.env.STRIPE_PRO_PRICE_ID        || 'price_1Tb1YBAW61xZuN5nD6W0YZgB',
    name:       'Pro Plan',
    dials:      15000,
    amount:     179900,
  },
  scale: {
    priceId:    process.env.STRIPE_SCALE_PRICE_ID      || 'price_1Tb1YEAW61xZuN5njVCI31UY',
    name:       'Scale Plan',
    dials:      30000,
    amount:     299900,
  },
  enterprise: {
    priceId:    process.env.STRIPE_ENTERPRISE_PRICE_ID || 'price_1Tb1YFAW61xZuN5nQZ9zbss7',
    name:       'Enterprise Plan',
    dials:      50000,
    amount:     599900,
  },
};

// Reverse-lookup plan by price ID (used in webhook)
function planByPriceId(priceId) {
  return Object.entries(PLANS).find(([, v]) => v.priceId === priceId)?.[0] || null;
}

// ─── POST /api/billing/checkout ───────────────────────────────────────────────
// Public — called from pricing page. Creates Stripe Checkout session.
router.post('/checkout', async (req, res) => {
  try {
    const { name, email, plan = 'starter' } = req.body;

    if (!email || !name) {
      return res.status(400).json({ error: 'Name and email are required.' });
    }

    const planConfig = PLANS[plan];
    if (!planConfig) {
      return res.status(400).json({ error: `Unknown plan: ${plan}` });
    }

    const appUrl  = process.env.APP_URL  || 'https://veori.net';
    const siteUrl = process.env.SITE_URL || appUrl;

    const session = await getStripe().checkout.sessions.create({
      mode:                 'subscription',
      payment_method_types: ['card'],
      customer_email:       email,
      metadata:             { name, plan },
      line_items:           [{ price: planConfig.priceId, quantity: 1 }],
      subscription_data:    { metadata: { name, plan } },
      success_url:          `${siteUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:           `${siteUrl}/#pricing`,
      allow_promotion_codes:      true,
      billing_address_collection: 'auto',
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('[billing/checkout]', err.message);
    res.status(500).json({ error: 'Failed to create checkout session.' });
  }
});

// ─── POST /api/stripe/create-checkout-session (alias) ────────────────────────
// Same as above but accepts { planName } — matches the spec requirement
router.post('/create-checkout-session', async (req, res) => {
  try {
    const { planName, plan, name, email } = req.body;
    const resolvedPlan = plan || planName?.toLowerCase();

    if (!resolvedPlan || !PLANS[resolvedPlan]) {
      return res.status(400).json({
        error: `Unknown plan: ${resolvedPlan}. Valid plans: ${Object.keys(PLANS).join(', ')}`
      });
    }

    const planConfig = PLANS[resolvedPlan];
    const appUrl     = process.env.APP_URL  || 'https://veori.net';
    const siteUrl    = process.env.SITE_URL || appUrl;

    const session = await getStripe().checkout.sessions.create({
      mode:                 'subscription',
      payment_method_types: ['card'],
      ...(email ? { customer_email: email } : {}),
      metadata:             { name: name || '', plan: resolvedPlan },
      line_items:           [{ price: planConfig.priceId, quantity: 1 }],
      subscription_data:    { metadata: { plan: resolvedPlan } },
      success_url:          `${siteUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:           `${siteUrl}/#pricing`,
      allow_promotion_codes:      true,
      billing_address_collection: 'auto',
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('[billing/create-checkout-session]', err.message);
    res.status(500).json({ error: 'Failed to create checkout session.' });
  }
});

// ─── POST /api/billing/portal ─────────────────────────────────────────────────
router.post('/portal', auth, async (req, res) => {
  try {
    const { data: profile, error } = await getSupabase()
      .from('users')
      .select('stripe_customer_id')
      .eq('id', req.user.id)
      .single();

    if (error || !profile?.stripe_customer_id) {
      return res.status(400).json({ error: 'No active subscription found.' });
    }

    const appUrl = process.env.APP_URL || 'https://veori.net';
    const session = await getStripe().billingPortal.sessions.create({
      customer:   profile.stripe_customer_id,
      return_url: `${appUrl}/settings`,
    });

    res.json({ url: session.url });
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

    if (!profile?.stripe_subscription_id) {
      return res.json({ subscribed: false, plan: null, status: 'none' });
    }

    const plan = profile.subscription_plan;
    res.json({
      subscribed:  ['active', 'trialing'].includes(profile.subscription_status),
      plan,
      status:      profile.subscription_status,
      periodEnd:   profile.subscription_current_period_end,
      dialLimit:   profile.monthly_dial_limit || PLANS[plan]?.dials || 0,
      planDetails: PLANS[plan] || null,
    });
  } catch (err) {
    console.error('[billing/status]', err.message);
    res.status(500).json({ error: 'Failed to get subscription status.' });
  }
});

// ─── GET /api/billing/plans ───────────────────────────────────────────────────
// Public — returns all plan details for the pricing page
router.get('/plans', (_req, res) => {
  res.json({
    success: true,
    plans: Object.entries(PLANS).map(([key, p]) => ({
      key,
      name:    p.name,
      price:   p.amount / 100,
      dials:   p.dials,
      popular: key === 'growth',
    })),
  });
});

// ─── POST /api/billing/webhook ────────────────────────────────────────────────
// IMPORTANT: Must receive raw body — mounted before express.json() in index.js
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig    = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    console.error('[billing/webhook] STRIPE_WEBHOOK_SECRET not set');
    return res.status(500).send('Webhook secret not configured');
  }

  let event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error('[billing/webhook] Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`[billing/webhook] Event: ${event.type}`);

  try {
    switch (event.type) {

      // ── Payment completed — create/update user account ────────────────────
      case 'checkout.session.completed': {
        const session = event.data.object;
        const email   = session.customer_email || session.customer_details?.email;
        const custId  = session.customer;
        const subId   = session.subscription;
        const plan    = session.metadata?.plan || 'starter';
        const name    = session.metadata?.name || '';
        const planCfg = PLANS[plan] || PLANS.starter;

        if (!email) {
          console.error('[billing/webhook] checkout.session.completed — no email found');
          break;
        }

        const updateData = {
          stripe_customer_id:     custId,
          stripe_subscription_id: subId,
          subscription_plan:      plan,
          subscription_status:    'active',
          monthly_dial_limit:     planCfg.dials,
          updated_at:             new Date().toISOString(),
        };

        const { data: existing } = await getSupabase()
          .from('users')
          .select('id')
          .eq('email', email)
          .maybeSingle();

        if (existing) {
          await getSupabase().from('users').update(updateData).eq('id', existing.id);
          console.log(`[billing/webhook] Updated user ${email} → plan: ${plan}, dials: ${planCfg.dials}`);
        } else {
          // New user — create stub account, they set password on first login
          await getSupabase().from('users').insert({
            email,
            full_name: name,
            ...updateData,
          });
          console.log(`[billing/webhook] Created new user ${email} → plan: ${plan}`);
        }
        break;
      }

      // ── Invoice paid — keep subscription active ───────────────────────────
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const custId  = invoice.customer;
        const subId   = invoice.subscription;

        // Get plan from subscription metadata
        let plan = null;
        if (subId) {
          try {
            const sub = await getStripe().subscriptions.retrieve(subId);
            plan = sub.metadata?.plan || planByPriceId(sub.items.data[0]?.price?.id);
          } catch {}
        }

        const updateData = { subscription_status: 'active', updated_at: new Date().toISOString() };
        if (plan && PLANS[plan]) updateData.monthly_dial_limit = PLANS[plan].dials;

        await getSupabase().from('users').update(updateData).eq('stripe_customer_id', custId);
        console.log(`[billing/webhook] Payment succeeded for customer ${custId}`);
        break;
      }

      // ── Payment failed — restrict access ─────────────────────────────────
      case 'invoice.payment_failed': {
        const custId = event.data.object.customer;
        await getSupabase().from('users').update({
          subscription_status: 'past_due',
          updated_at:          new Date().toISOString(),
        }).eq('stripe_customer_id', custId);
        console.log(`[billing/webhook] Payment failed for customer ${custId} — set past_due`);
        break;
      }

      // ── Subscription updated ──────────────────────────────────────────────
      case 'customer.subscription.updated': {
        const sub       = event.data.object;
        const custId    = sub.customer;
        const status    = sub.status;
        const periodEnd = sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null;

        // Check if plan changed
        const priceId   = sub.items?.data?.[0]?.price?.id;
        const plan      = sub.metadata?.plan || planByPriceId(priceId);
        const updateData = {
          subscription_status:             status,
          subscription_current_period_end: periodEnd,
          updated_at:                      new Date().toISOString(),
        };
        if (plan && PLANS[plan]) {
          updateData.subscription_plan      = plan;
          updateData.monthly_dial_limit     = PLANS[plan].dials;
        }

        await getSupabase().from('users').update(updateData).eq('stripe_customer_id', custId);
        console.log(`[billing/webhook] Subscription updated for ${custId} → status: ${status}`);
        break;
      }

      // ── Subscription cancelled — restrict immediately ──────────────────────
      case 'customer.subscription.deleted': {
        const sub    = event.data.object;
        const custId = sub.customer;
        await getSupabase().from('users').update({
          subscription_status:             'cancelled',
          subscription_current_period_end: sub.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString()
            : null,
          monthly_dial_limit:              0,
          updated_at:                      new Date().toISOString(),
        }).eq('stripe_customer_id', custId);
        console.log(`[billing/webhook] Subscription CANCELLED for customer ${custId}`);
        break;
      }

      default:
        console.log(`[billing/webhook] Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error('[billing/webhook] Handler error:', err.message, err.stack);
    // Still return 200 so Stripe doesn't retry indefinitely
  }

  res.json({ received: true });
});

module.exports = router;
