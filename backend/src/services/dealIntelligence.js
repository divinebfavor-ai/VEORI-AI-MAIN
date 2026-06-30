// ─────────────────────────────────────────────────────────────────────────────
// dealIntelligence — the "veteran read" layer of the acquisition brain.
//
// WHY: detectStrategy answers "HOW should we buy this house" and computeStrategyOffer
// answers "what are the NUMBERS." Neither answers the two questions a 10,000-deal
// veteran asks first:
//   1. WHO is this seller, really? (how motivated, what's driving them, what's their
//      alternative, how much leverage do WE have) — the psychology read.
//   2. Is this deal even WORTH chasing? (A / B / C / pass) — the deal-grade verdict,
//      so an operator never burns a call on junk and always knows how hard to push.
//
// This module is PURE: no I/O, no Supabase, no deps. It reads the same lead signals
// the rest of the brain already uses and returns a plain object. It NEVER throws and
// NEVER fabricates — when a signal is absent it simply doesn't claim it. Nothing here
// changes an existing function; it's a new, additive read consumed by the call prompt.
//
// SAFETY / ZERO-REGRESSION:
//   • Pure functions only. Importing this file has no side effects.
//   • Cash/wholesale leads still get a full read (grade + posture) — there is no
//     "creative-only" path here, so the default flow is enriched, never broken.
//   • Defensive on every field: missing → neutral, never an error.
// ─────────────────────────────────────────────────────────────────────────────

const n = (v, d = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
};
const lc = v => String(v == null ? '' : v).toLowerCase();
const arr = v => (Array.isArray(v) ? v : []);

// ── Motivation read ──────────────────────────────────────────────────────────
// How badly does this seller need OUT, and WHY. Distress + time pressure + carrying
// pain stack into a 0–100 motivation score with the human drivers spelled out, so
// the AI leads with the right emotional angle instead of a generic pitch.
function readMotivation(lead = {}) {
  const tag        = lc(lead.primary_tag);
  const secondary  = arr(lead.secondary_tags).map(lc);
  const indicators = arr(lead.motivation_indicators).map(lc);
  const notes      = lc(lead.notes);
  const arrears    = n(lead.arrears_amount);
  const months     = n(lead.months_behind);

  let score = 30; // neutral baseline — most sellers are explorers, not desperate
  const drivers = [];

  // Hard distress signals — these are the deepest, most time-bound motivators.
  if (tag === 'pre_foreclosure' || lead.has_lis_pendens || lead.foreclosure_stage) {
    score += 35; drivers.push('facing foreclosure — clock is running, credit on the line');
  }
  if (arrears > 0 || months > 0) {
    score += 12; drivers.push('behind on payments — monthly bleed they want to stop');
  }
  if (tag === 'tax_delinquent' || secondary.includes('delinquent_taxes')) {
    score += 14; drivers.push('tax delinquency — a lien growing every month');
  }
  if (tag === 'probate' || tag === 'inherited' || secondary.includes('recent_inheritance')) {
    score += 16; drivers.push('inherited/estate property — emotional + carrying a place they never wanted');
  }
  if (lead.is_vacant || tag === 'vacant') {
    score += 14; drivers.push('vacant property — paying to hold an empty house, zero upside');
  }
  if (secondary.includes('needs_repair') || /repair|rehab|condition|tired|burned out|nightmare/.test(notes + indicators.join(' '))) {
    score += 10; drivers.push('property needs work they don\'t want to do');
  }
  if (secondary.includes('landlord') || /tenant|eviction|bad renter|landlord/.test(notes + indicators.join(' '))) {
    score += 8; drivers.push('landlord fatigue — tired of tenants and management');
  }
  if (secondary.includes('out_of_state_owner') || lead.is_absentee_owner) {
    score += 6; drivers.push('absentee/out-of-state — managing from a distance is a hassle');
  }
  if (/divorce|relocat|job|moving|medical|death|behind/.test(notes + indicators.join(' '))) {
    score += 10; drivers.push('life event forcing a move (relocation/divorce/medical)');
  }

  score = Math.max(0, Math.min(100, score));
  const level = score >= 75 ? 'high' : score >= 50 ? 'moderate' : score >= 30 ? 'low' : 'cold';
  return { score, level, drivers };
}

