// ─────────────────────────────────────────────────────────────────────────────
// emailSpintax — Tier 2a: deterministic per-recipient message variation.
//
// WHY: The #1 reason cold drips land in spam at scale is FINGERPRINTING — every
// recipient gets a byte-identical body, so Gmail/Outlook hash it once and bulk-
// filter the rest. Spintax ({a|b|c}) lets one template render a different surface
// string per recipient while keeping the meaning identical. Top cold-email tools
// (Instantly, Smartlead) all do this; Veori had none.
//
// DETERMINISTIC, NOT RANDOM: the chosen branch is a hash of (seed + the option's
// position), so the SAME recipient always gets the SAME copy on a retry/resend —
// no "the follow-up reads differently than the first send" bug, and idempotent
// re-runs of a sequence step never flip wording. Pass the lead id/email as seed.
//
// SAFETY / ZERO-REGRESSION:
//   • Pure string in → string out. No I/O, no deps, no DB. Cannot throw on normal
//     input; malformed braces degrade to the literal text.
//   • A string with NO {a|b} groups is returned byte-for-byte unchanged, so every
//     existing template that doesn't use spintax is completely unaffected.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');

// Stable 32-bit unsigned hash of a string (FNV-1a). Same input → same number on
// every machine/run, so variant choice is reproducible per recipient.
function hash32(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Pick one option deterministically from a list, given a seed + a salt (the
// group's index in the string) so multiple groups in one template don't all
// resolve to the same slot.
function pickDeterministic(options, seed, salt) {
  if (options.length === 1) return options[0];
  const idx = hash32(`${seed}::${salt}`) % options.length;
  return options[idx];
}

// Render the innermost {a|b|c} groups, left to right, repeatedly until none
// remain (supports nesting). `seed` makes the choice stable per recipient; when
// no seed is given we fall back to crypto-random so ad-hoc one-off sends still
// vary. A literal pipe or brace that isn't a group is left as-is.
function spin(text, seed = null) {
  if (typeof text !== 'string' || text.indexOf('{') === -1) return text;

  let out = text;
  let guard = 0;                // hard cap so a malformed string can't loop forever
  const group = /\{([^{}]*)\}/;  // innermost group: no nested braces inside

  while (group.test(out) && guard < 1000) {
    guard++;
    out = out.replace(group, (match, inner, offset) => {
      if (inner.indexOf('|') === -1) return match; // not a real spintax group → leave literal
      const options = inner.split('|');
      if (seed != null) return pickDeterministic(options, seed, offset);
      // No seed → genuine random branch (single ad-hoc send).
      const r = crypto.randomBytes(1)[0] % options.length;
      return options[r];
    });
  }
  return out;
}

// Convenience: spin both subject and body of a template result with the SAME
// seed, so a given recipient's subject + body are drawn from one stable identity.
// Returns a NEW object; never mutates the input. Non-string fields pass through.
function spinTemplate(tpl, seed = null) {
  if (!tpl || typeof tpl !== 'object') return tpl;
  return {
    ...tpl,
    subject: typeof tpl.subject === 'string' ? spin(tpl.subject, seed) : tpl.subject,
    body: typeof tpl.body === 'string' ? spin(tpl.body, seed) : tpl.body,
  };
}

module.exports = { spin, spinTemplate, hash32 };
