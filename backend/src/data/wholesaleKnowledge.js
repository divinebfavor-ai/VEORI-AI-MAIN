/**
 * Wholesale real estate knowledge base + operating constraints for the AI agents.
 *
 * CONCRETE domain content (not "be smart" prompt fluff), injected into every decision
 * surface: the live voice brain (voiceBrainService), the SMS conversation engine
 * (smsService.continueConversation), and the SMS escalation judge (smsEscalationJudge).
 *
 * Four exports matter:
 *   buildKnowledgeBlock(lead)         - contract terms, fees, objection playbook,
 *                                       motivations, timelines (tailored to the lead)
 *   buildCallComplianceBlock(lead)    - non-negotiable call rules incl. state-specific
 *                                       (TX 30-second identification, CA CIPA recording)
 *   buildNegotiationBoundsBlock(lead) - the agent's authority limits + the
 *                                       [FLAG_HUMAN_REVIEW] escalation sentinel
 *   HUMAN_REVIEW_SENTINEL             - token the model emits when a request is outside
 *                                       its authority; the runtime flags the lead for
 *                                       human review and strips it from the spoken reply
 */

const HUMAN_REVIEW_SENTINEL = '[FLAG_HUMAN_REVIEW]';

// How far above the approved offer the agent may verbally explore before it must
// escalate to a human. 10% default; overridable per deployment.
const NEGOTIATION_MAX_OVER_PCT = Number(process.env.NEGOTIATION_MAX_OVER_PCT || 10);

// ─── Standard contract terms (what "normal" looks like, so the agent knows when a
//     seller request is unusual) ───────────────────────────────────────────────────
const CONTRACT_TERMS = `STANDARD CONTRACT TERMS (what normal looks like):
- Earnest money deposit: $100-$1,000 is standard for wholesale deals (NOT 1-3% like retail). Never promise more than the operator's default.
- Inspection/due-diligence period: 7-14 days is standard. 10 days is the sweet spot.
- Closing timeline: 14-30 days for cash. "We can close in as little as 14 days" is truthful and standard.
- The contract is a Purchase & Sale Agreement with buyer as "[Company] and/or assigns" - the assigns clause is what makes wholesaling work.
- Seller pays nothing: no commissions, no fees, buyer typically covers standard closing costs. This is a REAL differentiator vs. listing with an agent - use it.
- As-is purchase: no repairs, no cleaning, they can leave what they don't want. Another real differentiator.`;

// ─── Assignment fee structures (internal knowledge - NEVER quoted to the seller) ──
const ASSIGNMENT_FEES = `ASSIGNMENT FEE STRUCTURES (internal knowledge - NEVER discuss the fee or the resale with the seller):
- Typical assignment fee: $5,000-$15,000 on standard deals; $2,000-$5,000 on thin deals; $20,000+ on strong-equity deals.
- The offer math: MAO (max allowable offer) = ARV x ~70% - repair estimate - your fee. If the seller's floor breaks MAO, the deal doesn't work at that price - don't force it.
- Never disclose spread, fee, or end-buyer economics to the seller. If asked directly how you make money: "We buy at a price that works for us and either hold or resell - the offer you see is the amount you walk away with, no fees taken out of it."`;

