// ─────────────────────────────────────────────────────────────────────────────
// Title / Transaction Coordination Agent (Agent 7) - drives a deal from "assigned
// + EMD posted" to a clean, funded close, WITHOUT ever rendering a title opinion.
//
// JOB: once Disposition hands off (assignment signed, non-refundable EMD to title),
// this agent is the transaction coordinator. It tracks the closing pipeline - open
// title, clear the checklist, keep earnest money and deadlines honest, chase the
// missing document, flag the milestone that slipped - so nothing dies in escrow
// from neglect. It is the "closing doesn't fall through the cracks" enforcer.
//
// HARD LINE (spine rule 4 - NO LEGAL/TAX/TITLE OPINION): this agent does NOT decide
// whether title is clear, whether a lien is valid, whether a probate transfer is
// good, or how a defect should be cured. Those are opinions for the licensed title
// officer / closing attorney in that jurisdiction. This agent COORDINATES: it names
// what is open, whose ball it is, what deadline it threatens, and routes every
// title/legal question to the pro. It reports status; it does not opine on law.
//
// AUTONOMY + COMPLIANCE: it contacts no counterparty and moves no money - it is a
// read-and-coordinate brain that produces the next coordination action and the
// escalation. So it does not gate sends. Money movement and contract writes remain
// behind the human-approval hook (spine rule 8) - this agent proposes and tracks,
// it never wires funds or signs. It surfaces defects; the operator/pro acts.
//
// DETERMINISTIC LAYER: computeChecklist() is a no-model evaluator that turns the
// canonical record into a closing-checklist state (which milestones are done /
// open / missing / at-risk) so "a stalled closing is a logged defect" is real and
// testable, the same way Follow-Up's computeDue makes a missed follow-up a defect.
// ─────────────────────────────────────────────────────────────────────────────

const { runAgent } = require('./agentRuntime');

const NAME = 'title';

// Read-only. It reads shared memory to see where the deal is; it contacts no one,
// moves no money, writes no state. Least privilege: no send tools, no write tools.
const TOOL_ALLOWLIST = Object.freeze([
  'leadMemory.getLeadCanonical', // read-only shared memory (via runtime)
]);

// The closing milestones this coordinator tracks, in pipeline order. Each is a
// COORDINATION checkpoint (a thing that must happen and be evidenced), never a
// legal judgment about title quality.
const CLOSING_MILESTONES = Object.freeze([
  'assignment_signed',     // the assignment/purchase agreement is executed
  'emd_posted',            // non-refundable earnest money received by TITLE (not wholesaler)
  'title_opened',          // file opened with the title company / closing attorney
  'title_commitment',      // preliminary title report / commitment received (pro's document, not our opinion)
  'inspection_period',     // buyer inspection / due-diligence window status
  'clear_to_close',        // title company signals file is clear to close (their call, not ours)
  'closing_scheduled',     // closing/settlement date set
  'funded',                // deal funds and records - done
]);

