/**
 * Referral System
 * Routes:
 *   GET  /api/referrals/me          - get my referral code + stats
 *   GET  /api/referrals/earnings    - commission history
 *   POST /api/referrals/apply       - apply referral code at registration
 *   POST /api/referrals/trigger     - trigger commission (called by billing webhook)
 *   GET  /api/referrals/leaderboard - top referrers
 */

const router   = require('express').Router();
const { requireAuth: auth } = require('../middleware/auth');
const supabase = require('../config/supabase');
const crypto   = require('crypto');
const axios    = require('axios');
const { sendEmail } = require('../services/emailService');

// Commission rates — no cap
const MONTH1_RATE    = 0.10; // 10% first month
const RECURRING_RATE = 0.03; // 3% months 2-12

function calcCommission(amount, rate) {
  // No cap — pay full percentage on every plan
  return parseFloat((amount * rate).toFixed(2));
}

// ─── Auto payout via Flutterwave Transfer ────────────────────────────────────
// referredName: display name of the person whose payment triggered this commission
async function triggerAutoPayout(referrerId, amount, description, referredName = 'Your referral') {
  try {
    const { data: referrer } = await supabase
      .from('users')
      .select('id, email, full_name, payout_email, payout_bank, payout_method')
      .eq('id', referrerId)
      .single();

    if (!referrer) return { success: false, reason: 'referrer_not_found' };

    const referrerFirst = referrer.full_name?.split(' ')[0] || 'there';

    // Always notify the referrer first — they need to know who paid regardless of payout status
    const notifyReferrer = async (payoutLine) => {
      await sendEmail({
        to:      referrer.email,
        subject: `${referredName} just paid — you earned $${amount}`,
        html: `
          <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;background:#060E1A;color:#fff;border-radius:16px;padding:40px;">
            <div style="font-size:22px;font-weight:900;margin-bottom:20px;">VEORI</div>
            <p style="font-size:16px;font-weight:700;color:#fff;margin:0 0 8px;">Hey ${referrerFirst},</p>
            <p style="font-size:15px;color:rgba(255,255,255,0.8);margin:0 0 20px;">
              <strong style="color:#00C37A;">${referredName}</strong> — your referral — just subscribed and paid.
              You earned <strong style="color:#00C37A;">$${amount}</strong> in commission.
            </p>
            <div style="background:rgba(0,195,122,0.08);border:1px solid rgba(0,195,122,0.20);border-radius:10px;padding:18px;margin-bottom:24px;">
              <div style="font-size:13px;color:rgba(255,255,255,0.45);margin-bottom:4px;">Commission details</div>
              <div style="font-size:14px;color:rgba(255,255,255,0.75);">${description}</div>
            </div>
            <p style="font-size:14px;color:rgba(255,255,255,0.55);margin:0 0 24px;">${payoutLine}</p>
            <a href="https://veori.net/referrals" style="display:block;text-align:center;background:#00C37A;color:#000;font-size:15px;font-weight:800;padding:14px;border-radius:10px;text-decoration:none;">View Your Referrals</a>
          </div>
        `,
      }).catch(() => {});
    };

    // If no payout method set — notify + prompt them to add payout details
    if (!referrer.payout_email && !referrer.payout_bank) {
      await notifyReferrer('To receive your payout, add your PayPal email under <strong>Referrals → Payout Settings</strong> in your dashboard.');
      return { success: false, reason: 'no_payout_method' };
    }

    // Auto payout via Flutterwave transfer
    const FW_SECRET = process.env.FLUTTERWAVE_SECRET_KEY;
    if (!FW_SECRET) {
      await notifyReferrer('Your commission has been recorded and will be paid out shortly.');
      return { success: false, reason: 'no_fw_key' };
    }

    const reference = `veori_ref_${referrerId.slice(0, 8)}_${Date.now()}`;

    let transferPayload = {
      amount,
      currency:         'USD',
      narration:        description,
      reference,
      beneficiary_name: referrer.full_name || referrer.email,
    };

    if (referrer.payout_method === 'bank' && referrer.payout_bank) {
      const bank = typeof referrer.payout_bank === 'string'
        ? JSON.parse(referrer.payout_bank)
        : referrer.payout_bank;
      transferPayload.account_bank   = bank.bank_code;
      transferPayload.account_number = bank.account_number;
    } else {
      transferPayload.account_bank   = 'paypal';
      transferPayload.account_number = referrer.payout_email;
    }

    const resp = await axios.post('https://api.flutterwave.com/v3/transfers', transferPayload, {
      headers: { Authorization: `Bearer ${FW_SECRET}`, 'Content-Type': 'application/json' },
      timeout: 15000,
    });

    if (resp.data?.status === 'success') {
      await notifyReferrer(`$${amount} has been sent to ${referrer.payout_email || 'your bank account'} — it should arrive within 1–3 business days.`);
      return { success: true, transfer_id: resp.data?.data?.id };
    }

    // Payout failed — still notify referrer, commission is logged as pending
    console.warn('[Referrals] Flutterwave transfer failed:', resp.data?.message);
    await notifyReferrer('Your commission has been recorded. We\'ll process the payout shortly — check your Referrals dashboard for status.');
    return { success: false, reason: resp.data?.message };
  } catch (err) {
    console.error('[Referrals] Auto payout error:', err.message);
    return { success: false, reason: err.message };
  }
}

