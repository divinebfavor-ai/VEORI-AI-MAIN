// ─── Public API keys ─────────────────────────────────────────────────────────
// Format: vk_live_<43 url-safe chars> (32 random bytes). Only a SHA-256 hash is
// stored; the raw key is returned once, at creation. A key acts for exactly one
// operator and only within its scopes.

const crypto = require('crypto');
const supabase = require('../config/supabase');

const KEY_PREFIX = 'vk_live_';
const SCOPES = [
  'leads:read', 'leads:write',
  'deals:read', 'deals:write',
  'buyers:read', 'buyers:write',
  'calls:read',
  'webhooks:manage',
];
const MAX_KEYS_PER_USER = 25;

function hashKey(raw) {
  return crypto.createHash('sha256').update(String(raw), 'utf8').digest('hex');
}

function publicShape(row) {
  return {
    id: row.id, name: row.name, prefix: row.prefix, scopes: row.scopes,
    last_used_at: row.last_used_at, expires_at: row.expires_at,
    revoked_at: row.revoked_at, created_at: row.created_at,
  };
}

class ApiKeyError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function createKey(userId, { name, scopes, expires_at: expiresAt } = {}) {
  const cleanName = String(name || '').trim();
  if (!cleanName || cleanName.length > 100) throw new ApiKeyError(400, 'name is required (1-100 characters)');
  const requested = Array.isArray(scopes) ? [...new Set(scopes.map(String))] : [];
  if (!requested.length) throw new ApiKeyError(400, `choose at least one scope: ${SCOPES.join(', ')}`);
  const unknown = requested.filter(s => !SCOPES.includes(s));
  if (unknown.length) throw new ApiKeyError(400, `unknown scope(s): ${unknown.join(', ')}`);
  let expires = null;
  if (expiresAt) {
    const d = new Date(expiresAt);
    if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) throw new ApiKeyError(400, 'expires_at must be a future date');
    expires = d.toISOString();
  }

  const { count, error: countErr } = await supabase.from('api_keys')
    .select('id', { count: 'exact', head: true }).eq('user_id', userId).is('revoked_at', null);
  if (countErr) throw new Error(countErr.message);
  if ((count || 0) >= MAX_KEYS_PER_USER) throw new ApiKeyError(400, `limit of ${MAX_KEYS_PER_USER} active keys reached - revoke one first`);

  const raw = KEY_PREFIX + crypto.randomBytes(32).toString('base64url');
  const { data, error } = await supabase.from('api_keys').insert({
    user_id: userId, name: cleanName, prefix: raw.slice(0, KEY_PREFIX.length + 6),
    key_hash: hashKey(raw), scopes: requested, expires_at: expires,
  }).select().single();
  if (error) throw new Error(error.message);
  return { key: raw, api_key: publicShape(data) };
}

async function listKeys(userId) {
  const { data, error } = await supabase.from('api_keys')
    .select('id, name, prefix, scopes, last_used_at, expires_at, revoked_at, created_at')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  return data || [];
}

async function revokeKey(userId, keyId) {
  const { data, error } = await supabase.from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId).eq('user_id', userId).is('revoked_at', null)
    .select('id');
  if (error) throw new Error(error.message);
  return (data || []).length > 0;
}

/**
 * Resolve a raw key to its row. Returns null for unknown, revoked or expired keys.
 * last_used_at is stamped at most once a minute per key to avoid a write per request.
 */
async function authenticate(raw) {
  if (typeof raw !== 'string' || !raw.startsWith(KEY_PREFIX) || raw.length > 200) return null;
  const { data, error } = await supabase.from('api_keys')
    .select('id, user_id, scopes, expires_at, revoked_at, last_used_at')
    .eq('key_hash', hashKey(raw)).maybeSingle();
  if (error || !data) return null;
  if (data.revoked_at) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) return null;
  const last = data.last_used_at ? new Date(data.last_used_at).getTime() : 0;
  if (Date.now() - last > 60 * 1000) {
    supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id)
      .then(({ error: e }) => { if (e) console.warn('[ApiKey] last_used_at update failed:', e.message); });
  }
  return data;
}

module.exports = { SCOPES, KEY_PREFIX, ApiKeyError, hashKey, createKey, listKeys, revokeKey, authenticate };
