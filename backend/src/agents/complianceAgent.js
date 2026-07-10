// ─────────────────────────────────────────────────────────────────────────────
// Compliance Agent (Agent 4) - the hard-stop authority every other agent calls.
//
// AUTHORITY: this agent can BLOCK an action no other agent can override. Per the
// spine (rule 6: compliance beats the close), when this agent returns allowed=false
// the action does not proceed. It is the only agent with veto power, and it is the
// only thing that stops the otherwise-autonomous agents - and it stops them only
// to keep actions legal, never to ask a human's permission.
//
// TWO LAYERS:
//   1. DETERMINISTIC GATE (agents/complianceGate): TCPA quiet hours, internal DNC,
//      federal DNC, state assignment bans, Fair Housing targeting scan. Fast, cheap,
//      no model call, fail-closed. This layer alone can hard-stop an action.
//   2. JUDGMENT LAYER (LLM via agentRuntime): only for the gray zones the rule table
//      can't decide - vulnerable-counterparty signals, securities/syndication smell,
//      an ambiguous creative structure (sub-to, novation), a disclosure that reads
//      as manipulation. Runs ONLY when asked (checkStructure), because a phone/SMS
//      send doesn't need an LLM to know it's 2 a.m.
//
// checkAction()   → deterministic only. Use before EVERY outbound send. No model call.
// checkStructure()→ deterministic + judgment. Use for deal STRUCTURE / disclosure /
//                   counterparty-risk decisions where reasoning is required.
//
// Both return a normalized decision the orchestrator reads the same way:
//   { allowed, blockingReasons:[...], warnings:[...], requiredDisclosures:[...],
//     escalate:boolean, escalateReason?, source:'gate'|'gate+judgment' }
// ─────────────────────────────────────────────────────────────────────────────

const { runAgent, gateAction } = require('./agentRuntime');
const { getStateCompliance } = require('../data/stateCompliance');

const NAME = 'compliance';

// Tools this agent is allowed to touch. It READS compliance data and the lead;
// it never sends, never writes deal state. Its only power is allow/deny.
const TOOL_ALLOWLIST = Object.freeze([
  'complianceGate.complianceGate',
  'stateCompliance.getStateCompliance',
  'leadMemory.getLeadCanonical', // read-only, via runtime
]);

const ROLE_PROMPT = `You are the COMPLIANCE AGENT - the legal hard-stop authority for an autonomous real estate acquisition operation. Every other agent must clear high-consequence decisions with you, and your block cannot be overridden by any other agent (only a human operator can override you, and only with an explicit logged decision).

Your job is NARROW and ABSOLUTE: decide whether a proposed action or deal structure is LEGAL and NON-MANIPULATIVE. You do not care about profit, speed, or the close - other agents own those. You care only about: TCPA/TSR, state wholesaling/assignment law, foreclosure-rescue statutes, Fair Housing Act, ECOA, RESPA, securities law (Reg D/CF/A+), FCRA, and the anti-manipulation / vulnerable-person protocol.

Deterministic legal checks (calling window, DNC, state assignment bans, Fair Housing targeting) have ALREADY been run by the gate and are given to you as GATE_RESULT. Do not re-litigate them - trust them. Your added value is the JUDGMENT the rule table cannot make:
- VULNERABLE COUNTERPARTY: elderly confusion, acute grief, foreclosure panic, apparent inability to understand the transaction → block or require human involvement.
- SECURITIES SMELL: any pooling of investor money, profit share, fractional interest, syndication → flag as presumptive security, block until securities counsel.
- MANIPULATION: false urgency, fabricated competing offers, a disclosure worded to confuse rather than inform → block.
- STRUCTURE LEGALITY: sub-to without demonstrated seller understanding, memorandum used as leverage, marketing property you don't own in a banned state → block, propose the compliant alternative.
- UNLICENSED-ACTIVITY DRIFT: language that claims to be an agent/broker, or gives binding legal/tax advice → block.

Answer ONLY as strict JSON, no prose outside it:
{
  "allowed": boolean,                // false = action must NOT proceed
  "blockingReasons": [ "..." ],      // empty if allowed
  "warnings": [ "..." ],             // proceed-but-note items
  "requiredDisclosures": [ "..." ],  // disclosures that must accompany the action
  "escalate": boolean,               // surface to human operator (does not by itself stop autonomy)
  "escalateReason": "...",           // required if escalate=true
  "reasoning": "one paragraph, claims labeled FACT/ESTIMATE/INFERENCE/UNKNOWN"
}
If GATE_RESULT already hard-stopped the action, keep allowed=false and echo its reasons - never loosen a gate block.`;

