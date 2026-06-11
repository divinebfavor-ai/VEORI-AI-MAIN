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
    amount:      3999,
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
  custom: {
    name:        'Custom / High-Volume',
    amount:      null,           // no fixed price — negotiated via email
    currency:    'USD',
    interval:    'monthly',
    dials:       null,           // set manually after the deal is agreed
    description: 'High-volume custom pricing — contact us to tailor a plan',
    custom:      true,
    contact_email: 'divineqflash@gmail.com',
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const OWNER_EMAIL = 'divineqflash@gmail.com';

/**
 * Notify the platform owner when a new subscription is purchased.
 * Fire-and-forget — errors are logged but never thrown.
 */
async function notifyOwnerOfSale({ buyerEmail, buyerName, planKey, planName, amount, currency }) {
  try {
    const { data: owner } = await supabase
      .from('users')
      .select('id')
      .eq('email', OWNER_EMAIL)
      .maybeSingle();

    if (!owner?.id) {
      console.warn('[FW] Owner account not found — skipping sale notification');
      return;
    }

    const amountStr = amount ? `$${Number(amount).toLocaleString()} ${currency || 'USD'}` : '';
    const title     = `New subscriber: ${planName}`;
    const message   = [
      `${buyerName || buyerEmail} just subscribed to the ${planName} plan.`,
      amountStr ? `Amount: ${amountStr}/month.` : '',
    ].filter(Boolean).join(' ');

    await supabase.from('notifications').insert({
      operator_id: owner.id,
      type:        'new_sale',
      title,
      message,
      is_read:     false,
    });

    console.log(`[FW] Owner notified of new sale: ${planKey} by ${buyerEmail}`);
  } catch (err) {
    console.error('[FW] notifyOwnerOfSale error:', err.message);
  }
}

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
    custom:      p.custom   || false,
    // Custom plans have no checkout — the frontend shows a "Contact us" button
    // that opens the user's email client to negotiate high-volume pricing.
    contact_mailto: p.custom
      ? `mailto:${p.contact_email}?subject=${encodeURIComponent('Veori — Custom / High-Volume Plan')}`
      : null,
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

    // Custom / high-volume plans have no fixed price — no checkout link.
    // Direct the operator to email us so we can tailor a deal.
    if (plan.custom) {
      return res.status(400).json({
        success: false,
        custom:  true,
        error:   'Custom plans are arranged by email. Please contact us for high-volume pricing.',
        contact_email:  plan.contact_email,
        contact_mailto: `mailto:${plan.contact_email}?subject=${encodeURIComponent('Veori — Custom / High-Volume Plan')}`,
      });
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

    // Custom plans are never sold through checkout — they have no fixed price.
    if (plan.custom || plan.amount == null) {
      return res.status(400).json({ success: false, error: 'Custom plans are arranged by email, not checkout' });
    }

    // Verify amount covers the plan price.
    if (Number(txData.amount) < plan.amount) {
      return res.status(402).json({ success: false, error: 'Payment amount mismatch' });
    }

    // Verify currency matches — a weak-currency payment of "3999" units is not $3,999.
    if ((txData.currency || '').toUpperCase() !== (plan.currency || 'USD').toUpperCase()) {
      return res.status(402).json({ success: false, error: 'Payment currency mismatch' });
    }

    const expiresAt = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();

    await updateUserSubscription(req.user.id, {
      plan:               planKey,
      status:             'active',
      fwCustomerId:       txData.customer?.id?.toString() || null,
      fwSubscriptionId:   txData.plan || null,
      expiresAt,
    });

    // Auto-provision phone number pool (fire and forget — doesn't block the response)
    const { handlePlanUpgrade } = require('../services/numberProvisioning');
    handlePlanUpgrade(req.user.id, planKey).then(result => {
      console.log(`[FW Verify] Number provisioning for ${planKey}:`, result);
    }).catch(err => {
      console.error('[FW Verify] Number provisioning failed:', err.message);
    });

    // Notify owner of new sale (fire and forget — verify is the buyer's own session)
    notifyOwnerOfSale({
      buyerEmail: txData.customer?.email || '',
      buyerName:  txData.customer?.name  || '',
      planKey,
      planName:   plan.name,
      amount:     plan.amount,
      currency:   plan.currency || 'USD',
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

        // ── Security: validate the payment actually covers this plan ──────────
        // The webhook body is hash-verified above, but Flutterwave still reports
        // whatever was charged. Without these checks, a charge with meta.plan
        // forged to a high tier (or paid in a weak currency) could activate a
        // plan it didn't pay for. The /verify route does this; the webhook must too.
        const paidAmount   = Number(data.amount);
        const paidCurrency = (data.currency || '').toUpperCase();

        // (A) Amount must cover the plan price. Custom plans have no fixed price
        // and are never sold through checkout, so reject them here outright.
        if (plan.custom || plan.amount == null) {
          console.warn(`[FW Webhook] Rejected — '${planKey}' is not a checkout plan (user ${userId})`);
          return res.json({ status: 'ok' });
        }
        if (!Number.isFinite(paidAmount) || paidAmount < plan.amount) {
          console.warn(`[FW Webhook] Rejected — underpaid: paid ${paidAmount} ${paidCurrency}, plan '${planKey}' needs ${plan.amount} ${plan.currency} (user ${userId}, tx ${data.tx_ref})`);
          return res.json({ status: 'ok' });
        }

        // (B) Currency must match the plan currency (USD). A weak-currency payment
        // of "3999" units is not $3,999 — block the mismatch.
        if (paidCurrency !== (plan.currency || 'USD').toUpperCase()) {
          console.warn(`[FW Webhook] Rejected — currency mismatch: paid ${paidCurrency}, plan '${planKey}' is ${plan.currency} (user ${userId}, tx ${data.tx_ref})`);
          return res.json({ status: 'ok' });
        }

        // ── (C) Idempotency: skip if we've already processed this transaction ──
        // Flutterwave retries webhooks. Without this guard, each retry would
        // re-run activation, re-provision pool numbers, and re-fire referral
        // commission. data.id is FW's stable, globally-unique transaction id.
        // Insert-first (not select-then-insert) so two simultaneous retries can't
        // both pass a check and proceed — the UNIQUE (provider, transaction_id)
        // constraint lets exactly one win; the loser gets 23505 and bails.
        const fwTxId = (data.id ?? data.tx_ref ?? '').toString();
        const { error: claimErr } = await supabase
          .from('processed_transactions')
          .insert([{
            provider:       'flutterwave',
            transaction_id: fwTxId,
            tx_ref:         data.tx_ref || null,
            user_id:        userId,
            plan:           planKey,
            amount:         paidAmount,
            currency:       paidCurrency,
            event_type:     event.event,
          }]);

        if (claimErr) {
          if (claimErr.code === '23505') {
            console.log(`[FW Webhook] Duplicate ignored — tx ${fwTxId} already processed (user ${userId})`);
            return res.json({ status: 'ok' });
          }
          // Any other DB error: don't half-activate. 500 so FW retries later.
          console.error('[FW Webhook] Idempotency insert failed:', claimErr.message);
          return res.status(500).json({ error: 'Idempotency check failed' });
        }

        const expiresAt = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();

        await updateUserSubscription(userId, {
          plan:             planKey,
          status:           'active',
          fwCustomerId:     data.customer?.id?.toString() || null,
          fwSubscriptionId: data.plan?.toString() || null,
          expiresAt,
        });

        // Auto-provision phone number pool for this plan (fire and forget)
        const { handlePlanUpgrade } = require('../services/numberProvisioning');
        handlePlanUpgrade(userId, planKey).then(result => {
          console.log(`[FW Webhook] Number provisioning for ${planKey}:`, result);
        }).catch(err => {
          console.error('[FW Webhook] Number provisioning failed:', err.message);
        });

        // Notify platform owner of the new sale (fire and forget)
        notifyOwnerOfSale({
          buyerEmail: data.customer?.email || '',
          buyerName:  data.customer?.name  || '',
          planKey,
          planName:   plan.name,
          amount:     plan.amount,
          currency:   plan.currency || 'USD',
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
