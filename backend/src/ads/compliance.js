// ─── Advertising compliance ──────────────────────────────────────────────────
// Two separate checks, both run on every piece of copy before it can be saved:
//
//  1. Fair housing (42 U.S.C. 3604(c)). It is unlawful to publish an
//     advertisement for the sale or rental of a dwelling that indicates a
//     preference, limitation or discrimination based on race, colour, religion,
//     sex, handicap, familial status or national origin. State and local law adds
//     classes. A buy-side ad is still an advertisement about a dwelling.
//  2. Claims. Anything a regulator would read as a promise: guarantees, "always",
//     invented authority, and figures presented as fact.
//
// A BLOCK stops the copy being stored. A WARN is surfaced to the operator and
// recorded on the creative. Nothing here is legal advice, and the output says so.

const PROTECTED = [
  { class: 'race or colour', words: ['white', 'black neighborhood', 'black neighbourhood', 'hispanic', 'latino', 'asian', 'caucasian', 'african american', 'ethnic'] },
  { class: 'religion', words: ['christian', 'catholic', 'jewish', 'muslim', 'church', 'synagogue', 'mosque', 'temple', 'god-fearing'] },
  { class: 'national origin', words: ['american only', 'no foreigners', 'immigrant', 'english speaking only', 'spanish speaking only'] },
  { class: 'sex', words: ['male only', 'female only', 'bachelor', 'ladies only', 'gentlemen only', 'husband', 'wife'] },
  { class: 'familial status', words: ['no kids', 'no children', 'adults only', 'childless', 'empty nester', 'perfect for singles', 'no families', 'mature couple'] },
  { class: 'disability', words: ['able-bodied', 'no wheelchairs', 'not handicap', 'handicapped', 'crippled', 'must be healthy', 'mentally'] },
  { class: 'age (state and local law)', words: ['elderly', 'seniors only', 'old people', 'young professionals', 'retirees only', 'too old to'] },
];

// Words that describe a person's circumstance in a way that shames them. Not
// unlawful, but they are the fastest way to lose the reader.
const DEMEANING = ['desperate', 'distressed seller', 'motivated seller', 'in trouble', 'can’t afford', 'cant afford', 'failing', 'hoarder', 'deadbeat', 'behind on your bills', 'poor'];

const GUARANTEE = [
  { pattern: /\bguarantee(d|s)?\b/i, why: 'A guarantee is a promise a regulator will hold the operator to.' },
  { pattern: /\b(always|never fails|100% of the time|every time)\b/i, why: 'An absolute claim cannot be substantiated.' },
  { pattern: /\bhighest (price|offer)\b/i, why: 'A superlative price claim requires proof of every competing offer.' },
  { pattern: /\bwe(\s+will)? beat any (offer|price)\b/i, why: 'An unconditional beat-any-offer claim is unsubstantiable.' },
  { pattern: /\bno risk\b/i, why: 'There is always risk; saying otherwise is a misrepresentation.' },
  { pattern: /\brisk[- ]free\b/i, why: 'Same as "no risk".' },
  { pattern: /\b(instant|immediate) (cash|approval|offer)\b/i, why: 'Implies a decision made before any property is seen.' },
  { pattern: /\bstop (the )?foreclosure\b/i, why: 'Only a lender or a court stops a foreclosure. Claiming to is a misrepresentation and, in several states, a regulated foreclosure-rescue offer.' },
  { pattern: /\bsave your (home|house|credit)\b/i, why: 'Foreclosure-rescue language. Several states license this activity specifically.' },
  { pattern: /\bgovernment (program|approved|backed)\b/i, why: 'Implies an authority the operator does not have.' },
  { pattern: /\b(we are|i am) (a |an )?(licensed|certified|accredited)\b/i, why: 'A licence claim must be true and name the licence and state.' },
];

// Testimonials are never generated. This catches copy that is shaped like one.
const TESTIMONIAL = [
  /"[^"]{25,}"\s*[-—]\s*[A-Z][a-z]+/,
  /\b(said|says|told us|wrote)\b[^.]{0,40}["“]/i,
  /\b[A-Z][a-z]+ (from|in) [A-Z][a-z]+ (said|says|got|received|sold)\b/,
];

