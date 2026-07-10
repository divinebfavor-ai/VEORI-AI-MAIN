// ─────────────────────────────────────────────────────────────────────────────
// Disposition Agent (Agent 3) - the neglected half, run with acquisition-grade rigor.
//
// JOB: once a property is under contract (or verbally agreed), get it CLOSED on
// the buy side - build the buyer package, rank/verify buyers, drive to a signed
// assignment + non-refundable EMD to title, and keep a ranked backup list warm.
// It operates INSIDE the number Underwriting set: it never markets a spread that
// contradicts the MAO/ARV on record, and it never ships a dishonest package.
//
// DOCTRINE ALIGNMENT: inherits the platform's DISPOSITION doctrine verbatim
// (masterOperatorService.DISPOSITION) - POF dated <30d in the buying entity's
// name, non-refundable EMD ($2K-$10K scaled) to TITLE within 24-48h, daisy-chain
// defense, list-quality-over-size (top 5-10 fit buyers first, blast is fallback),
// package honesty (ARV range + comps + repairs basis + disclosures), ranked backup.
//
// AUTONOMY + COMPLIANCE: it acts freely to place the deal, BUT:
//   - Every buyer touch (blast/DM/email) is a SEND → clears complianceAgent.checkAction
//     before it goes (opt-out/DNC honored, no protected-class targeting in the
//     buyer segment - Fair Housing binds buyer selection too, spine rule 7).
//   - Marketing/assigning the PROPERTY in a state that bans unlicensed assignment
//     is a structure decision → clears complianceAgent.checkStructure, which will
//     hard-stop the assignment and propose the compliant alternative (double close).
//     This is exactly the "STATE_ASSIGNMENT_BANNED" gate; Disposition must respect it.
// ─────────────────────────────────────────────────────────────────────────────

const { runAgent } = require('./agentRuntime');
const complianceAgent = require('./complianceAgent');
const { DISPOSITION } = require('../services/masterOperatorService');

const NAME = 'disposition';

// Reads memory + dispo doctrine; proposes buyer outreach + assignment structure.
// It does not send directly and does not write deal state - the orchestrator
// performs the gated send and existing routes persist the assignment/EMD records.
const TOOL_ALLOWLIST = Object.freeze([
  'leadMemory.getLeadCanonical',          // read-only shared memory (via runtime)
  'masterOperatorService.DISPOSITION',    // the platform's own disposition rules
  'complianceAgent.checkAction',          // gate every buyer send
  'complianceAgent.checkStructure',       // gate the assignment structure (state bans)
]);

const DISPOSITION_DOCTRINE = typeof DISPOSITION === 'string' ? DISPOSITION : '';

const ROLE_PROMPT = `You are the DISPOSITION AGENT - you own the buy side of an autonomous real estate acquisition operation, and you run it with the same discipline as acquisition. A deal is not real until an end buyer with verified funds has signed the assignment and posted non-refundable EMD to title. You operate strictly INSIDE the number the Underwriting Agent set - you never market a spread that contradicts the ARV/MAO on record, and you never ship a package you can't defend.

You MUST follow the platform's disposition discipline (given below as DISPOSITION_DOCTRINE). In particular:
- BUYER VERIFICATION before commitment: proof of funds dated within 30 days in the buying entity's name; screen recycled/fabricated POF; smaller EMD tolerance + tighter timelines for first-time buyers.
- NON-REFUNDABLE END-BUYER EMD ($2K-$10K scaled to deal size) wired to TITLE, never to the wholesaler, within 24-48h of assignment signing. A buyer who won't post it is a tire kicker.
- DAISY-CHAIN DEFENSE: assignment prohibits re-assignment without written consent; watermark materials; blacklist a buyer who re-blasts your deal.
- LIST QUALITY OVER SIZE: match the top 5-10 verified fit buyers first; blast is the fallback.
- PACKAGE HONESTY: ARV range with comps attached, repairs with condition class and basis, photos, access, title status, fee structure per state disclosure norms. One dishonest package burns a buyer relationship worth dozens of closings.
- RANKED BACKUP: every deal carries a backup list; on a buyer-wobble signal (delayed EMD, post-inspection renegotiation, 48h unresponsive) activate the backup immediately and keep the seller informed.

HARD BOUNDARIES (spine + compliance):
- FAIR HOUSING BINDS BUYER SELECTION TOO (spine rule 7): rank buyers on verified closings, close speed, box fit, responsiveness - NEVER on protected-class proxies. No targeting a buyer segment by ethnicity/neighborhood-as-proxy.
- COMPLIANCE CAN HARD-STOP THE ASSIGNMENT: if the property is in a state that restricts unlicensed assignment, the structure gate will block "assign_contract"/"market_property" - you do NOT proceed with the assignment; you propose the compliant alternative (double close) it names. Respect it; never route around it.
- NO FABRICATION (spine rule 1): no invented buyer names, no fake POF, no phantom "other buyers" to pressure. If the buyer list is thin, say so and set needsHuman if the deal is at risk.
- NO LEGAL/TAX/TITLE OPINION (spine rule 4): route title defects and closing mechanics to the licensed pro / Title Agent.

Answer ONLY as strict JSON, no prose outside it:
{
  "stage": "packaging" | "marketing" | "buyer_vetting" | "assignment" | "emd_pending" | "assigned" | "backup_active" | "stuck",
  "package": {                          // the buyer-facing package state
    "ready": false,
    "arvRange": "low-high or null (from Underwriting, not invented)",
    "repairBasis": "condition class + basis or null",
    "disclosuresIncluded": [ "..." ],
    "gaps": [ "what's missing to make the package honest & complete" ]
  },
  "buyerOutreach": {                     // the next buyer touch you propose (or null)
    "strategy": "targeted_top_fit" | "blast_fallback" | null,
    "channel": "sms" | "email" | "call" | null,
    "message": "exact copy, watermarked, no protected-class targeting, or null",
    "targetCount": 0,
    "rationale": "why this set, one line"
  } | null,
  "assignment": {
    "structure": "assignment" | "double_close" | "undecided",
    "stateGateRequired": true,          // must clear checkStructure before assigning
    "emdRequirement": "amount + to-title + timeframe",
    "reassignmentProhibited": true
  },
  "backup": { "count": 0, "activateNow": false, "reason": "..." },
  "handoff": {
    "readyForTitle": false,             // assignment signed + EMD posted → Title Agent
    "needsHuman": false,                // thin list / buyer wobble risking the seller
    "reason": "one line if any flag true"
  },
  "confidence": 0,
  "biggestRisk": "the one thing most likely to break this disposition",
  "reasoning": "one paragraph, claims labeled FACT/ESTIMATE/INFERENCE/UNKNOWN"
}`;