// Generate unique referral code from name/email
function generateCode(name = '', id = '') {
  const base = (name.split(' ')[0] || 'ref').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6)
  const hash = crypto.createHash('md5').update(id).digest('hex').slice(0, 4).toUpperCase()
  return `${base}${hash}`
}

// Ensure user has a referral code
async function ensureReferralCode(userId) {
  const { data: user } = await supabase
    .from('users')
    .select('referral_code, full_name, email')
    .eq('id', userId)
    .single();

  if (user?.referral_code) return user.referral_code;

  const code = generateCode(user?.full_name || user?.email || '', userId);

  await supabase
    .from('users')
    .update({ referral_code: code })
    .eq('id', userId);

  return code;
}

// ─── GET /api/referrals/me ────────────────────────────────────────────────────
router.get('/me', auth, async (req, res) => {
  try {
    const code = await ensureReferralCode(req.user.id);

    const { data: referrals } = await supabase
      .from('referrals')
      .select('*, users!referrals_referred_id_fkey(full_name, email, subscription_plan)')
      .eq('referrer_id', req.user.id)
      .order('created_at', { ascending: false });

    const { data: payments } = await supabase
      .from('referral_payments')
      .select('amount, type, status, created_at')
      .eq('referrer_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(20);

    const totalEarned   = (payments || []).reduce((s, p) => s + parseFloat(p.amount || 0), 0);
    const pendingPayout = (payments || []).filter(p => p.status === 'pending').reduce((s, p) => s + parseFloat(p.amount || 0), 0);
    const activeRefs    = (referrals || []).filter(r => r.status === 'active').length;

    const frontendUrl = process.env.FRONTEND_URL || 'https://veori.net';

    res.json({
      success:       true,
      referral_code: code,
      referral_link: `${frontendUrl}/register?ref=${code}`,
      stats: {
        total_referrals:  (referrals || []).length,
        active_referrals: activeRefs,
        total_earned:     parseFloat(totalEarned.toFixed(2)),
        pending_payout:   parseFloat(pendingPayout.toFixed(2)),
      },
      referrals: (referrals || []).map(r => ({
        id:           r.id,
        name:         r.users?.full_name || r.users?.email || 'Unknown',
        plan:         r.plan,
        plan_amount:  r.plan_amount,
        status:       r.status,
        month1_paid:  r.month1_paid,
        total_earned: r.total_earned,
        joined:       r.created_at,
      })),
      recent_payments: payments || [],
    });
  } catch (err) {
    console.error('[Referrals] me error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load referral data' });
  }
});

