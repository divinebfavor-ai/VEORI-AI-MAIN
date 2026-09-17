// Workspace ownership checks for ids that arrive in a request (params, body, query).
// The backend uses the service role, which bypasses RLS, so every foreign key a
// client supplies must be proven to belong to the caller's workspace before it is
// read, linked, or acted on.

const supabase = require('../config/supabase');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// table -> owner column. Only tables listed here can be checked.
const OWNER_COLUMN = {
  leads: 'user_id', deals: 'user_id', buyers: 'user_id', campaigns: 'user_id', calls: 'user_id',
  title_companies: 'user_id', listings: 'user_id', sms_templates: 'user_id', dfd_sessions: 'user_id',
  funding_partners: 'user_id', phone_numbers: 'user_id', contracts: 'user_id', virtual_tours: 'user_id',
};

/**
 * @returns {Promise<boolean>} true when id is null/empty (nothing to check) or owned by userId.
 * Throws on a database error so callers never treat a failed lookup as "owned".
 */
async function owns(userId, table, id) {
  if (id === undefined || id === null || id === '') return true;
  const col = OWNER_COLUMN[table];
  if (!col) throw new Error(`ownership: no owner column registered for ${table}`);
  if (!UUID_RE.test(String(id))) return false;
  const { data, error } = await supabase.from(table).select('id').eq('id', String(id)).eq(col, userId).maybeSingle();
  if (error) {
    if (error.code === '42P01') return false; // table not deployed: nothing can be owned
    throw error;
  }
  return !!data;
}

/**
 * Check several { table, id, label } refs; returns the label of the first one that is not owned, or null.
 */
async function firstForeign(userId, refs) {
  for (const r of refs) {
    if (!(await owns(userId, r.table, r.id))) return r.label || r.table;
  }
  return null;
}

module.exports = { owns, firstForeign, UUID_RE, OWNER_COLUMN };