/**
 * Run one Disposition turn. Reads the canonical record (the underwrite, the
 * property facts, any buyer signals) and proposes the next buy-side move.
 *
 * Proposed buyer outreach is a PROPOSAL - clear it via gateBuyerOutreach() before
 * sending. The assignment structure must clear gateAssignment() (state bans).
 * This function does not send and does not write deal state.
 *
 * @param {object} params
 * @param {string} params.userId        REQUIRED tenant (fence)
 * @param {string} [params.leadId]      the deal/lead to dispo (loads canonical memory)
 * @param {object} [params.memory]      pre-loaded canonical record (orchestrator handoff)
 * @param {string|object} [params.input] task framing
 * @param {string} [params.extraContext] upstream inputs (the Underwriting number is critical here)
 * @returns {Promise<object>} runAgent result
 */
async function run(params) {
  const { userId, leadId, memory, input, extraContext } = params || {};
  if (!userId) throw new Error('dispositionAgent.run: userId required');

  const doctrineContext = DISPOSITION_DOCTRINE
    ? `DISPOSITION_DOCTRINE (authoritative - dispo by these rules):\n${DISPOSITION_DOCTRINE}`
    : '';
  const combinedContext = [doctrineContext, extraContext].filter(Boolean).join('\n\n');

  return runAgent(
    { name: NAME, rolePrompt: ROLE_PROMPT, auditAction: 'agent.disposition.turn', maxTokens: 1200 },
    {
      userId,
      leadId,
      memory,
      input: input ?? 'Advance disposition: package, rank/verify buyers, drive to assignment + EMD.',
      extraContext: combinedContext || undefined,
    }
  );
}

/**
 * Compliance pre-flight for a buyer-facing send (blast/DM/email). The buyer
 * segment text is scanned for protected-class targeting (Fair Housing binds buyer
 * selection). A gate block is final.
 *
 * @param {object} args
 * @param {object} [args.lead]          the deal lead (for state/phone context)
 * @param {'sms'|'email'|'call'} args.channel
 * @param {string} [args.segmentOrMessage] buyer-segment rule or message copy to scan
 * @param {object} [opts]
 * @returns {Promise<object>} normalized compliance decision
 */
async function gateBuyerOutreach({ lead, channel, segmentOrMessage } = {}, opts) {
  const type =
    channel === 'sms' ? 'send_sms' :
    channel === 'call' ? 'place_call' :
    'send_email';
  return complianceAgent.checkAction(
    { type, channel, lead, targetingText: segmentOrMessage },
    opts
  );
}

/**
 * Compliance pre-flight for the ASSIGNMENT STRUCTURE. This is where the state
 * assignment-ban hard-stop fires - if it blocks, Disposition must NOT assign and
 * should adopt the proposed compliant alternative (double close).
 *
 * @param {object} args
 * @param {string} args.userId          REQUIRED tenant
 * @param {string} [args.leadId]
 * @param {object} [args.lead]          lead row (for property_state)
 * @param {object} [args.memory]        pre-loaded canonical record
 * @param {'assign_contract'|'market_property'|'record_memorandum'} [args.actionType]
 * @param {string} [args.description]   plain description of the structure
 * @returns {Promise<object>} normalized compliance decision (source:'gate+judgment')
 */
async function gateAssignment({ userId, leadId, lead, memory, actionType = 'assign_contract', description } = {}) {
  if (!userId) throw new Error('dispositionAgent.gateAssignment: userId required');
  return complianceAgent.checkStructure({
    userId,
    leadId,
    lead,
    memory,
    actionType,
    description: description || 'Assign the contract to an end buyer for a fee.',
  });
}

module.exports = {
  NAME,
  TOOL_ALLOWLIST,
  ROLE_PROMPT,
  run,
  gateBuyerOutreach,
  gateAssignment,
};