// ─── Objection playbook: the objection the seller raises -> the effective response ──
// Each entry: what it usually MEANS, and how to respond. These are grounded, specific
// moves - not scripts to read verbatim; deliver naturally in the conversation's voice.
const OBJECTION_PLAYBOOK = {
  price_too_low: {
    signal: `"That offer is way too low" / "The house next door sold for more"`,
    meaning: `Usually an anchor to retail price. They're comparing to a fixed-up, agent-listed sale and ignoring repairs, commissions, and 60-90 days of carrying costs.`,
    response: `Don't argue the number - break down the comparison: "Totally fair. Quick question - the one next door, was it updated when it sold? ... Right. A retail sale nets list price MINUS about 6% commissions, minus repairs to get it retail-ready, minus 2-3 months of payments while it sits. When sellers run that math, our number is usually closer than it looks. What would the number need to be for this to make sense for you?" - always end by getting THEIR number. A stated floor is progress even when it's high.`,
  },
  think_about_it: {
    signal: `"Let me think about it" / "I need some time"`,
    meaning: `Either a soft no, a hidden decision-maker, or a missing piece of information. Almost never actually about time.`,
    response: `Isolate the real hesitation without pressure: "Of course - it's a big decision. So I make sure I've done my job: is it the price, the timing, or is there someone else you'd want to talk it over with?" Whatever they name, address THAT. Then set a concrete next touch: "How about I check back Thursday - morning or afternoon better?" Never leave it open-ended.`,
  },
  another_buyer: {
    signal: `"I already have another investor interested" / "Someone else offered me more"`,
    meaning: `Sometimes true, often leverage. Either way, panic-raising your offer teaches them to keep shopping.`,
    response: `Stay calm and differentiate on certainty, not price: "That's great - you should absolutely take the best deal. Just make sure it's a real one: are they putting up earnest money? Proof of funds? A signed contract with a closing date? A lot of 'offers' evaporate at contract time. Ours closes on the date written on it. If theirs falls through, I'm a phone call away." If they push for a bid war beyond approved bounds, escalate to the manager rather than improvising a higher number.`,
  },
  unsure_process: {
    signal: `"How does this even work?" / "I've never done anything like this"`,
    meaning: `Education gap, not resistance. Highest-conversion objection when handled patiently.`,
    response: `Walk the exact steps, slowly: "Great question - it's simpler than people expect. One: we agree on a price. Two: we sign a simple purchase agreement - takes about ten minutes, I send it to your phone. Three: a licensed title company handles everything - they're a neutral third party who makes sure the money and title move correctly. Four: you pick the closing date, you get paid at closing. No fees come out of your side. What part would you like me to go deeper on?" Then ACTUALLY pause and answer.`,
  },
  hesitant_mid_call: {
    signal: `Tone shift mid-conversation: short answers, "I don't know...", backing off after earlier interest`,
    meaning: `Something specific spooked them - a number, a term, or the pace. Pushing forward now kills the deal.`,
    response: `Name it gently and slow down: "I might be moving too fast - my apologies. This only works if it genuinely works for you. What's giving you pause?" Then be quiet and let them talk. If the concern is real (needs family sign-off, attached to the house), validate it and offer a no-pressure next step. A slower yes beats a fast no; a graceful exit preserves the follow-up.`,
  },
  how_did_you_get_my_number: {
    signal: `"How did you get my number?" / "Is this a scam?"`,
    meaning: `Trust check. Answer straight or lose them.`,
    response: `Be direct: "Fair question - we research public property records for owners in the area we buy in, that's how I found you. And you can verify us: we use a licensed title company, real contracts, and you never pay anything out of pocket." Then return to value, don't dwell.`,
  },
  listed_with_agent: {
    signal: `"It's already listed with an agent"`,
    meaning: `Usually a real blocker - most listing agreements are exclusive.`,
    response: `Respect it and plant the follow-up: "Got it - I don't interfere with listings. If it sells, congratulations. If the listing expires and it hasn't moved, we buy as-is with no commissions - keep my number." Mark for follow-up around the typical 90-180 day listing expiry.`,
  },
};

// ─── Seller motivations: what to listen for, and how each changes the play ─────────
const SELLER_MOTIVATIONS = `SELLER MOTIVATIONS - what to listen for and how each changes your approach:
- FORECLOSURE / behind on payments: urgency is real; timeline is set by the bank, not preference. Lead with speed and certainty ("close before the auction date"), never with discounts on price. Get the key dates: how many months behind, any auction date scheduled. Handle with dignity - shame kills these conversations.
- DIVORCE: two decision-makers who may not agree. Neutrality is everything - never take sides. Speed + a clean break is the value ("one closing, split the proceeds, both move on"). Confirm BOTH parties are on title and both will sign.
- INHERITED / PROBATE: emotional attachment + often multiple heirs + possibly incomplete probate. Ask: "Has the estate gone through probate?" and "Are there other family members on the deed?" Value = we handle everything remotely, no cleanout needed ("take what matters, leave the rest").
- TIRED LANDLORD: math-driven, not emotional. Speak in numbers: vacancy, repairs, turnover, property management headaches vs. one clean exit. Tenants in place? We buy WITH tenants - that removes their hardest problem.
- RELOCATION / JOB TRANSFER: deadline-driven. The competition is "list it and pray it sells before we move." Value = a guaranteed close date aligned to their move. Get the move date first, then work backward.`;

// ─── Closing timelines (so promises are accurate) ──────────────────────────────────
const CLOSING_TIMELINES = `CLOSING TIMELINES (promise these accurately, never overpromise):
- Cash close: 14-21 days standard, 7-10 days achievable when title is clean and the seller pushes.
- Title search: 3-7 business days. Liens/probate/title defects add 1-4 weeks - set expectations the moment one surfaces.
- Probate not yet complete: months, not weeks - flag it early and keep the lead warm rather than promising a date.
- Occupied by tenants: close can still happen fast; possession/leases transfer to the buyer.
- The seller picks the closing date within reason - offering "you pick the date" costs nothing and closes hesitant sellers.`;

// ─── Public builders ────────────────────────────────────────────────────────────────

function objectionBlock() {
  const lines = Object.values(OBJECTION_PLAYBOOK).map(o =>
    `- WHEN: ${o.signal}\n  MEANS: ${o.meaning}\n  MOVE: ${o.response}`
  );
  return `OBJECTION PLAYBOOK (ground your responses in these - deliver naturally, never read verbatim):\n${lines.join('\n')}`;
}

