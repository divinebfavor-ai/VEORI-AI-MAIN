// ─────────────────────────────────────────────────────────────────────────────
// emailSubjectAB - Tier 2b: A/B subject-line rotation for cold drips.
//
// WHY: Subject line is the single biggest lever on open rate. Sending ONE fixed
// subject to a whole list means you never learn which line works and you give
// spam filters one more constant to fingerprint. This rotates each drip step
// across a small set of equivalent subjects and records WHICH variant was used,
// so the existing email_log engagement columns (opened_at/open_count from Tier 1)
// already tell you the winner per variant - no new table needed.
//
// DETERMINISTIC per recipient: variant = hash(seed) % N, using the SAME seed as
// the spintax engine, so a lead's subject is stable across retries and matches
// the body they were given. No randomness drift between a send and its re-log.
//
// SAFETY / ZERO-REGRESSION:
//   • Pure data + one pure function. No I/O, no deps beyond the local hash.
//   • If a step/template has NO registered variants, chooseSubject returns the
//     ORIGINAL subject untouched and label 'A' - i.e. current behavior exactly.
//   • Variants are alternate phrasings ONLY; the address token is preserved so
//     the personalization the templates already do is never lost.
// ─────────────────────────────────────────────────────────────────────────────

const { hash32 } = require('./emailSpintax');

// Per cold-drip template, a small bank of equivalent subject lines. `${address}`
// is substituted from the same vars the template uses. The first entry mirrors
// the template's own subject so variant 'A' == today's behavior. Keep each bank
// short (2–3) so opens-per-variant stay statistically readable.
const SUBJECT_VARIANTS = {
  coldDrip1: [
    'Your property on ${address}',          // A - current
    'Quick question about ${address}',      // B
    'Cash offer for ${address}',            // C
  ],
  coldDrip2: [
    'Re: ${address}',                       // A - current
    'Following up - ${address}',            // B
    'Still thinking about ${address}?',     // C
  ],
  coldDrip3: [
    'Last note on ${address}',              // A - current
    'Closing the loop on ${address}',       // B
  ],
};

// Render a variant string's ${address} token from the provided vars.
function render(str, vars) {
  return String(str).replace(/\$\{address\}/g, vars?.address || 'your property');
}

// Choose a deterministic subject variant for (templateKey, seed).
// Returns { subject, variant } where variant is a letter A/B/C…
//   • Unknown templateKey OR empty bank → falls back to fallbackSubject (the
//     template's own subject) with variant 'A'. So non-drip templates and any
//     template without a registered bank are byte-for-byte unchanged.
function chooseSubject(templateKey, vars, seed, fallbackSubject) {
  const bank = SUBJECT_VARIANTS[templateKey];
  if (!bank || bank.length === 0) {
    return { subject: fallbackSubject, variant: 'A' };
  }
  const idx = (seed != null ? hash32(`subj::${seed}`) : Math.floor(Math.random() * bank.length)) % bank.length;
  const letter = String.fromCharCode(65 + idx); // 0→A, 1→B, …
  return { subject: render(bank[idx], vars), variant: letter };
}

module.exports = { chooseSubject, SUBJECT_VARIANTS };
