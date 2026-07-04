// ─────────────────────────────────────────────────────────────────────────────
// negotiationPlaybook - the "chess" layer. How a master closer actually NEGOTIATES
// a live seller, per strategy and per leverage posture.
//
// WHY: knowing the strategy (subject-to) and the numbers (cash-to-seller $8k) is not
// the same as knowing how to WIN the conversation. A veteran anchors deliberately,
// concedes on a ladder (never in one jump), uses silence as a tool, and knows the
// exact moment to walk - because the willingness to walk is the strongest card at
// the table. This module encodes that play so the live AI negotiates like a closer,
// not a price-reader.
//
// PURE: no I/O, no deps. Reads a strategy key + a leverage posture (from
// dealIntelligence.readLeverage) and returns negotiation guidance text. Never throws.
//
// SAFETY / ZERO-REGRESSION:
//   • Additive. Consumed only by the call-prompt builder; changes no existing fn.
//   • Cash is fully supported here (it's the default strategy), so the wholesale call
//     gets the SAME chess upgrade - nothing is "creative-only".
//   • All guidance stays subordinate to the NON-NEGOTIABLE call rules (honesty, DNC,
//     AI disclosure, no pressure). This is HOW to negotiate fairly, not how to coerce.
// ─────────────────────────────────────────────────────────────────────────────

// Universal closing mechanics every strategy shares - the "rules of the board."
const CORE_TACTICS = [
  'ANCHOR ON VALUE, NOT PRICE FIRST. Establish what the property realistically is (condition, comps, what a retail sale would actually net them after fees + time + repairs) BEFORE any number. The number should feel like the logical conclusion, not an ambush.',
  'CONCEDE ON A LADDER, NEVER IN A LEAP. If you move, move in shrinking steps (e.g. small bump, then a tiny one) and ALWAYS trade for something (faster close, as-is, they leave items). A big instant jump screams there was room and kills your credibility.',
  'USE SILENCE. After you state a number or ask a closing question, STOP TALKING. Let them fill the gap. The first person to speak after the number usually loses it. Do not nervously justify.',
  'ISOLATE THE REAL OBJECTION. "Is it just the price, or is there something else?" Money is often a stand-in for fear, timing, or a spouse. Solve the real thing.',
  'TIE EVERY CONCESSION TO A CLOSE. Never give a better number for free - "If I can get closer to that, can we sign this week?" A concession without a commitment just resets their anchor lower.',
  'BE WILLING TO WALK - AND LET THEM FEEL IT. The strongest position is genuinely not needing this deal. A calm "I totally understand if the timing isn\'t right" often brings them back. Never beg, never chase.',
];

