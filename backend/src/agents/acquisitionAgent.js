// ─────────────────────────────────────────────────────────────────────────────
// Acquisition Agent (Agent 1) - the deal-opener.
//
// JOB: own the seller side of the funnel from first touch to a signed-intent
// (verbal agreement / LOI-ready terms). It initiates and continues outreach,
// qualifies motivation and condition, handles objections, and negotiates toward
// a price the Underwriting Agent can stand behind. It does NOT set the number -
// Underwriting owns valuation - but it gathers the facts Underwriting needs and
// carries the human relationship.
//
// AUTONOMY: this agent acts. Per the spine, a started campaign IS the
// authorization; the agent does not pause for per-action human sign-off. The ONE
// thing that can stop an outbound touch is the Compliance gate:
//   - Before ANY concrete send (SMS/call/email/voicemail) the orchestrator (or
//     this agent's plan) must clear complianceAgent.checkAction. A gate block is
//     final; the agent then defers (quiet hours) or drops (DNC/opt-out) that touch
//     and moves on - it never routes around a block.
//
// MEMORY: it reads the canonical lead record (via runAgent) so it NEVER re-asks a
// question the operation already has an answer to, and every new fact it learns is
// meant to be written back through the existing memory routes (this agent proposes
// the memory delta; it does not write tables itself).
//
// OUTPUT: strict JSON the orchestrator can act on - the next message to send, the
// channel, the qualification it captured, and any hand-off signal (ready for
// underwriting / ready to disposition / dead / needs human).
// ─────────────────────────────────────────────────────────────────────────────

const { runAgent } = require('./agentRuntime');
const complianceAgent = require('./complianceAgent');

const NAME = 'acquisition';

// Tools this agent may touch. It READS memory/lead/state; it PROPOSES an outbound
// message and a memory delta. It does not send directly and it does not write deal
// state - the orchestrator performs the gated send and the existing routes persist
// memory. Least privilege: no valuation tools (that's Underwriting), no buyer data.
const TOOL_ALLOWLIST = Object.freeze([
  'leadMemory.getLeadCanonical',       // read-only shared memory (via runtime)
  'stateCompliance.getStateCompliance', // read-only, to word disclosures correctly
  'complianceAgent.checkAction',        // pre-flight gate for any proposed send
]);

const ROLE_PROMPT = `You are the ACQUISITION AGENT - the deal-opener for an autonomous real estate acquisition operation. You own the seller relationship from first contact to a verbal agreement / LOI-ready set of terms. You are persistent, warm, and genuinely useful to the seller; you solve their problem, and a fair deal for us falls out of solving it honestly.

WHAT YOU OWN:
- Initiate and continue outreach across the seller's best channel (call, SMS, email, voicemail).
- Qualify the four things that decide every deal: MOTIVATION (why sell, how urgent, real or idle), CONDITION (repairs, occupancy, liens/title flags the seller mentions), TIMELINE (how fast), and PRICE EXPECTATION (what they think it's worth and why).
- Handle objections without pressure. Move the conversation one concrete step forward each touch.
- Capture every new fact so it is written back to shared memory - never make the seller repeat themselves.

WHAT YOU DO NOT OWN:
- You do NOT set the offer number. The UNDERWRITING AGENT owns valuation and MAO; you gather inputs and relay their number. If the seller pushes for a figure before Underwriting has run, give a range ONLY if one is already on the canonical record, else say the analysis is being finalized.
- You do NOT give legal, tax, or title advice (spine rule 4). Route those to the licensed professional; you can explain how the process generally works.
- You do NOT choose the exit or the buyer - that is Disposition / Buyer Match.

HARD BOUNDARIES (the spine governs you; these are the ones you hit most):
- COMPLIANCE CAN STOP A SEND, YOU CANNOT ROUTE AROUND IT. If a proposed touch is gate-blocked (quiet hours, internal/federal DNC, opt-out), you DEFER it (quiet hours → next 8AM local) or DROP it (DNC/opt-out → stop, forever) and record that. Never propose a different channel to evade a DNC.
- NEVER MANIPULATE (spine rule 3). No false urgency, no fabricated competing offers, no exploiting a distressed or confused seller. If the seller shows grief, foreclosure panic, or apparent inability to understand the transaction, set handoff.needsHuman=true and say why.
- NEVER FABRICATE (spine rule 1). No invented comps, buyer names, or offers. Label what you infer.
- REQUIRED DISCLOSURES: if the canonical/state context includes a required disclosure, it must ride along with any offer/marketing language.

Answer ONLY as strict JSON, no prose outside it:
{
  "stage": "new" | "contacted" | "qualifying" | "negotiating" | "verbal_agreement" | "dead",
  "outreach": {                          // the single next touch you propose (or null if none this turn)
    "channel": "call" | "sms" | "email" | "voicemail" | null,
    "message": "exact copy to send, disclosures included, or null",
    "rationale": "why this touch, one line"
  } | null,
  "qualification": {                     // only fields you learned/confirmed THIS turn
    "motivation": "string | null",
    "motivationScore": 0,                // 0-100, INFERENCE
    "condition": "string | null",
    "timeline": "string | null",
    "priceExpectation": "string | null",
    "occupancy": "owner|tenant|vacant|unknown"
  },
  "memoryDelta": {                       // facts to persist so nobody re-asks
    "key_statements": [ "..." ],
    "objections": [ "..." ],
    "follow_up_date": "YYYY-MM-DD | null"
  },
  "handoff": {
    "readyForUnderwriting": false,       // enough facts for a real MAO
    "readyForDisposition": false,        // verbal agreement reached
    "needsHuman": false,                 // vulnerability / stuck / high stakes
    "reason": "one line if any handoff flag is true"
  },
  "confidence": 0,                       // 0-100 in this turn's read
  "biggestUnknown": "the one fact that would most change your next move",
  "reasoning": "one paragraph, claims labeled FACT/ESTIMATE/INFERENCE/UNKNOWN"
}`;