const norm = (s) => String(s || '').toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ');

// One finding: { level, rule, detail, found, fix }
function check(text, { context = 'ad copy' } = {}) {
  const raw = String(text || '');
  const t = norm(raw);
  const findings = [];

  for (const g of PROTECTED) {
    for (const w of g.words) {
      if (t.includes(w)) {
        findings.push({
          level: 'block', rule: 'fair_housing', found: w,
          detail: `"${w}" refers to ${g.class}. Fair housing law forbids an advertisement about a dwelling from indicating a preference or limitation on that basis (42 U.S.C. 3604(c)).`,
          fix: 'Describe the property and the transaction. Never the person.',
        });
      }
    }
  }

  for (const w of DEMEANING) {
    if (t.includes(norm(w))) {
      findings.push({
        level: 'warn', rule: 'respect', found: w,
        detail: `"${w}" describes the reader as a problem. It is industry language, not the language the owner uses about themselves.`,
        fix: 'Write about the situation, in the words the owner would use.',
      });
    }
  }

  for (const g of GUARANTEE) {
    const m = raw.match(g.pattern);
    if (m) findings.push({ level: 'block', rule: 'unsubstantiated_claim', found: m[0], detail: g.why, fix: 'State only what the operator controls and has done before.' });
  }

  for (const p of TESTIMONIAL) {
    const m = raw.match(p);
    if (m) {
      findings.push({
        level: 'block', rule: 'fabricated_testimonial', found: m[0].slice(0, 80),
        detail: 'This is shaped like a customer quote. Veori never writes a testimonial. A quote may only appear if the operator supplies it and holds the sender’s written permission.',
        fix: 'Remove it, or paste the real quote and record who gave it.',
      });
      break;
    }
  }

  // Every number, not just money and durations: a bare count in an ad is a claim too.
  const numbers = raw.match(/\$\s?[\d,]+(?:\.\d+)?|\b\d+(?:\.\d+)?\s?%|\b\d[\d,]*(?:\.\d+)?(?:\s+(?:days?|weeks?|months?|years?|hours?|houses?|homes?|properties|deals?|closings?))?/gi) || [];
  return {
    context,
    ok: !findings.some(f => f.level === 'block'),
    blocked: findings.filter(f => f.level === 'block'),
    warnings: findings.filter(f => f.level === 'warn'),
    figures_used: numbers,
    figures_note: numbers.length ? 'Every figure above must trace to a record in this workspace. Veori does not publish a number it cannot source.' : null,
    disclaimer: 'Automated screening against common fair-housing and advertising-claim failures. It is not legal advice and does not replace review by counsel in the operator’s state.',
  };
}

// A checklist the operator signs off on, stored with the creative.
function checklist(market) {
  return [
    { item: 'Fair housing', question: 'Does anything in this ad describe the person rather than the property?', why: '42 U.S.C. 3604(c) applies to advertisements about dwellings, including ads to buy.' },
    { item: 'Substantiation', question: 'Can every number in this ad be traced to a record?', why: 'A figure you cannot source is a claim you cannot defend.' },
    { item: 'Timeline', question: 'Have you actually closed in the time this ad states?', why: 'A timeline you have not hit is a promise, not a claim.' },
    { item: 'Foreclosure rules', question: `Does ${market || 'this state'} license or restrict soliciting owners in default?`, why: 'Many states regulate foreclosure-rescue solicitation specifically, including required notices and rescission periods.' },
    { item: 'Licensing', question: 'Does this ad imply you are a licensed agent or broker?', why: 'Implying a licence you do not hold is an offence in every state.' },
    { item: 'Contact rules', question: 'Where does the responding lead land, and is consent captured there?', why: 'Ad-sourced leads still need consent before automated calling or texting.' },
    { item: 'Platform policy', question: 'Does the platform restrict housing ads for this audience?', why: 'Meta places housing ads in a special category with restricted targeting; running outside it can get the account disabled.' },
  ];
}

module.exports = { check, checklist, PROTECTED, GUARANTEE, DEMEANING };