// ─── GET /api/referrals/earnings ─────────────────────────────────────────────
router.get('/earnings', auth, async (req, res) => {
  try {
    const { data: payments, error } = await supabase
      .from('referral_payments')
      .select('*')
      .eq('referrer_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    const total   = (payments || []).reduce((s, p) => s + parseFloat(p.amount || 0), 0);
    const pending = (payments || []).filter(p => p.status === 'pending').reduce((s, p) => s + parseFloat(p.amount || 0), 0);
    const paid    = total - pending;

    res.json({
      success:  true,
      total:    parseFloat(total.toFixed(2)),
      pending:  parseFloat(pending.toFixed(2)),
      paid:     parseFloat(paid.toFixed(2)),
      payments: payments || [],
    });
  } catch (err) {
    console.error('[Referrals] earnings error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load earnings' });
  }
});

// ─── POST /api/referrals/apply ────────────────────────────────────────────────
// Called during registration to link a referred user to referrer
router.post('/apply', async (req, res) => {
  try {
    const { referral_code, user_id } = req.body;
    if (!referral_code || !user_id) {
      return res.status(400).json({ success: false, error: 'referral_code and user_id required' });
    }

    // Find referrer by code
    const { data: referrer } = await supabase
      .from('users')
      .select('id, referral_code')
      .eq('referral_code', referral_code.toUpperCase())
      .single();

    if (!referrer) {
      return res.status(404).json({ success: false, error: 'Invalid referral code' });
    }

    if (referrer.id === user_id) {
      return res.status(400).json({ success: false, error: 'Cannot refer yourself' });
    }

    // Link referred user to referrer
    await supabase
      .from('users')
      .update({ referred_by: referrer.id })
      .eq('id', user_id);

    console.log(`[Referrals] User ${user_id} referred by ${referrer.id} (code: ${referral_code})`);

    res.json({ success: true, referrer_id: referrer.id });
  } catch (err) {
    console.error('[Referrals] apply error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to apply referral code' });
  }
});