/**
 * Run one Acquisition turn for a lead. Reads shared memory (so it never re-asks),
 * produces the next proposed touch + captured qualification + handoff signal.
 *
 * The proposed outreach is a PROPOSAL - the caller must clear it through
 * gateOutreach() (compliance) before actually sending. This function does not
 * send and does not write memory.
 *
 * @param {object} params
 * @param {string} params.userId       REQUIRED tenant (fence)
 * @param {string} [params.leadId]     lead to work (loads canonical memory)
 * @param {object} [params.memory]     pre-loaded canonical record (orchestrator handoff)
 * @param {string|object} params.input the task/turn context (e.g. inbound reply text,
 *                                      or "open first touch")
 * @param {string} [params.extraContext] upstream agent output to consider
 * @returns {Promise<object>} runAgent result: { ok, agent, parsed, raw, ... }
 */
async function run(params) {
  const { userId, leadId, memory, input, extraContext } = params || {};
  if (!userId) throw new Error('acquisitionAgent.run: userId required');

  return runAgent(
    { name: NAME, rolePrompt: ROLE_PROMPT, auditAction: 'agent.acquisition.turn', maxTokens: 1100 },
    { userId, leadId, memory, input: input ?? 'Advance this lead one concrete step.', extraContext }
  );
}

/**
 * Compliance pre-flight for a proposed Acquisition outreach. Convenience wrapper
 * so the orchestrator gates an acquisition touch the same way every time. A
 * gate-block is FINAL - the caller must defer (quiet hours) or drop (DNC/opt-out),
 * never route around it.
 *
 * @param {object} args
 * @param {object} args.lead            lead/canonical.lead (needs phone, property_state)
 * @param {'call'|'sms'|'email'|'voicemail'} args.channel
 * @param {string} [args.messageText]   the copy, scanned for protected-class language
 * @param {object} [opts]               forwarded to the gate (e.g. skipFederalDnc)
 * @returns {Promise<object>} normalized compliance decision (source:'gate')
 */
async function gateOutreach({ lead, channel, messageText } = {}, opts) {
  const type =
    channel === 'sms' ? 'send_sms' :
    channel === 'email' ? 'send_email' :
    channel === 'voicemail' ? 'leave_voicemail' :
    'place_call';
  return complianceAgent.checkAction(
    { type, channel, lead, targetingText: messageText },
    opts
  );
}

module.exports = {
  NAME,
  TOOL_ALLOWLIST,
  ROLE_PROMPT,
  run,
  gateOutreach,
};
