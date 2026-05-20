const express  = require('express');
const router   = express.Router();
const Stripe   = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe  = Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Auth middleware (same as other routes)
const auth = require('../middleware/auth');

// ─── Price IDs ────────────────────────────────────────────────────────────────
const PRICES = {
  founding: process.env.STRIPE_PRICE_FOUNDING || 'price_1TZ9MLAW61xZuN5ng4kHx2GV',
  standard: process.env.STRIPE_PRICE_STANDARD || 'price_1TZ9MOAW61xZuN5nR0VJkUxf',
  grind:    process.env.STRIPE_PRICE_GRIND    || 'price_1TZ9MRAW61xZuN5npF0FyrrP',
  empire:   process.env.STRIPE_PRICE_EMPIRE   || 'price_1TZ9MUAW61xZuN5nAWUSJY1J',
  dynasty:  process.env.STRIPE_PRICE_DYNASTY  || 'price_1TZ9MYAW61xZuN5nAFcPdRmx',
};

// ─── POST /api/billing/checkout ──────────────────────────────────────────────
// Public — called from the website. Creates a Stripe checkout session and
// returns a redirect URL. Works for both founding operators and waitlist signups
// who are ready to pay.
router.post('/checkout', async (req, res) => {
  try {
    const { name, email, plan = 'founding' } = req.body;

    if (!email || !name) {
      return res.status(400).json({ error: 'Name and email are required.' });
    }

    const priceId = PRICES[plan];
    if (!priceId) {
      return res.status(400).json({ error: `Unknown plan: ${plan}` });
    }

    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const siteUrl = process.env.SITE_URL || appUrl;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: email,
      metadata: { name, plan },
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        metadata: { name, plan },
        trial_period_days: plan === 'founding' ? 7 : 0,
      },
      success_url: `${siteUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${siteUrl}/#pricing`,
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('[billing/checkout]', err.message);
    res.status(500).json({ error: 'Failed to create checkout session.' });
  }
});

// ─── POST /api/billing/portal ────────────────────────────────────────────────
// Auth-protected — lets an existing subscriber open their Stripe billing portal
// to update card, cancel, or view invoices.
router.post('/portal', auth, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get the Stripe customer ID we stored on the user's profile
    const { data: profile, error } = await supabase
      .from('users')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single();

    if (error || !profile?.stripe_customer_id) {
      return res.status(400).json({ error: 'No active subscription found.' });
    }

    const appUrl = process.env.APP_URL || 'http://localhost:3000';

    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${appUrl}/settings`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('[billing/portal]', err.message);
    res.status(500).json({ error: 'Failed to open billing portal.' });
  }
});

// ─── GET /api/billing/status ─────────────────────────────────────────────────
// Auth-protected — returns the current user's subscription plan and status.
router.get('/status', auth, async (req, res) => {
  try {
    const { data: profile } = await supabase
      .from('users')
      .select('stripe_customer_id, stripe_subscription_id, subscription_plan, subscription_status, subscription_current_period_end')
      .eq('id', req.user.id)
      .single();

    if (!profile?.stripe_subscription_id) {
      return res.json({ subscribed: false, plan: null, status: 'none' });
    }

    res.json({
      subscribed: profile.subscription_status === 'active' || profile.subscription_status === 'trialing',
      plan:       profile.subscription_plan || 'founding',
      status:     profile.subscription_status,
      periodEnd:  profile.subscription_current_period_end,
    });
  } catch (err) {
    console.error('[billing/status]', err.message);
    res.status(500).json({ error: 'Failed to get subscription status.' });
  }
});

// ─── POST /api/billing/webhook ───────────────────────────────────────────────
// Stripe sends events here. Must receive the raw body (not parsed JSON).
// Register this URL in your Stripe dashboard → Webhooks.
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig    = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error('[billing/webhook] signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session  = event.data.object;
        const email    = session.customer_email;
        const custId   = session.customer;
        const subId    = session.subscription;
        const plan     = session.metadata?.plan || 'founding';
        const name     = session.metadata?.name || '';

        // Look up or create the user in Supabase
        const { data: existing } = await supabase
          .from('users')
          .select('id')
          .eq('email', email)
          .maybeSingle();

        if (existing) {
          await supabase.from('users').update({
            stripe_customer_id:     custId,
            stripe_subscription_id: subId,
            subscription_plan:      plan,
            subscription_status:    'active',
          }).eq('id', existing.id);
        } else {
          // Create a stub user — they'll set a password on first login
          await supabase.from('users').insert({
            email,
            full_name:              name,
            stripe_customer_id:     custId,
            stripe_subscription_id: subId,
            subscription_plan:      plan,
            subscription_status:    'active',
          });
        }
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub    = event.data.object;
        const custId = sub.customer;
        const status = sub.status;
        const periodEnd = sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null;

        await supabase.from('users').update({
          subscription_status:              status,
          subscription_current_period_end:  periodEnd,
        }).eq('stripe_customer_id', custId);
        break;
      }

      case 'invoice.payment_failed': {
        const custId = event.data.object.customer;
        await supabase.from('users').update({ subscription_status: 'past_due' })
          .eq('stripe_customer_id', custId);
        break;
      }
    }
  } catch (err) {
    console.error('[billing/webhook] handler error:', err.message);
  }

  res.json({ received: true });
});

module.exports = router;
