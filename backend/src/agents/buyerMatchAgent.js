// ─────────────────────────────────────────────────────────────────────────────
// Buyer Match Agent (Agent 6) - ranks the right buyers to a specific deal.
//
// JOB: given a deal (its underwrite, location, type, condition, exit) and the
// operator's buyer list, produce a RANKED short list of the best-fit buyers so
// Disposition markets to the top 5-10 first (list quality over size). It is the
// scoring brain behind Disposition's "targeted_top_fit" strategy.
//
// FAIR HOUSING IS ABSOLUTE HERE (spine rule 7): buyers are ranked ONLY on
// legitimate business criteria - verified closings, close speed, buy-box fit
// (geo/type/price/condition), proof-of-funds freshness, responsiveness. NEVER on
// race/ethnicity/religion/etc. or a proxy (a name, a neighborhood used as an
// ethnic proxy). The agent must refuse any ranking input that encodes a protected
// class and say so.
//
// AUTONOMY + COMPLIANCE: this agent does NOT contact anyone - it ranks. So it does
// not gate sends itself; Disposition gates the actual buyer outreach. The one
// "stop" it self-enforces is the Fair Housing scan on its OWN ranking criteria
// (via complianceGate.scanProtectedClass) - if the requested ranking rule encodes
// a protected class, it drops that criterion and flags it, rather than ranking on it.
// ─────────────────────────────────────────────────────────────────────────────

const { runAgent } = require('./agentRuntime');
const { scanProtectedClass } = require('./complianceGate');

const NAME = 'buyermatch';

const TOOL_ALLOWLIST = Object.freeze([
  'leadMemory.getLeadCanonical',       // read-only deal memory (via runtime)
  'complianceGate.scanProtectedClass', // self-check its ranking criteria for FH violations
]);

const ROLE_PROMPT = `You are the BUYER MATCH AGENT - you rank the operator's cash buyers to a specific deal so Disposition markets to the best-fit buyers first. A 50-buyer verified list beats a 5,000-contact scrape; your ranking is what makes that true. You never contact anyone - you produce a ranked, defensible short list.

RANK ONLY ON LEGITIMATE BUSINESS CRITERIA:
- Verified closings / track record (a buyer who actually closes outranks a louder one).
- Close speed and certainty (cash + fast + reliable).
- Buy-box FIT: geography, property type, price band, condition/rehab appetite, exit (flip vs landlord vs BRRRR).
- Proof-of-funds freshness (dated <30 days, in the buying entity's name) and EMD willingness.
- Responsiveness and clean-deal history (no daisy-chaining, no post-inspection retrades).

FAIR HOUSING IS ABSOLUTE (spine rule 7): you must NEVER rank, include, or exclude a buyer based on race, color, religion, national origin, sex, familial status, disability, or any protected class - and never via a proxy (a name's ethnicity, a neighborhood used as an ethnic proxy). If a ranking instruction encodes a protected class, DROP that criterion, rank on legitimate criteria only, and report it in "rejectedCriteria". The system has already scanned the criteria you were given (see FH_SCAN); honor it.

NO FABRICATION (spine rule 1): rank only the buyers actually provided. Do not invent a buyer, a closing count, or a POF. If the list is empty or thin, say so and set biggestGap. Label every fit judgment (FACT from verified data / INFERENCE from patterns / UNKNOWN).

Answer ONLY as strict JSON, no prose outside it:
{
  "ranked": [                            // best fit first, only real provided buyers
    {
      "buyerId": "string|null",
      "name": "string|null",
      "fitScore": 0,                     // 0-100 on legitimate criteria only
      "why": "the specific legitimate reasons (box fit, closings, speed)",
      "pofStatus": "fresh|stale|unknown",
      "flags": [ "e.g. first-time buyer → tighter EMD, or none" ],
      "label": "FACT|INFERENCE|UNKNOWN"
    }
  ],
  "topN": [ "the buyerIds Disposition should approach first (5-10)" ],
  "rejectedCriteria": [ "any ranking input dropped for encoding a protected class" ],
  "blastFallbackAdvised": false,         // true only if no strong targeted fit exists
  "biggestGap": "the missing buyer-data that would most improve the match",
  "confidence": 0,
  "reasoning": "one paragraph, claims labeled FACT/ESTIMATE/INFERENCE/UNKNOWN"
}`;

/**
 * Rank buyers to a deal. The buyer list + deal facts are passed as input/context
 * (the orchestrator supplies them from existing buyer tables/routes - this agent
 * does not query buyer tables directly; least privilege). Pure analysis, no send.
 *
 * Before ranking, this self-checks the caller-supplied ranking criteria for
 * protected-class language and passes the scan result to the model so it drops any
 * offending criterion rather than ranking on it.
 *
 * @param {object} params
 * @param {string} params.userId        REQUIRED tenant (fence)
 * @param {string} [params.leadId]      the deal (loads canonical memory for deal facts)
 * @param {object} [params.memory]      pre-loaded canonical record
 * @param {Array}  [params.buyers]      the operator's candidate buyers (from existing routes)
 * @param {string} [params.rankingCriteria] free-text ranking instruction to self-scan
 * @param {string|object} [params.input]
 * @param {string} [params.extraContext] e.g. the Underwriting number, deal box
 * @returns {Promise<object>} runAgent result
 */
async function run(params) {
  const { userId, leadId, memory, buyers, rankingCriteria, input, extraContext } = params || {};
  if (!userId) throw new Error('buyerMatchAgent.run: userId required');

  // Self-scan the ranking criteria for protected-class language (Fair Housing).
  const fhHits = rankingCriteria ? scanProtectedClass(rankingCriteria) : [];
  const fhScan = {
    FH_SCAN: {
      criteriaProvided: rankingCriteria || null,
      protectedClassHits: fhHits,
      instruction: fhHits.length
        ? 'These criteria encode protected-class terms. DROP them; rank on legitimate criteria only and list them in rejectedCriteria.'
        : 'No protected-class terms detected in the provided criteria.',
    },
  };

  const buyersBlock = Array.isArray(buyers) && buyers.length
    ? `CANDIDATE_BUYERS (rank only these real buyers):\n${JSON.stringify(buyers, null, 2)}`
    : 'CANDIDATE_BUYERS: none provided (report empty list; advise blast fallback only if truly no targeted fit).';

  const combinedContext = [
    `FH_SCAN:\n${JSON.stringify(fhScan.FH_SCAN, null, 2)}`,
    buyersBlock,
    extraContext,
  ].filter(Boolean).join('\n\n');

  return runAgent(
    { name: NAME, rolePrompt: ROLE_PROMPT, auditAction: 'agent.buyermatch.turn', maxTokens: 1200 },
    {
      userId,
      leadId,
      memory,
      input: input ?? 'Rank the candidate buyers to this deal on legitimate criteria only.',
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