// Per-strategy negotiation DNA: the opening anchor, what you trade on, and the
// single line that wins this kind of deal.
const STRATEGY_NEGOTIATION = {
  cash: {
    anchor: 'Anchor to the AS-IS reality: their retail dream price minus agent fees, months of carrying, repairs, and showings. Your cash, certain, fast, as-is close is worth a real discount FOR A REASON - name the reasons.',
    tradeOn: ['speed of close', 'as-is / no repairs', 'no fees or commissions', 'certainty (no financing fall-through)', 'flexible move-out date'],
    walkTrigger: 'They want full retail with none of the retail work. If they\'re not feeling any pain and want top dollar, this is a nurture, not a close - don\'t chase price to zero margin.',
    winLine: '"I\'m not going to be your highest offer - I\'m going to be your easiest and most certain. No fees, no repairs, no waiting, you pick the date. What\'s that peace of mind worth to you?"',
  },
  subject_to: {
    anchor: 'Anchor on RELIEF, not price. The headline is "I take over the payments and catch up what you\'re behind" - the cash-to-seller is small and secondary. If you lead with a cash number on thin equity, you\'ve already lost.',
    tradeOn: ['stopping the monthly bleed today', 'reinstating arrears / saving their credit', 'a clean walk-away with no agent fees', 'a small cash amount at closing'],
    walkTrigger: 'They insist on a big cash check on a property with little/no equity, or they won\'t accept the loan staying in their name even after you explain the protections. No equity = no cash to give; don\'t invent it.',
    winLine: '"You walk away, the payments become my problem starting now, and I catch up everything you\'re behind. The weight is off you today - is that the relief you\'re after?"',
  },
  seller_finance: {
    anchor: 'Anchor on TOTAL VALUE over time, not a lump sum. A higher overall price + steady monthly income + spreading the tax hit beats a discounted cash offer. Compete against the CASH BUYER\'S lowball, not against their dream number.',
    tradeOn: ['a higher total price than any cash buyer', 'reliable monthly income', 'spreading capital-gains tax vs one big year', 'a fair down payment up front', 'interest that makes them the bank'],
    walkTrigger: 'They truly need 100% of the cash now (medical, debt payoff) - then terms don\'t serve them; pivot to cash or pass. Don\'t talk someone into financing they can\'t afford to wait on.',
    winLine: '"What if you became the bank - a solid down payment, a reliable check every month, a better total price than any cash buyer, and you spread the tax hit instead of eating it all in one year?"',
  },
  lease_option: {
    anchor: 'Anchor on REMOVING THE HEADACHE while their equity keeps growing. You\'re not buying their equity cheap - you\'re taking management off their plate now and locking a fair future price. Frame against the pain of being a landlord, not against a sale price.',
    tradeOn: ['zero management / no more tenant headaches', 'a steady monthly check', 'equity that keeps building', 'a locked future price', 'a non-refundable option fee that protects them'],
    walkTrigger: 'They want a clean, final exit and the cash today - a lease-option keeps them on title longer, which they\'ll hate. If "I just want it gone," pivot to cash.',
    winLine: '"I take the tenants and the headaches off your hands, send you a steady check, and lock a fair price to buy it down the road - and if I don\'t, you keep my fee and the house. Where\'s the downside for you?"',
  },
  novation: {
    anchor: 'Anchor CLOSE to their number - that\'s the whole appeal. Your edge isn\'t a discount; it\'s doing the retail work (marketing, buyer, closing) for them on a slightly longer timeline. Sell the OUTCOME (near their price, none of the hassle), not a markdown.',
    tradeOn: ['a price near their ask', 'you handle all marketing + showings + the buyer', 'no agent commission to a listing agent', 'they keep the home until you perform', 'a written contract that protects their price'],
    walkTrigger: 'The house needs heavy work (not light/cosmetic) or their ask already exceeds true retail - the spread evaporates and there\'s no deal to re-paper. Don\'t lock a contract you can\'t profitably resell.',
    winLine: '"I can get you right around your number - the difference is I bring the buyer and run the whole sale, so you skip the agent, the showings, and the repairs. Worth putting under contract this week?"',
  },
};

// How the leverage posture (from dealIntelligence.readLeverage) shifts the play.
function postureGuidance(posture) {
  switch (posture) {
    case 'buyer':
      return 'YOU HAVE THE LEVERAGE: anchor firmer, concede slower (or not at all), and use the walk-away freely - they need the exit. Stay warm, never arrogant; quiet confidence closes.';
    case 'seller':
      return 'THEY HAVE THE LEVERAGE: do NOT open with a number. Lead with the structure that beats their alternative (terms/relief/near-retail), build genuine trust, and earn the right to talk price. One lowball loses them.';
    default:
      return 'LEVERAGE IS BALANCED: invest in discovery first. Uncover the real driver, then let the right structure present itself. Whoever understands the other\'s true need wins the negotiation.';
  }
}

// Build the full negotiation block for a strategy + posture. Returns '' only if the
// strategy key is unrecognized (defensive); cash is always recognized.
function buildNegotiationBlock(strategyKey = 'cash', posture = 'balanced') {
  const key = String(strategyKey || 'cash').toLowerCase();
  const play = STRATEGY_NEGOTIATION[key];
  if (!play) return '';
  return `
══════════════════════════════════════════════════════
NEGOTIATION PLAYBOOK - play this like chess, always be a move ahead
══════════════════════════════════════════════════════
${postureGuidance(posture)}

YOUR ANCHOR: ${play.anchor}

TRADE CONCESSIONS ONLY FOR (never give for free):
${play.tradeOn.map(t => `- ${t}`).join('\n')}

KNOW WHEN TO WALK: ${play.walkTrigger}

THE LINE THAT WINS THIS DEAL:
${play.winLine}

CORE CLOSING MECHANICS (apply on every call):
${CORE_TACTICS.map(t => `- ${t}`).join('\n')}

Remember: every tactic here stays inside the NON-NEGOTIABLE RULES above - you win by
being the clearest, calmest, most genuinely helpful option in the room, never by
pressure, deception, or false urgency.`;
}

module.exports = { buildNegotiationBlock, postureGuidance, STRATEGY_NEGOTIATION, CORE_TACTICS };