// ── Leverage read ────────────────────────────────────────────────────────────
// Who holds the cards. Distress + thin alternatives + time pressure → WE have
// leverage (push, anchor low). Equity + no urgency + agent-listed → THEY have
// leverage (lead with terms/relief, never lowball). Returns a posture the
// negotiation layer keys off.
function readLeverage(lead = {}, motivation = null) {
  const mot     = motivation || readMotivation(lead);
  const equity  = n(lead.estimated_equity_percent);
  const isListed = lc(lead.primary_tag) === 'fsbo' || arr(lead.secondary_tags).map(lc).includes('fsbo') || !!lead.is_listed;
  const distressed = ['pre_foreclosure', 'tax_delinquent', 'vacant'].includes(lc(lead.primary_tag)) ||
    n(lead.arrears_amount) > 0 || lead.is_vacant;

  let ours = 0; // positive → buyer leverage, negative → seller leverage
  const factors = [];

  if (mot.score >= 75)      { ours += 2; factors.push('seller is highly motivated — time is on our side'); }
  else if (mot.score < 40)  { ours -= 1; factors.push('seller isn\'t pressed — they can wait us out'); }

  if (distressed)           { ours += 2; factors.push('distress + deadline limit their alternatives'); }
  if (equity >= 60)         { ours -= 2; factors.push('high equity — they can list and still win, don\'t lowball'); }
  else if (equity > 0 && equity < 25) { ours += 1; factors.push('thin equity — a cash sale barely clears the loan, terms beat cash'); }

  if (isListed)             { ours -= 1; factors.push('already listed — they have a retail path; respect their number'); }
  if (lead.is_vacant)       { ours += 1; factors.push('vacant — every month empty costs them, not us'); }

  const posture = ours >= 2 ? 'buyer' : ours <= -2 ? 'seller' : 'balanced';
  const guidance = posture === 'buyer'
    ? 'WE hold leverage. Anchor firm, let silence work, be willing to walk — they need the exit more than we need this house.'
    : posture === 'seller'
    ? 'THEY hold leverage. Do NOT lowball — you\'ll lose them in one sentence. Lead with terms, relief, or a near-retail creative structure that beats their alternative.'
    : 'Leverage is balanced. Earn trust first, uncover the real driver, and let the structure (cash vs terms) follow what THEY need.';

  return { posture, factors, guidance };
}

// ── Deal grade ───────────────────────────────────────────────────────────────
// The veteran's go/no-go verdict. Combines motivation (will they transact?) with
// economic room (is there a spread / a workable structure?). Grades A–D so the
// operator instantly knows: push hard (A), work it (B), be selective (C), or don't
// burn the call (D). Pure heuristic on the signals we have; honest when thin.
function gradeDeal(lead = {}, motivation = null, leverage = null) {
  const mot = motivation || readMotivation(lead);
  const lev = leverage   || readLeverage(lead, mot);
  const equity = n(lead.estimated_equity_percent);
  const arv    = n(lead.arv) || n(lead.estimated_value);

  let score = 0;
  const why = [];

  // Motivation is the single biggest driver of whether a deal closes.
  score += Math.round(mot.score * 0.5); // up to 50
  if (mot.level === 'high') why.push('strong, time-bound motivation');
  else if (mot.level === 'cold') why.push('little visible motivation — likely a long nurture');

  // Economic room: equity (cash spread) OR a clean creative structure (terms room).
  if (equity >= 50)      { score += 22; why.push('healthy equity for a cash spread'); }
  else if (equity >= 25) { score += 14; why.push('moderate equity — creative structure likely fits better than cash'); }
  else if (equity > 0)   { score += 8;  why.push('thin equity — terms/subject-to over cash'); }
  else if (n(lead.mortgage_balance) > 0) { score += 6; why.push('loan in place — subject-to/relief angle'); }

  if (arv > 0)           { score += 6;  why.push('we have a value basis to underwrite'); }
  if (lev.posture === 'buyer') { score += 8; why.push('buyer-side leverage'); }

  score = Math.max(0, Math.min(100, score));
  const grade = score >= 75 ? 'A' : score >= 55 ? 'B' : score >= 35 ? 'C' : 'D';
  const verdict = {
    A: 'A-DEAL — motivated seller with real room. Push to lock it on THIS call; don\'t let it cool.',
    B: 'B-DEAL — workable. Build rapport, find the structure, move toward a soft commitment + appointment.',
    C: 'C-DEAL — selective. Qualify hard before investing time; only advance if a clear driver surfaces.',
    D: 'D-DEAL — thin. Don\'t force it. Plant a seed, get permission to follow up, and move on — your time is the asset.',
  }[grade];

  return { grade, score, verdict, why };
}

// ── Top-level read ───────────────────────────────────────────────────────────
// One call → the whole veteran read. Consumed by the call-prompt builder. Pure.
function readDeal(lead = {}) {
  const motivation = readMotivation(lead);
  const leverage   = readLeverage(lead, motivation);
  const deal       = gradeDeal(lead, motivation, leverage);
  return { motivation, leverage, deal };
}

module.exports = { readMotivation, readLeverage, gradeDeal, readDeal };
