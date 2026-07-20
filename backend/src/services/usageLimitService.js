/**
 * Usage limits - the cushion on shared API credits.
 *
 * Veori fronts shared, metered services (RentCast property data, the AI chat model).
 * Without per-consumer caps, one heavy user - or one anonymous bot hammering the public
 * Aria chatbot - can drain the credits every other customer depends on. This service is
 * a simple daily counter with per-resource ceilings:
 *
 *   checkAndConsume(key, resource, limit) -> { allowed, used, limit, remaining }
 *
 * key is the operator's user id, or 'ip:<addr>' for anonymous traffic. Counters live in
 * usage_counters (key, resource, day) so limits hold across restarts and instances.
 * Soft caps: the read-then-write increment tolerates small races (a credit cushion, not
 * a billing ledger), and any DB failure FAILS OPEN with a warning - a metering hiccup
 * must never take down live business flows.
 *
 * Defaults (env-tunable) chosen for real operator workloads while protecting credits:
 *   ARIA_DAILY_LIMIT=100        logged-in chatbot messages / user / day
 *   ARIA_ANON_DAILY_LIMIT=15    anonymous chatbot messages / IP / day (bot cushion)
 *   RESEARCH_DAILY_LIMIT=50     RentCast lookups / operator / day (the 7-day per-lead
 *                               cache means real usage rarely approaches this)
 */

const supabase = require('../config/supabase');

const LIMITS = {
  aria_chat:          Number(process.env.ARIA_DAILY_LIMIT)      || 100,
  aria_chat_anon:     Number(process.env.ARIA_ANON_DAILY_LIMIT) || 15,
  property_research:  Number(process.env.RESEARCH_DAILY_LIMIT)  || 50,
};

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Consume one unit of `resource` for `key` if under the day's ceiling.
 * @returns {Promise<{allowed:boolean, used:number, limit:number, remaining:number}>}
 */
async function checkAndConsume(key, resource, limit = null) {
  const ceiling = limit != null ? limit : (LIMITS[resource] || 100);
  if (!key) return { allowed: true, used: 0, limit: ceiling, remaining: ceiling }; // no identity - don't block
  try {
    const day = today();
    const { data: row } = await supabase
      .from('usage_counters')
      .select('count')
      .eq('key', String(key)).eq('resource', resource).eq('day', day)
      .maybeSingle();

    const used = row?.count || 0;
    if (used >= ceiling) {
      return { allowed: false, used, limit: ceiling, remaining: 0 };
    }

    await supabase.from('usage_counters').upsert({
      key: String(key), resource, day, count: used + 1, updated_at: new Date().toISOString(),
    }, { onConflict: 'key,resource,day' });

    return { allowed: true, used: used + 1, limit: ceiling, remaining: ceiling - used - 1 };
  } catch (e) {
    console.warn(`[UsageLimit] ${resource} check failed (failing open):`, e.message);
    return { allowed: true, used: 0, limit: ceiling, remaining: ceiling };
  }
}

module.exports = { LIMITS, checkAndConsume };
