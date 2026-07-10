// ─────────────────────────────────────────────────────────────────────────────
// orchestrator - the conductor that runs the 8 agents as ONE operation.
//
// WHAT IT ENFORCES (the three orchestration invariants from the spec):
//   1. COMPLIANCE-FIRST BLOCKING. No proposed SEND or STRUCTURE action reaches the
//      world until it clears the compliance gate. A block is FINAL - the orchestrator
//      does not route around it; it records the block and (for structure bans)
//      carries the compliant alternative forward. This is the ONLY thing that stops
//      the otherwise-autonomous agents (spine rules 6-7). Everything legal proceeds
//      WITHOUT a human-approval pause (autonomy is the product decision).
//   2. STRUCTURED STATE HANDOFF. Canonical lead memory is loaded ONCE and threaded
//      agent→agent (ctx.memory reuse) so a handoff is lossless and no agent re-asks
//      what the operation already knows. Each agent's parsed output is captured into
//      a running state object the next agent can read.
//   3. UNDERWRITING WINS ON NUMBERS. When any agent's number contradicts the
//      Underwriting number, Underwriting's figure is authoritative - the orchestrator
//      stamps the canonical MAO/ARV and flags the contradiction rather than letting a
//      downstream agent market a spread the math does not support.
//
// WHAT IT IS NOT: it does not itself SEND (SMS/email/call) or WRITE deal state -
// existing routes/services own those side effects. The orchestrator PLANS: it runs
// the analysis agents, runs the gate on any action they propose, and returns a
// structured decision the caller executes through the existing (already-gated) send
// path. Feature-flagged OFF by default (AGENTS_ENABLED) → zero blast radius until
// explicitly turned on. Tenant isolation: every run REQUIRES userId.
// ─────────────────────────────────────────────────────────────────────────────

const { getLeadCanonical } = require('./leadMemory');
const acquisitionAgent = require('./acquisitionAgent');
const underwritingAgent = require('./underwritingAgent');
const dispositionAgent = require('./dispositionAgent');
const complianceAgent = require('./complianceAgent');
const followUpAgent = require('./followUpAgent');
const buyerMatchAgent = require('./buyerMatchAgent');
const titleAgent = require('./titleAgent');
const opsAgent = require('./opsAgent');

// Master feature flag. Until this is explicitly enabled, the orchestrator refuses
// to run - the entire agent layer stays inert (engineering standard: flags OFF,
// small blast radius). The per-deal agents remain individually importable/testable.
const AGENTS_ENABLED = process.env.AGENTS_ENABLED === 'true';

