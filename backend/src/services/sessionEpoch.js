// Session invalidation: every issued token carries the account's session epoch.
// Bumping the epoch (password reset, "sign out everywhere") makes every token
// issued before the bump stop working, which a plain JWT cannot do on its own.
// Cached briefly so this costs at most one read per account per TTL, not per request.

const supabase = require('../config/supabase');

const TTL_MS = Number(process.env.SESSION_EPOCH_CACHE_MS) || 60000;
const cache = new Map();

async function current(userId) {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.epoch;
  const { data, error } = await supabase.from('users').select('session_epoch').eq('id', userId).maybeSingle();
  if (error) throw new Error(`session lookup failed: ${error.message}`);
  const epoch = Number(data?.session_epoch || 0);
  cache.set(userId, { at: Date.now(), epoch });
  return epoch;
}

/** Invalidate every session for this account. Returns the new epoch. */
async function bump(userId) {
  const { data, error } = await supabase.rpc('bump_session_epoch', { p_user_id: userId });
  if (error) throw new Error(error.message);
  const epoch = Number(data || 0);
  cache.set(userId, { at: Date.now(), epoch });
  return epoch;
}

function forget(userId) { cache.delete(userId); }

module.exports = { current, bump, forget, TTL_MS };
