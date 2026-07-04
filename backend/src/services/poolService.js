/**
 * Pool Service - Shared Toll-Free Number Pool
 *
 * Veori holds a stock of pre-verified toll-free numbers (rows in phone_numbers
 * with user_id = NULL). When an operator pushes leads and the health math says
 * they need more calling capacity, a ready number is assigned instantly - a
 * single DB UPDATE setting user_id. No external API call, so assignment works
 * even when Twilio/Vapi keys are unavailable.
 *
 * Two responsibilities:
 *   1. loadPoolNumbers()  - admin fills the pool with verified toll-free numbers
 *   2. assignFromPool()   - instant, key-less assignment of pool numbers to an operator
 *
 * Pool rows are stored in the existing phone_numbers table:
 *   user_id          NULL          → in pool, unassigned
 *   pool_status      'available'   → ready to assign  ('assigned' once taken)
 *   is_toll_free     true
 *   verified_status  'verified'    → Twilio toll-free verification passed
 *                    'pending'     → stored but not yet Vapi-callable (keys missing)
 *   provider         'twilio'
 */

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');

// US toll-free prefixes (digits after the leading +1).
const TOLLFREE_PREFIXES = ['800', '833', '844', '855', '866', '877', '888'];

function isUSTollFree(e164) {
  const digits = (e164 || '').replace(/\D/g, '');
  if (digits.length !== 11 || digits[0] !== '1') return false;
  return TOLLFREE_PREFIXES.includes(digits.slice(1, 4));
}

/**
 * Import a single toll-free number into Vapi (Twilio provider).
 * Returns the Vapi number id, or null if keys are missing / import fails.
 */
