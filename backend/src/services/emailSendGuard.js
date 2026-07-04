// ─────────────────────────────────────────────────────────────────────────────
// emailSendGuard - Tier 3a: per-operator daily send caps + warmup ramp.
//
// WHY: New sending domains that suddenly blast hundreds of cold emails on day one
// get throttled or blocked by Gmail/Outlook - "warming up" (ramping volume over
// ~2 weeks) is the single biggest factor in landing in the inbox early on. And
// even a warmed domain needs a daily ceiling so one runaway campaign can't nuke
// reputation. This gate enforces BOTH, per operator, reading the existing
// email_log so no new counters/tables are required.
//
// SCOPE - COLD/MARKETING ONLY. Transactional mail (2FA, welcome, contract,
// title) must NEVER be throttled. isThrottleable(emailType) whitelists only the
// cold-drip + blast types; everything else bypasses the gate entirely.
//
// WARMUP CURVE: daily cap grows from EMAIL_WARMUP_START on the operator's first
// cold-send day, +EMAIL_WARMUP_STEP per day, capped at EMAIL_DAILY_CAP. Defaults
// (overridable via env): start 20, step 20, ceiling 300. Day 0 → 20, day 1 → 40,
// … day 14 → 300+. Conservative, industry-standard ramp.
//
// SAFETY / ZERO-REGRESSION:
//   • FAIL-OPEN: any Supabase/parse error → { allowed: true } so a missing
//     migration or a DB blip never blocks a send. The gate can only ever ADD a
//     ceiling, never break the existing send path.
//   • Reads ONLY email_log (existing). Writes nothing. Counting excludes rows it
//     itself marks 'throttled'/'suppressed' so retries don't double-count.
//   • If EMAIL_DAILY_CAP=0 the gate is globally disabled (explicit opt-out).
// ─────────────────────────────────────────────────────────────────────────────

const supabase = require('../config/supabase');

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const WARMUP_START = num(process.env.EMAIL_WARMUP_START, 20); // day-0 cap
const WARMUP_STEP  = num(process.env.EMAIL_WARMUP_STEP, 20);  // +per day
const DAILY_CAP    = num(process.env.EMAIL_DAILY_CAP, 300);   // ceiling (0 = disabled)

// Email types subject to warmup/caps. Cold outreach only - must match the types
// the drip (coldDrip1/2/3, possibly suffixed ":B") and the buyer blast use.
function isThrottleable(emailType) {
  if (!emailType) return false;
  const t = String(emailType).toLowerCase();
  return t.startsWith('colddrip') || t === 'email_blast';
}

// Compute the day-N cap for a given warmup day index (0-based).
function capForDay(dayIndex) {
  if (DAILY_CAP === 0) return Infinity;            // explicitly disabled
  const ramp = WARMUP_START + WARMUP_STEP * Math.max(0, dayIndex);
  return Math.min(ramp, DAILY_CAP);
}

// Find the operator's FIRST cold-send timestamp (warmup anchor). Returns null if
// none yet (their very first cold send → day 0). Fail-open returns null too.
async function firstColdSendAt(userId) {
  if (!supabase || !userId) return null;
  try {
    const { data } = await supabase
      .from('email_log')
      .select('sent_at')
      .eq('user_id', userId)
      .eq('status', 'sent')
      .order('sent_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    return data?.sent_at || null;
  } catch (_e) {
    return null;
  }
}

// Count cold sends already made TODAY (UTC day) for this operator. Only 'sent'
// rows count toward the cap - throttled/suppressed/failed do not.
async function sentTodayCount(userId) {
  if (!supabase || !userId) return 0;
  try {
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const { count } = await supabase
      .from('email_log')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'sent')
      .gte('sent_at', dayStart.toISOString());
    return count || 0;
  } catch (_e) {
    return 0;
  }
}

// MAIN GATE. Returns { allowed, cap, sentToday, reason }.
//   • Non-throttleable type → always allowed (transactional bypass).
//   • Otherwise compares today's cold-send count to the warmup-ramped cap.
// Fail-open: on any error → allowed:true (never block a send on a guard fault).
async function canSendCold(userId, emailType) {
  if (!isThrottleable(emailType)) return { allowed: true, reason: 'not_throttleable' };
  if (DAILY_CAP === 0) return { allowed: true, reason: 'cap_disabled' };
  if (!supabase || !userId) return { allowed: true, reason: 'no_db' };

  try {
    const firstAt = await firstColdSendAt(userId);
    let dayIndex = 0;
    if (firstAt) {
      const ms = Date.now() - new Date(firstAt).getTime();
      dayIndex = Math.floor(ms / 86400000);
    }
    const cap = capForDay(dayIndex);
    const sentToday = await sentTodayCount(userId);
    if (sentToday >= cap) {
      return { allowed: false, cap, sentToday, dayIndex, reason: 'daily_cap_reached' };
    }
    return { allowed: true, cap, sentToday, dayIndex, reason: 'within_cap' };
  } catch (_e) {
    return { allowed: true, reason: 'guard_error' };
  }
}

module.exports = { canSendCold, isThrottleable, capForDay, sentTodayCount, firstColdSendAt };
