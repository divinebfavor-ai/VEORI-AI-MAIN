// ─── Phone Number Rotation & Health Service ───────────────────────────────────
if (process.env.NODE_ENV !== 'production') require('dotenv').config();
const supabase = require('../config/supabase');

const COOLDOWN_SECONDS = 90;        // 90s between calls on same number
const DAILY_MAX        = 50;        // hard limit per number per day
const WEEKLY_MAX       = 200;       // triggers 24h rest
const MIN_ANSWER_RATE  = 0.15;      // below this = flag for 48h

/**
 * Select the best available phone number for a call.
 * Priority: geographic match → health score → daily calls used
 */
async function selectBestNumber(userId, sellerState = null, excludeIds = []) {
  const now = new Date().toISOString();

  const { data: numbers, error } = await supabase
    .from('phone_numbers')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .not('health_status', 'eq', 'flagged')
    .not('health_status', 'eq', 'resting');

  if (error || !numbers?.length) return null;

  // Filter out numbers on cooldown or at daily limit
  const available = numbers.filter(n => {
    if (n.daily_calls_made >= (n.daily_call_limit || DAILY_MAX)) return false;
    if (n.cooldown_until && new Date(n.cooldown_until) > new Date()) return false;
    if (excludeIds.includes(n.id)) return false;
    return true;
  });

  if (!available.length) return null;

  // Reset daily counts if needed (new day)
  const today = new Date().toISOString().split('T')[0];
  for (const n of available) {
    if (n.last_reset_date !== today) {
      await supabase.from('phone_numbers').update({ daily_calls_made: 0, last_reset_date: today }).eq('id', n.id);
      n.daily_calls_made = 0;
    }
  }

  // Rule 3: Geographic matching — prefer same area code/state as seller
  if (sellerState) {
    const geoMatch = available.filter(n => n.state?.toLowerCase() === sellerState?.toLowerCase());
    if (geoMatch.length > 0) {
      return pickHealthiest(geoMatch);
    }
  }

  return pickHealthiest(available);
}

function pickHealthiest(numbers) {
  return numbers.sort((a, b) => {
    // Primary: health score descending
    const scoreDiff = (b.spam_score || 100) - (a.spam_score || 100);
    if (scoreDiff !== 0) return scoreDiff;
    // Secondary: fewest calls today
    return (a.daily_calls_made || 0) - (b.daily_calls_made || 0);
  })[0];
}

/**
 * Record a call starting on a number — apply cooldown
 */
async function recordCallStart(phoneNumberId) {
  const cooldownUntil = new Date(Date.now() + COOLDOWN_SECONDS * 1000).toISOString();
  await supabase.from('phone_numbers').update({
    daily_calls_made: supabase.rpc ? undefined : undefined, // handled below
    cooldown_until:   cooldownUntil,
    last_used:        new Date().toISOString(),
  }).eq('id', phoneNumberId);

  // Increment daily_calls_made
  const { data: phone } = await supabase.from('phone_numbers').select('daily_calls_made, weekly_calls_made').eq('id', phoneNumberId).single();
  if (phone) {
    const newDaily  = (phone.daily_calls_made || 0) + 1;
    const newWeekly = (phone.weekly_calls_made || 0) + 1;
    const updates   = { daily_calls_made: newDaily, weekly_calls_made: newWeekly };

    // Rule 5: weekly rest
    if (newWeekly >= WEEKLY_MAX) {
      const restUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      updates.health_status = 'resting';
      updates.cooldown_until = restUntil;
    }
    await supabase.from('phone_numbers').update(updates).eq('id', phoneNumberId);
  }
}

/**
 * Apply health score delta to a phone number after a call
 * Called by the Vapi webhook handler
 */
async function applyHealthDelta(phoneNumberId, { duration, outcome, answered }) {
  const { data: phone } = await supabase.from('phone_numbers').select('spam_score, daily_calls_made').eq('id', phoneNumberId).single();
  if (!phone) return;

  let delta = 0;
  if (!answered || !duration || duration < 15) delta = -10; // spam hang-up
  else if (duration < 60) delta = -5;                       // very short — suspicious
  else delta = 3;                                            // answered properly
  if (['appointment', 'offer_made', 'verbal_yes'].includes(outcome)) delta += 5;

  const newScore    = Math.max(0, Math.min(100, (phone.spam_score || 100) + delta));
  const healthStatus = newScore >= 70 ? 'healthy' : newScore >= 40 ? 'cooling' : 'flagged';

  // Rule 6: if health drops to flagged AND answer rate was low, rest for 48h
  const updates = { spam_score: newScore, health_status: healthStatus };
  if (healthStatus === 'flagged') {
    updates.cooldown_until = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    updates.health_status  = 'resting';
  }

  await supabase.from('phone_numbers').update(updates).eq('id', phoneNumberId);
}

/**
 * Reset all daily counts (run at midnight via cron/scheduler)
 */
async function resetDailyCounts() {
  const today = new Date().toISOString().split('T')[0];
  await supabase.from('phone_numbers').update({ daily_calls_made: 0, last_reset_date: today });
  console.log('[PhoneRotation] Daily counts reset');
}

/**
 * Recover health naturally over time (+2/hour when not calling)
 * Can be called periodically
 */
async function recoverHealthScores() {
  const { data: phones } = await supabase.from('phone_numbers').select('id, spam_score, last_used').lt('spam_score', 100).eq('is_active', true);
  if (!phones?.length) return;
  for (const p of phones) {
    const hoursSinceLastCall = p.last_used ? (Date.now() - new Date(p.last_used).getTime()) / 3600000 : 24;
    if (hoursSinceLastCall >= 1) {
      const recovery  = Math.floor(hoursSinceLastCall) * 2;
      const newScore  = Math.min(100, (p.spam_score || 0) + recovery);
      const newStatus = newScore >= 70 ? 'healthy' : newScore >= 40 ? 'cooling' : 'flagged';
      await supabase.from('phone_numbers').update({ spam_score: newScore, health_status: newStatus }).eq('id', p.id);
    }
  }
}

module.exports = { selectBestNumber, recordCallStart, applyHealthDelta, resetDailyCounts, recoverHealthScores };
