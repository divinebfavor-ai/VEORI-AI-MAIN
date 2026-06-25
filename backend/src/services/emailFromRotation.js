// ─────────────────────────────────────────────────────────────────────────────
// emailFromRotation — Tier 3b: deterministic multi-address / multi-domain
// from-rotation for cold email.
//
// WHY: Sending an entire cold campaign from ONE address concentrates all the
// volume + any spam signal on a single mailbox/domain — the fastest way to torch
// a sending reputation. Mature cold-email tools spread volume across several
// verified addresses (often on sibling domains) so no single inbox is overloaded
// and a flagged address doesn't sink the whole campaign. This picks one address
// from an optional pool, deterministically per recipient.
//
// CONFIG (all optional — unset = today's exact behavior):
//   EMAIL_FROM_POOL  comma-separated verified addresses, e.g.
//                    "alex@veori.net,alex@veori-offers.net,team@veori.net"
//   EMAIL_FROM       the single fallback (already used by emailService today).
//
// DETERMINISTIC per recipient (hash of seed) so a given lead always sees the same
// sender across their whole drip — a sender that changes mid-thread looks like
// spoofing and tanks trust. Different leads spread across the pool.
//
// SAFETY / ZERO-REGRESSION:
//   • Pure. No I/O, no deps beyond the local hash. Returns a plain address string.
//   • If EMAIL_FROM_POOL is unset/empty → returns the SAME defaultFrom emailService
//     already computes, so nothing changes until an operator opts in via env.
//   • Only addresses on VERIFIED domains should be put in the pool (Resend rejects
//     unverified senders) — this helper does not verify; it only selects.
// ─────────────────────────────────────────────────────────────────────────────

const { hash32 } = require('./emailSpintax');

// Parse EMAIL_FROM_POOL → a clean array of addresses (deduped, trimmed). Empty
// when the env is unset, so callers fall back to the single default.
function loadPool() {
  const raw = process.env.EMAIL_FROM_POOL || '';
  if (!raw.trim()) return [];
  const seen = new Set();
  const out = [];
  for (const part of raw.split(',')) {
    const addr = part.trim().toLowerCase();
    if (addr.includes('@') && !seen.has(addr)) {
      seen.add(addr);
      out.push(addr);
    }
  }
  return out;
}

// Choose a from-address for (seed). Returns `fallback` (the caller's existing
// default) when no pool is configured, so behavior is unchanged until opt-in.
//   @param {string} seed      stable per-recipient key (lead id / email)
//   @param {string} fallback  the address emailService would use today
function chooseFromAddress(seed, fallback) {
  const pool = loadPool();
  if (pool.length === 0) return fallback;
  if (pool.length === 1) return pool[0];
  const idx = (seed != null ? hash32(`from::${seed}`) : Math.floor(Math.random() * pool.length)) % pool.length;
  return pool[idx];
}

module.exports = { chooseFromAddress, loadPool };