/** Pull a numeric field from a parsed agent verdict, tolerant of shape. */
function num(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

/**
 * Establish the AUTHORITATIVE number for the deal. Underwriting owns valuation;
 * on any disagreement its MAO/ARV wins. Returns the canonical number block plus a
 * list of contradictions detected against other agents' outputs (for the audit /
 * escalation), never silently overwriting a downstream figure with a louder one.
 *
 * @param {object} underwriteParsed  underwritingAgent.run().parsed
 * @param {object} [otherNumbers]    { disposition?:parsed, ... } to check for drift
 * @returns {{ arv:{low,high}|null, mao:number|null, source:'underwriting'|'none', contradictions:string[] }}
 */
function reconcileNumbers(underwriteParsed, otherNumbers = {}) {
  const contradictions = [];
  if (!underwriteParsed) {
    return { arv: null, mao: null, source: 'none', contradictions };
  }
  const arv = underwriteParsed.arv
    ? { low: num(underwriteParsed.arv.low), high: num(underwriteParsed.arv.high) }
    : null;
  const mao = underwriteParsed.mao ? num(underwriteParsed.mao.value) : null;

  // Disposition markets inside the number - if its package ARV range drifts outside
  // Underwriting's ARV, that is a contradiction Underwriting wins.
  const dispo = otherNumbers.disposition;
  if (dispo && dispo.package && arv) {
    const range = String(dispo.package.arvRange || '');
    const m = range.match(/(\d[\d,]*)\s*[-–]\s*(\d[\d,]*)/);
    if (m) {
      const dLow = num(m[1].replace(/,/g, ''));
      const dHigh = num(m[2].replace(/,/g, ''));
      if ((dLow != null && arv.high != null && dLow > arv.high) ||
          (dHigh != null && arv.low != null && dHigh < arv.low)) {
        contradictions.push(
          `Disposition package ARV range ${range} is outside Underwriting ARV ${arv.low}-${arv.high}; Underwriting wins.`
        );
      }
    }
  }
  return { arv, mao, source: 'underwriting', contradictions };
}

/**
 * COMPLIANCE-FIRST gate for a proposed action. A single choke point: whatever an
 * agent proposes (a send or a structure), it clears HERE before the orchestrator
 * marks it executable. A block is final and returned as allowed:false with reasons.
 *
 * @param {object} proposal
 *   { kind:'send'|'structure', channel?, lead?, segmentOrMessage?, userId?, leadId?, memory?, actionType?, description? }
 * @returns {Promise<object>} normalized compliance decision (+ echoed proposal)
 */
async function gateProposal(proposal) {
  if (!proposal || !proposal.kind) {
    return { allowed: false, blockingReasons: ['no proposal to gate'], warnings: [], requiredDisclosures: [], escalate: false };
  }
  if (proposal.kind === 'send') {
    const channel = proposal.channel || 'call';
    const type = channel === 'sms' ? 'send_sms' : channel === 'email' ? 'send_email' : channel === 'voicemail' ? 'leave_voicemail' : 'place_call';
    const decision = await complianceAgent.checkAction(
      { type, channel, lead: proposal.lead, targetingText: proposal.segmentOrMessage },
      proposal.opts
    );
    return { ...decision, proposal };
  }
  // structure (assignment, sub-to, novation ...) - deterministic gate + judgment.
  const decision = await complianceAgent.checkStructure({
    userId: proposal.userId,
    leadId: proposal.leadId,
    lead: proposal.lead,
    memory: proposal.memory,
    actionType: proposal.actionType || 'assign_contract',
    description: proposal.description || 'Assign the contract to an end buyer for a fee.',
  });
  return { ...decision, proposal };
}

/**
 * Run a coordinated per-deal pass: Acquisition → Underwriting (number becomes
 * authoritative) → Disposition, with Follow-Up + Title status computed
 * deterministically and any proposed action gated compliance-first. This PLANS the
 * deal; it does not send or write state. Memory is loaded once and threaded through.
 *
 * @param {object} params
 * @param {string} params.userId   REQUIRED tenant fence
 * @param {string} params.leadId   the deal to advance
 * @param {object} [params.lead]   lead row (for gate state/phone context)
 * @param {Array}  [params.buyers] candidate buyers for the buyer-match ranking
 * @param {object} [params.stages] which agents to run (defaults to the full chain)
 * @returns {Promise<object>} structured plan: per-agent output + reconciled number +
 *          gated actions (each marked executable/blocked) + defects. Never sends.
 */
async function runDealPass(params) {
  const { userId, leadId, lead, buyers } = params || {};
  if (!AGENTS_ENABLED) {
    return { ok: false, disabled: true, reason: 'AGENTS_ENABLED is not true (agent layer is flagged off).' };
  }
  if (!userId) throw new Error('orchestrator.runDealPass: userId required');
  if (!leadId) throw new Error('orchestrator.runDealPass: leadId required');

  // 2. STRUCTURED STATE HANDOFF: load canonical memory ONCE, thread it everywhere.
  const memory = await getLeadCanonical(userId, leadId);
  if (!memory) {
    return { ok: false, reason: 'lead not found or not owned by this tenant', leadId };
  }

  const state = { userId, leadId, agents: {}, number: null, actions: [], defects: [], contradictions: [] };
  const ctxBase = { userId, leadId, memory };

  // --- Acquisition (opens/advances the seller relationship) ---
  const acq = await acquisitionAgent.run({ ...ctxBase });
  state.agents.acquisition = acq.parsed || { error: acq.error || 'no parse' };

  // --- Underwriting (the number everyone defers to) ---
  const uw = await underwritingAgent.run({ ...ctxBase });
  state.agents.underwriting = uw.parsed || { error: uw.error || 'no parse' };

  // --- Disposition (operates INSIDE the underwriting number) ---
  const dispo = await dispositionAgent.run({
    ...ctxBase,
    extraContext: uw.parsed ? `UNDERWRITING_NUMBER (authoritative - do not market outside this):\n${JSON.stringify(uw.parsed, null, 2)}` : undefined,
  });
  state.agents.disposition = dispo.parsed || { error: dispo.error || 'no parse' };

  // 3. UNDERWRITING WINS: reconcile and stamp the authoritative number.
  const reconciled = reconcileNumbers(uw.parsed, { disposition: dispo.parsed });
  state.number = reconciled;
  state.contradictions = reconciled.contradictions;

  // --- Buyer Match (ranks provided buyers; Fair Housing self-scan inside) ---
  if (Array.isArray(buyers) && buyers.length) {
    const bm = await buyerMatchAgent.run({ ...ctxBase, buyers });
    state.agents.buyermatch = bm.parsed || { error: bm.error || 'no parse' };
  }

  // --- Deterministic status layers (no model needed to know a defect exists) ---
  const due = followUpAgent.computeDue(memory);
  state.followUp = due;
  if (due.overdue) {
    state.defects.push({ type: 'missed_followup', detail: `Follow-up overdue (${due.temperature}, ${due.hoursSince}h since contact, cadence ${due.cadenceHours}h).`, leadId, severity: 'high' });
  }
  const checklist = titleAgent.computeChecklist(memory);
  state.closing = checklist;
  if (checklist.emdConcern) {
    state.defects.push({ type: 'money_trail', detail: 'Assignment signed but no evidence EMD was posted to title.', leadId, severity: 'high' });
  }
  if (checklist.stalledAt) {
    state.defects.push({ type: 'stalled_closing', detail: `Closing open at milestone "${checklist.stalledAt}".`, leadId, severity: 'medium' });
  }

  // 1. COMPLIANCE-FIRST: gate every ACTION the agents proposed before it can execute.
  // Acquisition proposed outreach?
  const acqOutreach = state.agents.acquisition?.outreach;
  if (acqOutreach && acqOutreach.channel && acqOutreach.message) {
    const decision = await gateProposal({
      kind: 'send', channel: acqOutreach.channel, lead: lead || memory.lead,
      segmentOrMessage: acqOutreach.message,
    });
    state.actions.push({ agent: 'acquisition', kind: 'send', executable: decision.allowed, decision });
  }
  // Disposition proposed a buyer send?
  const buyerOut = state.agents.disposition?.buyerOutreach;
  if (buyerOut && buyerOut.channel && buyerOut.message) {
    const decision = await gateProposal({
      kind: 'send', channel: buyerOut.channel, lead: lead || memory.lead,
      segmentOrMessage: buyerOut.message,
    });
    state.actions.push({ agent: 'disposition', kind: 'buyer_send', executable: decision.allowed, decision });
  }
  // Disposition assignment structure? (state assignment-ban hard-stop lives here)
  const assignment = state.agents.disposition?.assignment;
  if (assignment && assignment.structure && assignment.structure !== 'undecided') {
    const decision = await gateProposal({
      kind: 'structure', userId, leadId, lead: lead || memory.lead, memory,
      actionType: 'assign_contract',
      description: `Structure: ${assignment.structure}. ${assignment.emdRequirement || ''}`.trim(),
    });
    state.actions.push({ agent: 'disposition', kind: 'assignment_structure', executable: decision.allowed, decision });
  }

  return { ok: true, ...state };
}

/**
 * Run the pipeline-wide Ops/Prediction pass. The caller supplies the fused briefing
 * (cooService.buildBriefing output) and the lead(+deal) set; Ops narrates + ranks on
 * top of the existing deterministic prediction engine. No per-lead memory load here.
 *
 * @param {object} params  { userId, briefing?, leadDeals? }
 * @returns {Promise<object>} opsAgent.run result (+ predictions)
 */
async function runOpsPass(params) {
  const { userId } = params || {};
  if (!AGENTS_ENABLED) {
    return { ok: false, disabled: true, reason: 'AGENTS_ENABLED is not true (agent layer is flagged off).' };
  }
  if (!userId) throw new Error('orchestrator.runOpsPass: userId required');
  return opsAgent.run(params);
}

module.exports = {
  AGENTS_ENABLED,
  reconcileNumbers,
  gateProposal,
  runDealPass,
  runOpsPass,
};
