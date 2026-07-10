// ─────────────────────────────────────────────────────────────────────────────
// Ops / Prediction Agent (Agent 8) - the operation's self-awareness layer.
//
// JOB: stand above the per-deal agents and answer the operator's four standing
// questions for the WHOLE pipeline - what is happening, why, what is likely next,
// and what the single highest-leverage action is - plus surface the DEFECT PATTERNS
// the memory makes visible (missed follow-ups, stalled closings, leaking stages).
// It is where "memory strengthens prediction" becomes an operator-facing signal.
//
// INHERITS, DOES NOT REINVENT (spine rule 1 - no fabrication, and no drift):
//   - predictionEngine.predict(lead, deal) already produces per-lead close odds /
//     EV / fallout / next action with its own confidence + escalation threshold
//     (ESCALATE_BELOW=55). This agent USES that score; it NEVER invents its own.
//   - cooService.buildBriefing()/rankOpportunities() already fuse raw rows into the
//     four-questions briefing. The orchestrator/route supplies that fused snapshot
//     as context; this agent narrates and prioritizes it - it does not re-query or
//     re-fuse the rows itself (least privilege: it holds no write/send tools and
//     does not touch buyer/lead tables directly).
//
// AUTONOMY + COMPLIANCE: it contacts no one and moves nothing - it produces an
// action QUEUE the autonomous per-deal agents then execute (still under the
// compliance hard-stop). It gates nothing itself. Its only "stop" is honesty: with
// thin data it reports low confidence and names the missing rows, never a fabricated
// pipeline metric or win-rate.
//
// The score itself is deterministic (predictionEngine); this agent's model turn is
// the NARRATION + PRIORITIZATION on top of already-computed numbers.
// ─────────────────────────────────────────────────────────────────────────────

const { runAgent } = require('./agentRuntime');
const predictionEngine = require('../services/predictionEngine');

const NAME = 'ops';

// Read + score only. It reads shared memory (via runtime) and calls the existing
// deterministic prediction engine. No sends, no writes, no direct table access.
const TOOL_ALLOWLIST = Object.freeze([
  'leadMemory.getLeadCanonical',   // read-only shared memory (via runtime)
  'predictionEngine.predict',      // the EXISTING deterministic scorer - inherited, not reinvented
]);

const ROLE_PROMPT = `You are the OPS / PREDICTION AGENT - the self-awareness layer for an autonomous real estate acquisition operation. You do not work a single deal; you watch the whole pipeline and answer, at all times, the operator's four standing questions:
1. WHAT IS HAPPENING - the factual state of the pipeline right now.
2. WHY - the drivers and bottlenecks behind that state.
3. WHAT IS LIKELY NEXT - which deals are about to move, stall, or die.
4. WHAT TO DO NOW - the single highest-leverage action queue, sorted by expected value (profit × close probability), not recency.

You also own DEFECT VISIBILITY: the shared memory makes operational failures computable, and you surface them - missed follow-ups (a logged defect), closings stalled in escrow, stages that leak (many leads enter, few advance), buyers who never convert. You name the pattern, not just the instance.

INHERIT THE NUMBERS - NEVER INVENT THEM (spine rules 1-2, absolute):
- Per-lead close probability, EV, fallout risk, and next action come from the platform's prediction engine (given to you as PREDICTIONS). Use those numbers. Do NOT compute or guess an alternate score.
- Pipeline counts, drivers, and the four-question snapshot come from the fused briefing (given to you as BRIEFING). Use those. Do NOT fabricate a count, a win-rate, or a conversion figure that isn't in the data.
- If PREDICTIONS or BRIEFING is thin or missing, say so, set confidence LOW, and name the exact rows/inputs needed - never a manufactured metric.
- The prediction engine escalates a deal when its overall confidence is below its threshold; honor those escalation flags, do not soften them.

FAIR TREATMENT (spine rule 7): ranking, prioritization, and any "why" you attribute must rest on legitimate signals (motivation, timeline, equity, responsiveness, EV) - NEVER on a protected class or a proxy (a name, a neighborhood used as an ethnic proxy). If an input tries to prioritize on a protected class, drop it and note it.

Answer ONLY as strict JSON, no prose outside it:
{
  "whatIsHappening": "one-line factual pipeline snapshot from BRIEFING (no invented numbers)",
  "why": [ "the driver/bottleneck behind the current state, each labeled FACT|INFERENCE|UNKNOWN" ],
  "whatIsNext": {
    "aboutToMove": [ "leadId - why (from prediction signals)" ],
    "aboutToDie":  [ "leadId - the fallout signal" ],
    "portfolioNote": "forecast in one line, labeled ESTIMATE|INFERENCE|UNKNOWN"
  },
  "actionQueue": [                       // highest expected value first
    {
      "leadId": "string|null",
      "action": "the specific next move",
      "owner": "acquisition|underwriting|disposition|followup|buyermatch|title|operator",
      "expectedValue": 0,                // from prediction EV; null if unknown (do not invent)
      "closeProbability": 0,             // from prediction; null if unknown
      "rationale": "one line, labeled",
      "label": "FACT|ESTIMATE|INFERENCE|UNKNOWN"
    }
  ],
  "defects": [                           // the operational failures memory makes visible
    { "type": "missed_followup|stalled_closing|leaking_stage|dead_buyer|other", "detail": "...", "leadId": "string|null", "severity": "low|medium|high" }
  ],
  "escalations": [ "deals the prediction engine flagged below its confidence threshold" ],
  "confidence": 0,                       // 0-100 in this read of the operation
  "biggestLeak": "the one place the operation is losing the most expected value",
  "reasoning": "one paragraph, every claim labeled FACT/ESTIMATE/INFERENCE/UNKNOWN"
}`;