const ROLE_PROMPT = `You are the TITLE / TRANSACTION COORDINATION AGENT - once a deal is under an executed assignment with earnest money posted to title, you are the transaction coordinator who drives it to a clean, funded close. Deals do not usually die because the math was wrong; they die because a document was never chased, an EMD was posted to the wrong party, or a deadline slipped while everyone assumed someone else had it. Your entire value is that nothing falls through the cracks in escrow.

WHAT YOU DO:
- Track the closing pipeline milestone by milestone: assignment executed → EMD posted to TITLE → title opened → commitment received → inspection/DD window → clear-to-close → closing scheduled → funded.
- For each milestone, state whether it is DONE, OPEN (in progress), MISSING (should exist and does not), or AT-RISK (a deadline threatens it).
- Name the single next coordination action and WHOSE ball it is (buyer, seller, title company, closing attorney, operator).
- Watch the money trail: earnest money must sit with TITLE/escrow, never the wholesaler; flag any EMD that is late, refundable when it should be non-refundable, or posted to the wrong party.
- Watch deadlines: inspection expiry, financing/appraisal contingency, closing date - flag anything inside a tight window before it lapses.

WHAT YOU NEVER DO (spine rule 4 - ABSOLUTE):
- You do NOT render a title, legal, or tax opinion. You do NOT decide whether title is clear, whether a lien/judgment/easement is valid or curable, whether a probate/estate/trust transfer is good, or how a cloud on title should be cured. Those are opinions only the licensed title officer or closing attorney in that jurisdiction may give.
- When a title/legal question appears (lien, defect, probate, boundary, back taxes, unknown heir, contract dispute), your job is to ROUTE it: name it plainly, mark routeToPro=true, and say which professional owns it. Reporting "the commitment shows an open lien - the closing attorney must advise on curing it" is coordination. Saying "the lien is invalid, ignore it" is a prohibited opinion - never do that.
- You do NOT move money, wire funds, or sign anything. Money movement and contract writes stay behind the human-approval hook (spine rule 8). You propose and track; a human/pro executes.

DATA HONESTY (spine rules 1-2): report only milestones the record actually evidences. Do not assume EMD was posted because an assignment was signed - if there is no evidence, mark it MISSING/UNKNOWN, not DONE. Label every status FACT (evidenced) / INFERENCE (reasoned) / UNKNOWN (no evidence).

The system has already computed a deterministic checklist from the record (see CHECKLIST_STATE). Trust it as the factual baseline; add coordination judgment on top - do not contradict an evidenced DONE/MISSING.

Answer ONLY as strict JSON, no prose outside it:
{
  "stage": "opening" | "title_review" | "due_diligence" | "clear_to_close" | "scheduling" | "funding" | "stalled" | "funded",
  "milestones": [
    {
      "name": "assignment_signed|emd_posted|title_opened|title_commitment|inspection_period|clear_to_close|closing_scheduled|funded",
      "status": "done|open|missing|at_risk",
      "owner": "buyer|seller|title|attorney|operator|unknown",
      "evidence": "what on record supports this status, or 'none'",
      "label": "FACT|INFERENCE|UNKNOWN"
    }
  ],
  "moneyTrail": {
    "emdToTitle": true,                 // EMD sits with title/escrow, not the wholesaler
    "emdNonRefundable": true,
    "concern": "any money-trail concern, or null"
  },
  "deadlineRisks": [ "the specific deadline at risk + which milestone it threatens" ],
  "nextAction": {
    "action": "the single next coordination move",
    "owner": "whose ball it is",
    "urgency": "routine|soon|urgent"
  },
  "routeToPro": false,                   // true if any title/legal/tax question must go to a licensed pro
  "routeReason": "what to route and to whom, or null",
  "handoff": {
    "readyToFund": false,
    "needsHuman": false,                 // stalled closing, money-trail concern, or slipping deadline
    "reason": "one line if any flag true"
  },
  "confidence": 0,
  "biggestRisk": "the one thing most likely to break this closing",
  "reasoning": "one paragraph, claims labeled FACT/ESTIMATE/INFERENCE/UNKNOWN"
}`;

/**
 * Scan the canonical record's memory/activity for evidence of a milestone. Pure,
 * no I/O. Matches on plain keywords in the append-only history (call outcomes,
 * activity types, key statements). Conservative by design: absence of evidence is
 * MISSING/UNKNOWN, never DONE - we never assume a step happened.
 *
 * @param {object} canonical  output of leadMemory.getLeadCanonical
 * @returns {{done:boolean, evidence:string|null}}
 */
function evidenceFor(canonical, keywords) {
  if (!canonical) return { done: false, evidence: null };
  const haystacks = [];
  (canonical.activity || []).forEach(a => {
    haystacks.push(`${a.activity_type || ''} ${a.type || ''} ${a.description || a.detail || a.note || ''}`);
  });
  (canonical.memory || []).forEach(m => {
    haystacks.push(`${m.call_outcome || ''} ${Array.isArray(m.key_statements) ? m.key_statements.join(' ') : ''}`);
  });
  const lead = canonical.lead || {};
  haystacks.push(`${lead.status || ''} ${lead.stage || ''} ${lead.deal_stage || ''}`);

  const hay = haystacks.join(' ').toLowerCase();
  const hit = keywords.find(k => hay.includes(k));
  return hit ? { done: true, evidence: `matched "${hit}" in deal history` } : { done: false, evidence: null };
}

// Keyword evidence per milestone. These are coordination signals in the history,
// not legal determinations.
const MILESTONE_SIGNALS = Object.freeze({
  assignment_signed: ['assignment signed', 'assigned', 'under contract', 'executed contract', 'ppa signed'],
  emd_posted:        ['emd posted', 'earnest money', 'emd received', 'earnest deposited'],
  title_opened:      ['title opened', 'opened title', 'escrow opened', 'sent to title', 'title company'],
  title_commitment:  ['title commitment', 'title report', 'prelim', 'commitment received'],
  inspection_period: ['inspection', 'due diligence', 'walkthrough', 'contractor bid'],
  clear_to_close:    ['clear to close', 'ctc', 'cleared to close'],
  closing_scheduled: ['closing scheduled', 'closing date', 'settlement date', 'signing scheduled'],
  funded:            ['funded', 'recorded', 'closed and funded', 'deal closed'],
});

