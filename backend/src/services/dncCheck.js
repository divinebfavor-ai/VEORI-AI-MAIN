// ─── Internal do-not-contact lookup ──────────────────────────────────────────
// The one read every outbound gate uses. Two failure modes it closes:
//  • dnc_records can hold the same phone more than once (one row per operator).
//    .single()/.maybeSingle() ERROR on 2+ rows and return data=null, which every
//    old call site read as "not on the list" - a repeat opt-out became permission
//    to contact. This reads with limit(1).
//  • A lookup error must block contact, not allow it (fail closed).
// Phones are compared in E.164, matching how the database stores them.

const supabase = require('../config/supabase');
const { toE164 } = require('../utils/phone');

/**
 * @param {string} phone  any US format
 * @returns {Promise<{ onList: boolean, errored: boolean }>}
 */
async function checkInternalDnc(phone) {
  if (!phone) return { onList: false, errored: false };
  if (!supabase) return { onList: true, errored: true };
  const normalized = toE164(phone) || String(phone).trim();
  try {
    const { data, error } = await supabase.from('dnc_records').select('id')
      .eq('phone', normalized).is('revoked_at', null).limit(1);
    if (error) {
      console.error('[DNC] lookup failed - treating as do-not-contact:', error.message);
      return { onList: true, errored: true };
    }
    return { onList: (data || []).length > 0, errored: false };
  } catch (e) {
    console.error('[DNC] lookup failed - treating as do-not-contact:', e.message);
    return { onList: true, errored: true };
  }
}

/** true when contact must not happen (listed, or the lookup failed). */
async function isOnInternalDnc(phone) {
  return (await checkInternalDnc(phone)).onList;
}

module.exports = { checkInternalDnc, isOnInternalDnc };