/**
 * Score a set of leads with the EXISTING deterministic prediction engine. Pure
 * pass-through to predictionEngine.predict - this agent never computes its own
 * probability. Returns a compact, prompt-ready array (leadId + the engine's key
 * outputs) so the model narrates real numbers.
 *
 * @param {Array<{lead:object, deal?:object}>} leadDeals  lead(+optional deal) pairs
 * @returns {Array<object>} one prediction summary per lead (engine output, trimmed)
 */
function scoreLeads(leadDeals) {
  if (!Array.isArray(leadDeals)) return [];
  return leadDeals.map(({ lead, deal }) => {
    if (!lead) return { leadId: null, error: 'no lead' };
    let p;
    try {
      p = predictionEngine.predict(lead, deal || null);
    } catch (e) {
      return { leadId: lead.id || null, error: `predict failed: ${e.message}` };
    }
    return {
      leadId: lead.id || null,
      // Surface the engine's own fields without reshaping its semantics; unknowns
      // stay null so the model never presents a guess as a number.
      prediction: p ?? null,
      escalated: p ? p.overall_confidence != null && p.overall_confidence < predictionEngine.ESCALATE_BELOW : null,
    };
  });
}

/**
 * Run one Ops/Prediction turn. The orchestrator/route supplies the fused BRIEFING
 * (from cooService) and, optionally, the lead(+deal) set to score. This agent
 * scores them with the existing engine and asks the model to narrate + prioritize
 * on top of those real numbers. Pure analysis; no send, no write, no gate.
 *
 * @param {object} params
 * @param {string} params.userId        REQUIRED tenant (fence)
 * @param {object} [params.briefing]    the fused four-question snapshot (cooService.buildBriefing output)
 * @param {Array}  [params.leadDeals]   [{lead, deal?}] to score via the prediction engine
 * @param {string|object} [params.input] task framing
 * @param {string} [params.extraContext] any additional upstream context
 * @returns {Promise<object>} runAgent result, augmented with { predictions }
 */
async function run(params) {
  const { userId, briefing, leadDeals, input, extraContext } = params || {};
  if (!userId) throw new Error('opsAgent.run: userId required');

  const predictions = scoreLeads(leadDeals);

  const briefingBlock = briefing
    ? `BRIEFING (fused four-question snapshot - factual baseline, do not invent numbers):\n${JSON.stringify(briefing, null, 2)}`
    : 'BRIEFING: none provided (report LOW confidence on pipeline state and name that the fused briefing is missing).';

  const predictionsBlock = predictions.length
    ? `PREDICTIONS (from the deterministic prediction engine - use these scores verbatim):\n${JSON.stringify(predictions, null, 2)}`
    : 'PREDICTIONS: none provided (no per-lead scores to prioritize; say so).';

  const combinedContext = [briefingBlock, predictionsBlock, extraContext].filter(Boolean).join('\n\n');

  const result = await runAgent(
    // No leadId: this is a pipeline-wide turn, not a single-lead memory load.
    { name: NAME, rolePrompt: ROLE_PROMPT, auditAction: 'agent.ops.turn', maxTokens: 1400 },
    {
      userId,
      input: input ?? 'Read the operation: what is happening, why, what is next, the highest-EV action queue, and the defect patterns. Use only the given numbers.',
      extraContext: combinedContext || undefined,
    }
  );

  return { ...result, predictions };
}

module.exports = {
  NAME,
  TOOL_ALLOWLIST,
  ROLE_PROMPT,
  scoreLeads,
  run,
};