/**
 * DETERMINISTIC closing-checklist evaluator (no model call). Turns the canonical
 * record into a per-milestone state so a stalled closing is a computable defect.
 * A milestone is DONE only if the history evidences it; the first not-yet-done
 * milestone in pipeline order is the current OPEN one; everything after it that
 * an earlier step implies should exist is MISSING. This never opines on title.
 *
 * @param {object} canonical  output of leadMemory.getLeadCanonical
 * @returns {{
 *   milestones: Array<{name:string,status:'done'|'open'|'missing'|'pending',evidence:string|null}>,
 *   stalledAt: string|null,
 *   emdConcern: boolean,
 *   funded: boolean
 * }}
 */
function computeChecklist(canonical) {
  const results = CLOSING_MILESTONES.map(name => {
    const { done, evidence } = evidenceFor(canonical, MILESTONE_SIGNALS[name]);
    return { name, done, evidence };
  });

  // Walk the pipeline: the first not-done milestone is the current OPEN one.
  // Steps before it that are not-done are MISSING (an earlier completed step
  // implies they should already exist). Steps after the OPEN one are PENDING.
  let openIndex = results.findIndex(r => !r.done);
  if (openIndex === -1) openIndex = results.length; // all done → funded

  const milestones = results.map((r, i) => {
    let status;
    if (r.done) status = 'done';
    else if (i === openIndex) status = 'open';
    else if (i < openIndex) status = 'missing'; // (only if a later step is done - handled below)
    else status = 'pending';
    return { name: r.name, status, evidence: r.evidence };
  });

  // Correct the "missing" call: a step before openIndex is only truly MISSING if
  // some LATER step is done (i.e. the pipeline skipped it). Otherwise it's just
  // the natural not-yet-reached state → pending.
  const anyLaterDone = i => results.slice(i + 1).some(r => r.done);
  milestones.forEach((m, i) => {
    if (m.status === 'missing' && !anyLaterDone(i)) m.status = 'pending';
  });

  const funded = results[results.length - 1].done;
  const emdDone = results.find(r => r.name === 'emd_posted')?.done;
  const assignmentDone = results.find(r => r.name === 'assignment_signed')?.done;
  // Money-trail concern: assignment signed but no evidence EMD was posted.
  const emdConcern = Boolean(assignmentDone && !emdDone);

  const stalledMilestone = milestones.find(m => m.status === 'open');
  return {
    milestones,
    stalledAt: funded ? null : (stalledMilestone ? stalledMilestone.name : null),
    emdConcern,
    funded,
  };
}

/**
 * Run one Title/Transaction Coordination turn. Reads the canonical record, computes
 * the deterministic checklist, and asks the model to add coordination judgment
 * (next action, ownership, deadline risk, route-to-pro) on top - WITHOUT rendering
 * any title/legal opinion. Pure analysis; no send, no money movement, no state write.
 *
 * @param {object} params
 * @param {string} params.userId        REQUIRED tenant (fence)
 * @param {string} [params.leadId]      the deal to coordinate (loads canonical memory)
 * @param {object} [params.memory]      pre-loaded canonical record (orchestrator handoff)
 * @param {string|object} [params.input] task framing
 * @param {string} [params.extraContext] upstream inputs (e.g. Disposition's assignment state)
 * @returns {Promise<object>} runAgent result, augmented with { checklist }
 */
async function run(params) {
  const { userId, leadId, memory, input, extraContext } = params || {};
  if (!userId) throw new Error('titleAgent.run: userId required');

  // Deterministic baseline the model must respect.
  const checklist = computeChecklist(memory || null);
  const checklistBlock = `CHECKLIST_STATE (deterministic - factual baseline, do not contradict evidenced done/missing):\n${JSON.stringify(checklist, null, 2)}`;

  const combinedContext = [checklistBlock, extraContext].filter(Boolean).join('\n\n');

  const result = await runAgent(
    { name: NAME, rolePrompt: ROLE_PROMPT, auditAction: 'agent.title.turn', maxTokens: 1100 },
    {
      userId,
      leadId,
      memory,
      input: input ?? 'Coordinate this closing: milestone status, money trail, deadlines, next action. Route any title/legal question to a licensed pro.',
      extraContext: combinedContext || undefined,
    }
  );

  return { ...result, checklist };
}

module.exports = {
  NAME,
  TOOL_ALLOWLIST,
  ROLE_PROMPT,
  CLOSING_MILESTONES,
  computeChecklist,
  evidenceFor,
  run,
};
