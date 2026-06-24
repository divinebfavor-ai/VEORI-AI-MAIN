/**
 * S4 — Field-level PII encryption (AES-256-GCM).
 *
 * WHY: A handful of fields are genuinely sensitive at rest — full bank routing /
 * account numbers being the sharpest. Today the bank-account route NEVER stores the
 * full number (it persists only `***last4`), which is safe-by-omission. This service
 * lets us optionally store the FULL value encrypted (so an operator can later view /
 * use it) WITHOUT ever putting plaintext in the database.
 *
 * DESIGN (honest + zero-regression):
 *   • Keyed by env `PII_ENCRYPTION_KEY` (64 hex chars = 32 bytes, or any string that
 *     we SHA-256 down to 32 bytes). If the key is ABSENT, encryption is disabled and
 *     `encrypt()` returns null — callers fall back to their existing masked-stub
 *     behavior, so nothing breaks before the operator sets a key.
 *   • AES-256-GCM with a random 12-byte IV per value; output is a self-describing
 *     compact string  v1:<ivB64>:<tagB64>:<ctB64>  so we can rotate formats later.
 *   • Authenticated (GCM tag) — tampered ciphertext fails closed on decrypt.
 *
 * This NEVER logs plaintext. It is additive — no existing field is migrated; new
 * writes can opt in.
 */
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const VERSION = 'v1';

// Derive a stable 32-byte key from the env secret. Accepts either a 64-char hex
// string (used directly) or any passphrase (hashed to 32 bytes). Returns null when
// unset so the whole feature stays dormant until the operator provisions a key.
function getKey() {
  const raw = process.env.PII_ENCRYPTION_KEY;
  if (!raw || !String(raw).trim()) return null;
  const s = String(raw).trim();
  if (/^[0-9a-fA-F]{64}$/.test(s)) return Buffer.from(s, 'hex');
  return crypto.createHash('sha256').update(s).digest(); // 32 bytes
}

// True when a usable key is configured. Routes can branch on this to decide whether
// to store an encrypted full value alongside the always-present masked stub.
function isEnabled() {
  return getKey() !== null;
}

// Encrypt a plaintext string → compact "v1:iv:tag:ct" (base64 parts). Returns null
// if encryption is disabled or the input is empty (caller keeps its fallback).
function encrypt(plaintext) {
  const key = getKey();
  if (!key) return null;
  if (plaintext == null || plaintext === '') return null;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

// Decrypt a "v1:iv:tag:ct" string back to plaintext. Returns null on any problem
// (no key, wrong format, bad tag) — fails closed, never throws to the caller.
function decrypt(blob) {
  try {
    const key = getKey();
    if (!key || !blob || typeof blob !== 'string') return null;
    const parts = blob.split(':');
    if (parts.length !== 4 || parts[0] !== VERSION) return null;
    const iv  = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const ct  = Buffer.from(parts[3], 'base64');
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  } catch {
    return null;
  }
}

// True if a stored value looks like our encrypted envelope (vs a legacy "***1234"
// masked stub). Lets routes safely handle a mix of old and new rows.
function isEncrypted(blob) {
  return typeof blob === 'string' && blob.startsWith(`${VERSION}:`) && blob.split(':').length === 4;
}

module.exports = { isEnabled, encrypt, decrypt, isEncrypted };
