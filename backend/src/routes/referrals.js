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

// Commission rates
const MONTH1_RATE    = 0.10; // 10% first month
const RECURRING_RATE = 0.03; // 3% ongoing
const MAX_COMMISSION = 500;  // hard cap

function calcCommission(amount, rate) {
  return Math.min(parseFloat((amount * rate).toFixed(2)), MAX_COMMISSION);
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
      .select('referred_by')
      .eq('id', user_id)
      .single();

    if (!user?.referred_by) {
      return res.json({ success: true, message: 'No referrer for this user' });
    }

    const referrerId = user.referred_by;
    const amount     = parseFloat(plan_amount);

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

      // Log payment
      await supabase.from('referral_payments').insert({
        referral_id: referral?.id,
        referrer_id: referrerId,
        referred_id: user_id,
        amount:      commission,
        type:        'month1',
        status:      'pending',
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

      console.log(`[Referrals] Month1 commission $${commission} for referrer ${referrerId}`);

    } else {
      // Recurring payment — 3%
      const commission = calcCommission(amount, RECURRING_RATE);

      const { data: referral } = await supabase
        .from('referrals')
        .select('id, total_earned')
        .eq('referred_id', user_id)
        .single();

      if (!referral) return res.json({ success: true, message: 'No referral record found' });

      // Update total earned
      await supabase
        .from('referrals')
        .update({
          total_earned: parseFloat(referral.total_earned || 0) + commission,
          updated_at:   new Date().toISOString(),
        })
        .eq('id', referral.id);

      // Log payment
      await supabase.from('referral_payments').insert({
        referral_id: referral.id,
        referrer_id: referrerId,
        referred_id: user_id,
        amount:      commission,
        type:        'recurring',
        status:      'pending',
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

module.exports = router;