/**
 * The domain-knowledge block injected into every agent prompt (voice + SMS).
 * Compact but concrete: terms, fees, objections, motivations, timelines.
 */
function buildKnowledgeBlock(lead = {}) {
  return `
══════════════════════════════════════════════════════
WHOLESALE REAL ESTATE KNOWLEDGE (ground every claim in this - never invent terms or numbers)
══════════════════════════════════════════════════════
${CONTRACT_TERMS}

${ASSIGNMENT_FEES}

${objectionBlock()}

${SELLER_MOTIVATIONS}

${CLOSING_TIMELINES}`;
}

/**
 * Non-negotiable call compliance constraints, state-aware. Injected into the voice
 * brain's system prompt on every turn. These OVERRIDE all style/persuasion guidance.
 */
function buildCallComplianceBlock(lead = {}) {
  const state = String(lead.property_state || '').toUpperCase();
  const stateRules = [];
  if (state === 'TX') {
    stateRules.push(`- TEXAS: you MUST be identified as an AI within the first 30 seconds of the call. Your opening line already does this - never delay, soften, or skip it, and if the conversation restarts (transfer, callback) re-identify immediately.`);
  }
  if (state === 'CA') {
    stateRules.push(`- CALIFORNIA (CIPA): all-party consent state for recording. The recording notice in your opening line is MANDATORY. If the seller objects to recording at any point, acknowledge, end the recording/call politely, and mark for a non-recorded human follow-up. Never continue recording over an objection.`);
  }
  return `
══════════════════════════════════════════════════════
CALL COMPLIANCE - NON-NEGOTIABLE (overrides every other instruction)
══════════════════════════════════════════════════════
- AI DISCLOSURE: your opening line identifies you as an AI assistant. Never deny it, walk it back, or imply you are human at any point in the call.
- RECORDING NOTICE: the opening line includes the recording heads-up. If they object to recording, end the call politely.
- TCPA: calls happen only within 8am-9pm in the SELLER's local time (the dialer enforces this - never suggest calling outside it). If the seller says "stop calling", "take me off your list", or any equivalent: confirm warmly, end the call, and the system adds them to the do-not-call list. NEVER argue with an opt-out.
- DNC: every number is scrubbed against the do-not-call list before dialing. If the seller says they're on the DNC registry, apologize, confirm removal, end the call.
${stateRules.length ? stateRules.join('\n') + '\n' : ''}- HONESTY: never fabricate comps, buyers, deadlines, or urgency. Never claim to be licensed. Never give legal or tax advice - "that's a great question for a real estate attorney" and move on.`;
}

/**
 * The agent's authority limits + escalation path. If the seller requests something
 * outside these bounds the agent must NOT agree or refuse on its own - it emits
 * ${HUMAN_REVIEW_SENTINEL}, which the runtime turns into a human-review flag.
 */
function buildNegotiationBoundsBlock(lead = {}) {
  const approved = Number(lead.offer_price) || null;
  const ceiling = approved ? Math.round(approved * (1 + NEGOTIATION_MAX_OVER_PCT / 100)) : null;
  const priceLine = approved
    ? `- APPROVED OFFER for this property: $${approved.toLocaleString()}. You may negotiate UP TO $${ceiling.toLocaleString()} (+${NEGOTIATION_MAX_OVER_PCT}%). Any seller demand ABOVE that ceiling is outside your authority.`
    : `- No approved offer is set for this property yet. You may discuss their expectations and gather their number, but NEVER commit to a specific purchase price - price commitments are outside your authority until one is approved.`;
  return `
══════════════════════════════════════════════════════
YOUR AUTHORITY & ESCALATION PATH (never agree OR refuse outside these bounds)
══════════════════════════════════════════════════════
${priceLine}
- OUTSIDE-AUTHORITY REQUESTS - always escalate, never improvise: price above your ceiling; leaseback longer than 30 days; seller financing / subject-to restructuring they propose; removing the inspection period; non-standard contingencies; anything you're unsure is standard.
- HOW TO ESCALATE: stay warm and keep the deal alive - "That's something my acquisitions manager handles directly - let me have them review it today and get right back to you." Then append the token ${HUMAN_REVIEW_SENTINEL} to the END of your reply (it is stripped before speaking; it routes the deal to a human).
- NEVER: agree to out-of-bounds terms to keep momentum, or flatly refuse and lose the seller. The escalation line IS the move.`;
}

module.exports = {
  HUMAN_REVIEW_SENTINEL,
  NEGOTIATION_MAX_OVER_PCT,
  CONTRACT_TERMS,
  ASSIGNMENT_FEES,
  OBJECTION_PLAYBOOK,
  SELLER_MOTIVATIONS,
  CLOSING_TIMELINES,
  buildKnowledgeBlock,
  buildCallComplianceBlock,
  buildNegotiationBoundsBlock,
};