/** Merge the deterministic gate result into the normalized decision shape. */
function fromGate(gate) {
  return {
    allowed: gate.allowed,
    blockingReasons: gate.hardStops.map(h => `${h.code}: ${h.detail}`),
    warnings: gate.warnings.map(w => `${w.code}: ${w.detail}`),
    requiredDisclosures: gate.requiredDisclosures.slice(),
    escalate: !gate.allowed, // a hard block is worth surfacing
    escalateReason: gate.allowed ? undefined : gate.hardStops.map(h => h.code).join(', '),
    source: 'gate',
    checked: gate.checked,
  };
}

/**
 * DETERMINISTIC-ONLY check for a concrete outbound action (send SMS, place call,
 * send email, assign, record memorandum). No model call. Use before every send.
 * @param {object} action  complianceGate action shape (type, lead/phone/state, targetingText)
 * @param {object} [opts]   forwarded to the gate (e.g. skipFederalDnc)
 * @returns {Promise<object>} normalized decision (source:'gate')
 */
async function checkAction(action, opts) {
  const gate = await gateAction(action, opts);
  return fromGate(gate);
}

/**
 * DETERMINISTIC + JUDGMENT check for a deal STRUCTURE / disclosure / counterparty
 * decision. Runs the gate first (a gate hard-stop short-circuits and we do NOT
 * spend a model call), then the LLM judgment layer for the gray zones.
 *
 * @param {object} params
 * @param {string} params.userId        REQUIRED tenant
 * @param {string} [params.leadId]      lead in question (loads shared memory)
 * @param {object} [params.lead]        lead row (for gate state/phone if no leadId memory)
 * @param {string} params.actionType    e.g. 'assign_contract','subject_to','novation','send_offer'
 * @param {string} params.description    plain-language description of what is proposed
 * @param {object} [params.memory]       pre-loaded canonical record (orchestrator handoff)
 * @returns {Promise<object>} normalized decision (source:'gate+judgment')
 */
async function checkStructure(params) {
  const { userId, leadId, lead, actionType, description, memory } = params || {};
  if (!userId) throw new Error('complianceAgent.checkStructure: userId required');

  const stateCode = lead?.property_state || memory?.lead?.property_state || null;

  // Layer 1: deterministic gate on the structure action.
  const gate = await gateAction({
    type: actionType,
    lead: lead || memory?.lead,
    stateCode,
    targetingText: description, // scan the description for protected-class language too
  }, { skipFederalDnc: true }); // structure decisions aren't a live dial - skip network DNC

  const base = fromGate(gate);
  // A gate hard-stop is final - do not spend a model call to maybe soften it.
  if (!gate.allowed) {
    return { ...base, source: 'gate+judgment', judgmentSkipped: 'gate hard-stop is final' };
  }

  // Layer 2: LLM judgment for the gray zones.
  const sc = stateCode ? getStateCompliance(stateCode) : null;
  const gateSummary = {
    GATE_RESULT: {
      allowed: gate.allowed,
      warnings: gate.warnings,
      requiredDisclosures: gate.requiredDisclosures,
      state: sc ? { name: sc.state_name, risk: sc.risk_level, assignment_legal: sc.assignment_legal, notes: sc.notes } : null,
    },
  };

  const result = await runAgent(
    { name: NAME, rolePrompt: ROLE_PROMPT, auditAction: 'agent.compliance.structure', maxTokens: 900 },
    {
      userId,
      leadId,
      memory,
      input: { actionType, description },
      extraContext: JSON.stringify(gateSummary, null, 2),
    }
  );

  // If the model failed or returned unparseable output, FAIL CLOSED on the
  // judgment layer: keep the gate's allow but force an escalation so a human sees
  // a structure decision we couldn't reason about.
  if (!result.ok || !result.parsed) {
    return {
      ...base,
      source: 'gate+judgment',
      escalate: true,
      escalateReason: 'Compliance judgment layer unavailable - human review required for this structure.',
      warnings: [...base.warnings, 'Judgment layer produced no parseable decision; defaulting to escalate.'],
    };
  }

  const j = result.parsed;
  // The judgment layer can only TIGHTEN (block/escalate/add disclosures), never
  // loosen a gate decision.
  return {
    allowed: base.allowed && j.allowed !== false,
    blockingReasons: [...base.blockingReasons, ...(Array.isArray(j.blockingReasons) ? j.blockingReasons : [])],
    warnings: [...base.warnings, ...(Array.isArray(j.warnings) ? j.warnings : [])],
    requiredDisclosures: [...new Set([...base.requiredDisclosures, ...(Array.isArray(j.requiredDisclosures) ? j.requiredDisclosures : [])])],
    escalate: base.escalate || j.escalate === true,
    escalateReason: j.escalateReason || base.escalateReason,
    reasoning: j.reasoning,
    source: 'gate+judgment',
  };
}

module.exports = {
  NAME,
  TOOL_ALLOWLIST,
  ROLE_PROMPT,
  checkAction,
  checkStructure,
};