async function importToVapi(number, label) {
  const vapiKey     = process.env.VAPI_API_KEY;
  const twilioSid   = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;

  // No keys yet (e.g. Twilio downtime) - caller will store as 'pending'.
  if (!vapiKey || !twilioSid || !twilioToken) return null;

  const webhookUrl = process.env.VAPI_WEBHOOK_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/vapi/webhook` : null);

  const vapiRes = await axios.post('https://api.vapi.ai/phone-number', {
    provider: 'twilio',
    number,
    twilioAccountSid: twilioSid,
    twilioAuthToken:  twilioToken,
    name: label,
    ...(webhookUrl ? { serverUrl: webhookUrl } : {}),
    ...(process.env.VAPI_WEBHOOK_SECRET ? { serverUrlSecret: process.env.VAPI_WEBHOOK_SECRET } : {}),
  }, {
    headers: { Authorization: `Bearer ${vapiKey}`, 'Content-Type': 'application/json' },
    timeout: 30000,
  });

  return vapiRes.data?.id || null;
}

/**
 * Load a batch of pre-verified toll-free numbers into the shared pool.
 *
 * @param {string[]} numbers  E.164 toll-free numbers (e.g. ['+18005551234'])
 * @returns {Promise<{loaded:number, skipped:number, invalid:string[], pending:number, errors:Array}>}
 *
 * Behaviour:
 *   - Rejects non-toll-free numbers (collected in `invalid`).
 *   - Skips numbers already present in phone_numbers (collected in `skipped`).
 *   - Tries to register each with Vapi. If keys are present → verified_status 'verified'.
 *     If keys missing or Vapi fails → stored as 'pending' (counts in `pending`) so the
 *     pool still fills now and can be activated later.
 */
async function loadPoolNumbers(numbers) {
  const result = { loaded: 0, skipped: 0, invalid: [], pending: 0, errors: [] };
  if (!Array.isArray(numbers) || numbers.length === 0) return result;

  for (const raw of numbers) {
    const number = (raw || '').trim();

    if (!isUSTollFree(number)) {
      result.invalid.push(number);
      continue;
    }

    // Already in DB (pool or assigned) - don't duplicate.
    const { data: existing } = await supabase
      .from('phone_numbers')
      .select('id')
      .eq('number', number)
      .maybeSingle();
    if (existing) {
      result.skipped += 1;
      continue;
    }

    const label = `Veori Toll-Free (${number})`;

    // Attempt Vapi registration. Missing keys → null → store as pending.
    let vapiId = null;
    let verified = 'pending';
    try {
      vapiId = await importToVapi(number, label);
      if (vapiId) verified = 'verified';
    } catch (err) {
      const msg = err.response?.data?.message || err.response?.data?.error || err.message;
      result.errors.push({ number, error: msg });
      // Fall through - still store as pending so the number isn't lost.
    }

    const { error: insertErr } = await supabase.from('phone_numbers').insert([{
      id:                   uuidv4(),
      user_id:              null,
      number,
      friendly_name:        label,
      area_code:            number.replace(/\D/g, '').slice(1, 4),
      vapi_phone_number_id: vapiId,
      provider:             'twilio',
      is_toll_free:         true,
      pool_status:          'available',
      verified_status:      verified,
      health_status:        'healthy',
      spam_score:           100,
      daily_call_limit:     40,
      is_active:            true,
      purchased_at:         new Date().toISOString(),
    }]);

    if (insertErr) {
      result.errors.push({ number, error: insertErr.message });
      continue;
    }

    result.loaded += 1;
    if (verified === 'pending') result.pending += 1;
  }

  console.log(`[Pool] Load complete - ${result.loaded} loaded (${result.pending} pending), ${result.skipped} skipped, ${result.invalid.length} invalid`);
  return result;
}

/**
 * Count how many verified numbers are currently available in the pool.
 * @returns {Promise<number>}
 */
async function poolAvailableCount() {
  const { count } = await supabase
    .from('phone_numbers')
    .select('*', { count: 'exact', head: true })
    .is('user_id', null)
    .eq('pool_status', 'available')
    .eq('is_toll_free', true)
    .eq('verified_status', 'verified');
  return count || 0;
}

/**
 * Assign up to `count` pool numbers to an operator. Instant, key-less.
 * Single UPDATE per number: claims it by setting user_id + assigned_at.
 *
 * @param {string} userId
 * @param {number} count   how many numbers to assign
 * @returns {Promise<{assigned:number, requested:number, pool_remaining:number, numbers:string[]}>}
 */
async function assignFromPool(userId, count) {
  const requested = Math.max(0, parseInt(count, 10) || 0);
  if (!userId || requested === 0) {
    return { assigned: 0, requested: 0, pool_remaining: await poolAvailableCount(), numbers: [] };
  }

  // Pull the oldest available verified toll-free numbers (FIFO).
  const { data: candidates, error } = await supabase
    .from('phone_numbers')
    .select('id, number')
    .is('user_id', null)
    .eq('pool_status', 'available')
    .eq('is_toll_free', true)
    .eq('verified_status', 'verified')
    .order('purchased_at', { ascending: true })
    .limit(requested);

  if (error || !candidates?.length) {
    return { assigned: 0, requested, pool_remaining: await poolAvailableCount(), numbers: [] };
  }

  const assignedNumbers = [];
  for (const cand of candidates) {
    // Claim only if still unassigned (guards against a concurrent assign stealing it).
    const { data: claimed, error: claimErr } = await supabase
      .from('phone_numbers')
      .update({
        user_id:     userId,
        assigned_at: new Date().toISOString(),
        pool_status: 'assigned',
      })
      .eq('id', cand.id)
      .is('user_id', null)
      .select('id, number')
      .maybeSingle();

    if (!claimErr && claimed) assignedNumbers.push(claimed.number);
  }

  const pool_remaining = await poolAvailableCount();
  console.log(`[Pool] Assigned ${assignedNumbers.length}/${requested} to ${userId} - ${pool_remaining} left in pool`);

  return {
    assigned:       assignedNumbers.length,
    requested,
    pool_remaining,
    numbers:        assignedNumbers,
  };
}

module.exports = {
  loadPoolNumbers,
  assignFromPool,
  poolAvailableCount,
  isUSTollFree,
  importToVapi,
};
