/**
 * Flutterwave Billing — Primary Payment Processor
 *
 * Routes:
 *   GET  /api/fw-billing/plans                  — list plans
 *   POST /api/fw-billing/create-payment-link     — create checkout link
 *   GET  /api/fw-billing/verify/:txRef           — verify payment after redirect
 *   GET  /api/fw-billing/subscription            — get current subscription
 *   POST /api/fw-billing/cancel                  — cancel subscription
 *   POST /api/fw-billing/webhook                 — Flutterwave webhook (no auth)
 */

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const supabase = require('../config/supabase');
const { requireAuth: auth } = require('../middleware/auth');

const FW_BASE      = 'https://api.flutterwave.com/v3';
const FW_SECRET    = () => process.env.FLUTTERWAVE_SECRET_KEY;
const FW_PUBLIC    = () => process.env.FLUTTERWAVE_PUBLIC_KEY;
const FW_HASH      = () => process.env.FLUTTERWAVE_WEBHOOK_HASH || '';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://veori.net';

// ─── Plans ────────────────────────────────────────────────────────────────────
// Amounts in USD (Flutterwave uses whole numbers, not cents)
const PLANS = {
  founding_member: {
    name:        'Founding Member',
    amount:      397,
    currency:    'USD',
    interval:    'monthly',
    dials:       3000,
    description: 'Founding member rate — locked in forever',
    founding:    true,
    fw_plan_id:  process.env.FW_PLAN_FOUNDING || null,
  },
  starter: {
    name:        'Starter',
    amount:      499,
    currency:    'USD',
    interval:    'monthly',
    dials:       3000,
    description: '3,000 AI dials per month',
    fw_plan_id:  process.env.FW_PLAN_STARTER || null,
  },
  growth: {
    name:        'Growth',
    amount:      999,
    currency:    'USD',
    interval:    'monthly',
    dials:       7000,
    description: '7,000 AI dials per month',
    fw_plan_id:  process.env.FW_PLAN_GROWTH || null,
  },
  pro: {
    name:        'Pro',
    amount:      1799,
    currency:    'USD',
    interval:    'monthly',
    dials:       15000,
    description: '15,000 AI dials per month',
    fw_plan_id:  process.env.FW_PLAN_PRO || null,
  },
  scale: {
    name:        'Scale',
    amount:      2999,
    currency:    'USD',
    interval:    'monthly',
    dials:       30000,
    description: '30,000 AI dials per month',
    fw_plan_id:  process.env.FW_PLAN_SCALE || null,
  },
  enterprise: {
    name:        'Enterprise',
    amount:      5999,
    currency:    'USD',
    interval:    'monthly',
    dials:       50000,
    description: '50,000 AI dials per month',
    fw_plan_id:  process.env.FW_PLAN_ENTERPRISE || null,
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fwRequest(method, path, body = null) {
  const res = await fetch(`${FW_BASE}${path}`, {
    method,
    headers: {
      Authorization:  `Bearer ${FW_SECRET()}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// Create or retrieve a Flutterwave payment plan for a plan key
async function getOrCreateFwPlan(planKey) {
  const plan = PLANS[planKey];
  if (!plan) return null;

  // If plan ID already stored in env, use it
  if (plan.fw_plan_id) return plan.fw_plan_id;

  // Create the payment plan in Flutterwave
  const resp = await fwRequest('POST', '/payment-plans', {
    amount:   plan.amount,
    name:     `Veori ${plan.name}`,
    interval: 'monthly',
    currency: plan.currency,
  });

  if (resp.status === 'success' && resp.data?.id) {
    console.log(`[FW] Created payment plan for ${planKey}: ${resp.data.id}`);
    return resp.data.id;
  }

  console.warn('[FW] Failed to create payment plan:', resp.message);
  return null;
}

// Update user subscription in Supabase
async function updateUserSubscription(userId, { plan, status, fwCustomerId, fwSubscriptionId, expiresAt }) {
  const updates = {
    subscription_plan:   plan,
    subscription_status: status,
    updated_at:          new Date().toISOString(),
  };

  if (fwCustomerId)     updates.fw_customer_id     = fwCustomerId;
  if (fwSubscriptionId) updates.fw_subscription_id = fwSubscriptionId;
  if (expiresAt)        updates.subscription_expires_at = expiresAt;

  if (plan && PLANS[plan]) {
    updates.monthly_dial_limit = PLANS[plan].dials;
  }

  const { error } = await supabase.from('users').update(updates).eq('id', userId);
  if (error) console.error('[FW] Update user error:', error.message);
}

// ─── GET /api/fw-billing/plans ────────────────────────────────────────────────
router.get('/plans', (req, res) => {
  const plansOut = Object.entries(PLANS).map(([key, p]) => ({
    key,
    name:        p.name,
    amount:      p.amount,
    currency:    p.currency,
    dials:       p.dials,
    description: p.description,
    founding:    p.founding || false,
  }));
  res.json({ success: true, plans: plansOut });
});

// ─── POST /api/fw-billing/create-payment-link ─────────────────────────────────
router.post('/create-payment-link', auth, async (req, res) => {
  try {
    const { plan: planKey } = req.body;
    const plan = PLANS[planKey];

    if (!plan) {
      return res.status(400).json({ success: false, error: 'Invalid plan selected' });
    }

    if (!FW_SECRET()) {
      return res.status(503).json({ success: false, error: 'Payment system not configured' });
    }

    // Get user details
    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('id, email, full_name, company_name, phone')
      .eq('id', req.user.id)
      .single();

    if (userErr || !user) {
      console.error('[FW] User lookup error:', userErr?.message);
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const txRef = `veori_${planKey}_${user.id}_${Date.now()}`;

    // Get or create Flutterwave payment plan for recurring billing
    const fwPlanId = await getOrCreateFwPlan(planKey);

    const paymentBody = {
      tx_ref:       txRef,
      amount:       plan.amount,
      currency:     plan.currency,
      redirect_url: `${FRONTEND_URL}/billing/verify?plan=${planKey}`,
      customer: {
        email:       user.email,
        name:        user.full_name || user.company_name || user.email,
        phonenumber: user.phone || '',
      },
      customizations: {
        title:       'Veori AI',
        description: plan.description,
        logo:        `${FRONTEND_URL}/logo.png`,
      },
      meta: {
        user_id:  user.id,
        plan:     planKey,
      },
    };

    // Attach recurring plan if available
    if (fwPlanId) paymentBody.payment_plan = fwPlanId;

    const resp = await fwRequest('POST', '/payments', paymentBody);

    if (resp.status !== 'success' || !resp.data?.link) {
      console.error('[FW] Payment link error:', resp.message);
      return res.status(502).json({ success: false, error: resp.message || 'Failed to create payment link' });
    }

    res.json({
      success:       true,
      payment_url:   resp.data.link,
      tx_ref:        txRef,
      plan:          planKey,
      amount:        plan.amount,
      public_key:    FW_PUBLIC(),
    });
  } catch (err) {
    console.error('[FW] create-payment-link error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to create payment. Please try again.' });
  }
});

// ─── GET /api/fw-billing/verify/:txRef ───────────────────────────────────────
// Called after user returns from Flutterwave redirect
router.get('/verify/:txRef', auth, async (req, res) => {
  try {
    const { txRef } = req.params;
    const { transaction_id } = req.query;

    let txData = null;

    // Verify by transaction ID if provided (more reliable)
    if (transaction_id) {
      const resp = await fwRequest('GET', `/transactions/${transaction_id}/verify`);
      if (resp.status === 'success') txData = resp.data;
    }

    // Fallback: search by tx_ref
    if (!txData) {
      const resp = await fwRequest('GET', `/transactions?tx_ref=${txRef}`);
      if (resp.status === 'success' && resp.data?.length > 0) {
        txData = resp.data[0];
      }
    }

    if (!txData) {
      return res.status(404).json({ success: false, error: 'Transaction not found' });
    }

    if (txData.status !== 'successful') {
      return res.status(402).json({ success: false, error: `Payment ${txData.status}`, status: txData.status });
    }

    // Security: verify this transaction belongs to the authenticated user
    // Prevents User A from using User B's transaction ID to upgrade their own account
    const txUserId = txData.meta?.user_id;
    if (txUserId && txUserId !== req.user.id) {
      console.error(`[FW Verify] User ${req.user.id} tried to claim transaction belonging to ${txUserId}`);
      return res.status(403).json({ success: false, error: 'Transaction does not belong to your account' });
    }

    // Extract plan from tx_ref or meta
    const planKey = txData.meta?.plan || txRef.split('_')[1] || null;
    const plan    = PLANS[planKey];

    if (!plan) {
      return res.status(400).json({ success: false, error: 'Unknown plan in transaction' });
    }

    // Verify amount matches
    if (txData.amount < plan.amount) {
      return res.status(402).json({ success: false, error: 'Payment amount mismatch' });
    }

    const expiresAt = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();

    await updateUserSubscription(req.user.id, {
      plan:               planKey,
      status:             'active',
      fwCustomerId:       txData.customer?.id?.toString() || null,
      fwSubscriptionId:   txData.plan || null,
      expiresAt,
    });

    res.json({
      success:     true,
      plan:        planKey,
      plan_name:   plan.name,
      amount:      txData.amount,
      currency:    txData.currency,
      expires_at:  expiresAt,
      message:     `Welcome to Veori ${plan.name}! Your account is now active.`,
    });
  } catch (err) {
    console.error('[FW] verify error:', err.message);
    res.status(500).json({ success: false, error: 'Verification failed. Contact support.' });
  }
});

// ─── GET /api/fw-billing/subscription ────────────────────────────────────────
router.get('/subscription', auth, async (req, res) => {
  try {
    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('id, email, subscription_plan, subscription_status, subscription_expires_at, monthly_dial_limit, fw_subscription_id')
      .eq('id', req.user.id)
      .single();

    if (userErr || !user) {
      console.error('[FW] Subscription lookup error:', userErr?.message);
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const planKey = user.subscription_plan;
    const plan    = PLANS[planKey] || null;

    res.json({
      success:     true,
      plan:        planKey,
      plan_name:   plan?.name   || null,
      status:      user.subscription_status || 'inactive',
      expires_at:  user.subscription_expires_at || null,
      dials:       user.monthly_dial_limit || 0,
      amount:      plan?.amount || 0,
    });
  } catch (err) {
    console.error('[FW] subscription error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load subscription' });
  }
});

// ─── POST /api/fw-billing/cancel ─────────────────────────────────────────────
router.post('/cancel', auth, async (req, res) => {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('fw_subscription_id')
      .eq('id', req.user.id)
      .single();

    if (user?.fw_subscription_id) {
      // Cancel in Flutterwave
      await fwRequest('PUT', `/subscriptions/${user.fw_subscription_id}/cancel`);
    }

    await updateUserSubscription(req.user.id, {
      status: 'cancelled',
    });

    res.json({ success: true, message: 'Subscription cancelled. You keep access until the end of your billing period.' });
  } catch (err) {
    console.error('[FW] cancel error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to cancel subscription' });
  }
});

// ─── POST /api/fw-billing/webhook ────────────────────────────────────────────
// No auth — Flutterwave sends this directly
router.post('/webhook', express.json(), async (req, res) => {
  try {
    // Verify webhook signature — ALWAYS required
    // If FLUTTERWAVE_WEBHOOK_HASH is not set, reject every request.
    // An empty/missing hash config means the endpoint is unconfigured, not open.
    const hash     = req.headers['verif-hash'];
    const expected = FW_HASH();

    if (!expected) {
      console.error('[FW Webhook] FLUTTERWAVE_WEBHOOK_HASH not configured — rejecting all webhook requests');
      return res.status(503).json({ error: 'Webhook not configured' });
    }

    if (hash !== expected) {
      console.warn('[FW Webhook] Invalid hash — possible spoofed request');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const event = req.body;
    const data  = event.data;

    console.log('[FW Webhook] event:', event.event, '| tx:', data?.tx_ref);

    if (event.event === 'charge.completed' && data?.status === 'successful') {
      const planKey = data.meta?.plan || data.tx_ref?.split('_')[1] || null;
      const userId  = data.meta?.user_id || null;

      if (userId && planKey && PLANS[planKey]) {
        const plan      = PLANS[planKey];
        const expiresAt = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();

        await updateUserSubscription(userId, {
          plan:             planKey,
          status:           'active',
          fwCustomerId:     data.customer?.id?.toString() || null,
          fwSubscriptionId: data.plan?.toString() || null,
          expiresAt,
        });

        // Determine if this is first payment or recurring
        const { data: existingRef } = await supabase
          .from('referrals')
          .select('month1_paid')
          .eq('referred_id', userId)
          .single();

        const commissionType = (!existingRef || !existingRef.month1_paid) ? 'month1' : 'recurring';

        // Trigger referral commission (fire and forget — internal only)
        const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001';
        fetch(`${backendUrl}/api/referrals/trigger`, {
          method:  'POST',
          headers: {
            'Content-Type':      'application/json',
            'x-internal-secret': process.env.INTERNAL_API_SECRET || '',
          },
          body: JSON.stringify({ user_id: userId, plan: planKey, plan_amount: plan.amount, type: commissionType }),
        }).catch(e => console.warn('[FW Webhook] Commission trigger failed:', e.message));

        console.log(`[FW Webhook] Activated ${planKey} for user ${userId}, commission type: ${commissionType}`);
      }
    }

    if (event.event === 'subscription.cancelled') {
      const userId = data?.meta?.user_id || null;
      if (userId) {
        await updateUserSubscription(userId, { status: 'cancelled' });
        console.log(`[FW Webhook] Cancelled subscription for user ${userId}`);
      }
    }

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('[FW Webhook] error:', err.message);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router;
