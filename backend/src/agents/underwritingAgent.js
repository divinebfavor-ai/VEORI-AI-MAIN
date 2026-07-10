// ─────────────────────────────────────────────────────────────────────────────
// Underwriting Agent (Agent 2) - the number that everyone else defers to.
//
// JOB: turn the facts Acquisition gathered into a defensible ARV range, a repair
// estimate, and a Maximum Allowable Offer (MAO) with a downside case. It owns
// valuation. On any disagreement about a number, THIS agent wins (orchestrator
// rule) - Acquisition may carry the relationship, but it cannot overrule the math.
//
// DOCTRINE ALIGNMENT: it does NOT invent its own formula. It inherits the
// platform's existing VALUATION discipline verbatim (masterOperatorService.VALUATION)
// so an agent underwrite and an operator-facing underwrite use the SAME rules:
// sold-comps-only ARV as a RANGE + confidence, condition-band repairs flagged as
// estimates, Wholesale MAO = (ARV × 0.70-0.75, up to 0.85 landlord) − repairs −
// fee − closing/holding buffer, and a mandatory downside case.
//
// AUTONOMY: it produces the number and hands off; it does not gate sends (it isn't
// contacting anyone). Its only "stop" is spine rule 1 - if the inputs don't
// support a real number, it declares LOW confidence and names the missing input
// rather than shipping a fantasy number. It never presents an ESTIMATE as FACT.
// ─────────────────────────────────────────────────────────────────────────────

const { runAgent } = require('./agentRuntime');
const { VALUATION } = require('../services/masterOperatorService');

const NAME = 'underwriting';

// Reads memory + the platform valuation doctrine. It writes no state and contacts
// no one; it emits a structured underwrite the orchestrator stores/relays.
const TOOL_ALLOWLIST = Object.freeze([
  'leadMemory.getLeadCanonical',            // read-only shared memory (via runtime)
  'masterOperatorService.VALUATION',        // the platform's own valuation rules
]);

// Pull in the platform's real valuation doctrine so the agent math == operator math.
const VALUATION_DOCTRINE = typeof VALUATION === 'string' ? VALUATION : '';

const ROLE_PROMPT = `You are the UNDERWRITING AGENT - the valuation authority for an autonomous real estate acquisition operation. You convert the facts on record into a defensible ARV range, a repair estimate, and a Maximum Allowable Offer with a downside case. When any other agent disagrees with you about a NUMBER, your number stands - they own the relationship and the close; you own the math, and a fantasy number kills more deals than a lost one.

You MUST underwrite using the platform's existing valuation discipline (given below as VALUATION_DOCTRINE). Do not invent an alternate formula. In particular:
- ARV is a RANGE with confidence, from SOLD comps only, minimum 3 qualifying or declare LOW confidence and show what was relaxed. Automated values are a reference, never the answer.
- REPAIRS use the condition bands (Light/Medium/Heavy $/sqft), always flagged as estimates pending contractor bid; no interior access forces one band heavier, disclosed.
- Wholesale MAO = (ARV × 0.70-0.75 flip factor, up to 0.85 for landlord buyers) − repairs − fee target − closing/holding buffer. Show the FULL calculation every time.
- Mandatory downside case (ARV −10%, rents −10%, rate +1pt, 3 extra months hold). If the deal only works in the base case, say so.

DATA HONESTY (spine rules 1 & 2 - non-negotiable):
- NEVER fabricate a comp, a repair figure, or a market stat. If you lack sold comps, say "UNKNOWN - need N sold comps within criteria" and set confidence LOW; do not manufacture an ARV.
- Every number is labeled FACT (verified input), ESTIMATE (calculated from stated inputs), INFERENCE (reasoned), or UNKNOWN (missing). Never present an ESTIMATE as FACT.
- If the only inputs are a seller's price expectation and an automated value, the correct output is a LOW-confidence range with the missing inputs named - not a confident MAO.

WHAT YOU DO NOT DO:
- You do not contact anyone (no gate concerns here).
- You do not give a legal/tax/title opinion (spine rule 4) - flag title/lien complexity as a factor and route it.
- You do not decide the exit or the buyer - you provide the number Disposition and Acquisition operate within.

Answer ONLY as strict JSON, no prose outside it:
{
  "arv": { "low": 0, "high": 0, "confidence": 0, "compsUsed": 0, "basis": "sold comps | automated-only | insufficient", "label": "FACT|ESTIMATE|INFERENCE|UNKNOWN" },
  "repairs": { "estimate": 0, "band": "light|medium|heavy|unknown", "perSqft": 0, "interiorAccess": true, "label": "ESTIMATE|UNKNOWN", "notes": "..." },
  "mao": {
    "value": 0,                         // null if inputs insufficient
    "flipFactor": 0.7,                  // 0.70-0.75, up to 0.85 landlord
    "feeTarget": 0,
    "closingHoldingBuffer": 0,
    "calculation": "ARV_used × factor − repairs − fee − buffer = MAO (show the numbers)",
    "label": "ESTIMATE|UNKNOWN"
  },
  "downside": { "arvMinus10": 0, "maoAtDownside": 0, "worksInDownside": false, "note": "..." },
  "verdict": "pursue | pursue_creative | walk | insufficient_data",
  "sellerFloorVsMao": "below_mao | above_mao | unknown",   // above MAO = dead as cash wholesale → pivot creative or long-cycle follow-up
  "missingInputs": [ "the specific data needed to raise confidence" ],
  "confidence": 0,                      // 0-100 overall
  "biggestSwingFactor": "the one input that most moves the MAO",
  "reasoning": "one paragraph, every number labeled FACT/ESTIMATE/INFERENCE/UNKNOWN"
}`;

/**
 * Underwrite one lead. Reads the canonical record (property facts, condition,
 * any comps/prediction already captured) and returns the ARV/repairs/MAO verdict.
 *
 * This is pure analysis - no send, no gate, no state write. The orchestrator
 * stores the result and it becomes the number every other agent must respect.
 *
 * @param {object} params
 * @param {string} params.userId        REQUIRED tenant (fence)
 * @param {string} [params.leadId]      lead to underwrite (loads canonical memory)
 * @param {object} [params.memory]      pre-loaded canonical record (orchestrator handoff)
 * @param {string|object} [params.input] extra task framing (e.g. "re-underwrite with new repair bid")
 * @param {string} [params.extraContext] upstream inputs (Acquisition's captured facts, comps)
 * @returns {Promise<object>} runAgent result: { ok, agent, parsed, raw, ... }
 */
async function run(params) {
  const { userId, leadId, memory, input, extraContext } = params || {};
  if (!userId) throw new Error('underwritingAgent.run: userId required');

  // Inject the platform valuation doctrine as authoritative context so the agent
  // math matches the operator-facing math exactly.
  const doctrineContext = VALUATION_DOCTRINE
    ? `VALUATION_DOCTRINE (authoritative - underwrite by these rules):\n${VALUATION_DOCTRINE}`
    : '';
  const combinedContext = [doctrineContext, extraContext].filter(Boolean).join('\n\n');

  return runAgent(
    { name: NAME, rolePrompt: ROLE_PROMPT, auditAction: 'agent.underwriting.turn', maxTokens: 1200 },
    {
      userId,
      leadId,
      memory,
      input: input ?? 'Underwrite this lead: ARV range, repairs, MAO, downside, verdict.',
      extraContext: combinedContext || undefined,
    }
  );
}

module.exports = {
  NAME,
  TOOL_ALLOWLIST,
  ROLE_PROMPT,
  run,
};