// ─── POST /api/referrals/trigger ─────────────────────────────────────────────
// Called by billing webhook when a payment is confirmed
// type: 'month1' or 'recurring'
router.post('/trigger', async (req, res) => {
  try {
    const { user_id, plan, plan_amount, type = 'month1' } = req.body;

    if (!user_id || !plan_amount) {
      return res.status(400).json({ success: false, error: 'user_id and plan_amount required' });
    }

    // Find who referred this user
    const { data: user } = await supabase
      .from('users')
      .select('referred_by, full_name, email')
      .eq('id', user_id)
      .single();

    if (!user?.referred_by) {
      return res.json({ success: true, message: 'No referrer for this user' });
    }

    const referrerId  = user.referred_by;
    const amount      = parseFloat(plan_amount);
    // Name shown in the referrer's notification email
    const referredName = user.full_name || user.email || 'Your referral';

    if (type === 'month1') {
      // First payment — 10% commission, create referral record
      const commission = calcCommission(amount, MONTH1_RATE);

      // Upsert referral record
      const { data: referral } = await supabase
        .from('referrals')
        .upsert({
          referrer_id:       referrerId,
          referred_id:       user_id,
          plan,
          plan_amount:       amount,
          status:            'active',
          month1_commission: commission,
          month1_paid:       true,
          recurring_rate:    RECURRING_RATE,
          total_earned:      commission,
          updated_at:        new Date().toISOString(),
        }, { onConflict: 'referred_id' })
        .select().single();

      // Notify referrer + trigger payout
      const payout = await triggerAutoPayout(
        referrerId, commission,
        `10% first-month commission — ${plan} plan`,
        referredName
      );

      // Log payment
      await supabase.from('referral_payments').insert({
        referral_id: referral?.id,
        referrer_id: referrerId,
        referred_id: user_id,
        amount:      commission,
        type:        'month1',
        status:      payout.success ? 'paid' : 'pending',
      });

      // Add to referrer credits
      const { data: referrerUser } = await supabase
        .from('users')
        .select('referral_credits')
        .eq('id', referrerId)
        .single();

      await supabase
        .from('users')
        .update({ referral_credits: (parseFloat(referrerUser?.referral_credits || 0) + commission) })
        .eq('id', referrerId);

      console.log(`[Referrals] Month1 commission $${commission} for referrer ${referrerId} — payout: ${payout.success ? 'sent' : 'pending'}`);

    } else {
      // Recurring payment — 3% of the LOCKED original plan amount, for 12 months only
      const { data: referral } = await supabase
        .from('referrals')
        .select('id, total_earned, plan_amount, recurring_count')
        .eq('referred_id', user_id)
        .single();

      if (!referral) return res.json({ success: true, message: 'No referral record found' });

      // Stop after 12 recurring payments
      const recurringCount = referral.recurring_count || 0;
      if (recurringCount >= 12) {
        return res.json({ success: true, message: 'Recurring commission period ended (12 months complete)' });
      }

      // Always use the locked plan_amount from when they first subscribed
      const lockedAmount = parseFloat(referral?.plan_amount || amount);
      const commission   = calcCommission(lockedAmount, RECURRING_RATE);

      // Update total earned and increment recurring count
      await supabase
        .from('referrals')
        .update({
          total_earned:    parseFloat(referral.total_earned || 0) + commission,
          recurring_count: recurringCount + 1,
          updated_at:      new Date().toISOString(),
        })
        .eq('id', referral.id);

      // Notify referrer + trigger payout
      const payout = await triggerAutoPayout(
        referrerId, commission,
        `3% recurring commission — month ${recurringCount + 1} of 12 (${plan} plan)`,
        referredName
      );

      // Log payment
      await supabase.from('referral_payments').insert({
        referral_id: referral.id,
        referrer_id: referrerId,
        referred_id: user_id,
        amount:      commission,
        type:        'recurring',
        status:      payout.success ? 'paid' : 'pending',
      });

      // Add to referrer credits
      const { data: referrerUser } = await supabase
        .from('users')
        .select('referral_credits')
        .eq('id', referrerId)
        .single();

      await supabase
        .from('users')
        .update({ referral_credits: (parseFloat(referrerUser?.referral_credits || 0) + commission) })
        .eq('id', referrerId);

      console.log(`[Referrals] Recurring commission $${commission} for referrer ${referrerId}`);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[Referrals] trigger error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to trigger commission' });
  }
});

// ─── GET /api/referrals/leaderboard ──────────────────────────────────────────
router.get('/leaderboard', auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('referrals')
      .select('referrer_id, users!referrals_referrer_id_fkey(full_name), total_earned')
      .eq('status', 'active')
      .order('total_earned', { ascending: false })
      .limit(10);

    if (error) throw error;

    const grouped = {};
    for (const r of data || []) {
      if (!grouped[r.referrer_id]) {
        grouped[r.referrer_id] = {
          referrer_id: r.referrer_id,
          name:        r.users?.full_name || 'Anonymous',
          referrals:   0,
          total_earned: 0,
        };
      }
      grouped[r.referrer_id].referrals++;
      grouped[r.referrer_id].total_earned += parseFloat(r.total_earned || 0);
    }

    const leaderboard = Object.values(grouped)
      .sort((a, b) => b.total_earned - a.total_earned)
      .slice(0, 10);

    res.json({ success: true, leaderboard });
  } catch (err) {
    console.error('[Referrals] leaderboard error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load leaderboard' });
  }
});

// ─── GET /api/referrals/payout-settings ──────────────────────────────────────
router.get('/payout-settings', auth, async (req, res) => {
  try {
    const { data } = await supabase
      .from('users')
      .select('payout_email, payout_method, payout_bank')
      .eq('id', req.user.id)
      .single();
    res.json({ success: true, payout_email: data?.payout_email || null, payout_method: data?.payout_method || 'paypal' });
  } catch (err) { next(err); }
});

// ─── PUT /api/referrals/payout-settings ──────────────────────────────────────
router.put('/payout-settings', auth, async (req, res, next) => {
  try {
    const { payout_email, payout_method } = req.body;
    if (!payout_email) return res.status(400).json({ success: false, error: 'Payout email is required' });

    await supabase
      .from('users')
      .update({ payout_email: payout_email.trim().toLowerCase(), payout_method: payout_method || 'paypal', updated_at: new Date().toISOString() })
      .eq('id', req.user.id);

    res.json({ success: true, message: 'Payout settings saved. Future commissions will be sent here automatically.' });
  } catch (err) { next(err); }
});

module.exports = router;
