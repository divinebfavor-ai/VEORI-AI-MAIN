// ─────────────────────────────────────────────────────────────────────────────
// Follow-Up Agent (Agent 5) - the zero-missed-follow-up enforcer.
//
// PRINCIPLE (from doctrine): most conversions come from follow-up, not first
// contact. No lead is dead for 24 months absent an opt-out or a resolution. A
// missed follow-up is a LOGGED DEFECT, not a soft miss. This agent's entire job is
// to make sure the operation never drops a lead on the floor.
//
// CADENCE (inherited from masterOperatorService.COUNTERPARTY, verbatim intent):
//   - Hot   (motivation 70+) : every 48-72 hours
//   - Warm  (40-69)          : weekly, then bi-weekly
//   - Cold  (<40)            : monthly value-touch
//   - Every touch references prior conversation specifics - never make anyone
//     repeat themselves (the canonical memory makes this possible).
//
// WHAT IT DOES:
//   1. computeDue(canonical) - PURE, deterministic: given a lead's last-contact
//      time + temperature, is a follow-up DUE/OVERDUE right now, and when is the
//      next one due? No model call. This is the defect detector.
//   2. run() - the LLM turn: for a due lead, draft the next touch that references
//      the specific prior conversation and moves it forward, on the right channel.
//
// AUTONOMY + COMPLIANCE: it schedules and drafts freely; the actual send clears
// complianceAgent.checkAction first (quiet hours DEFER, DNC/opt-out DROP forever).
// An opt-out is the ONE thing that ends the 24-month cadence early - and the gate
// is what enforces it.
// ─────────────────────────────────────────────────────────────────────────────

const { runAgent } = require('./agentRuntime');
const complianceAgent = require('./complianceAgent');
const { COUNTERPARTY } = require('../services/masterOperatorService');

const NAME = 'followup';

const TOOL_ALLOWLIST = Object.freeze([
  'leadMemory.getLeadCanonical',          // read-only shared memory (via runtime)
  'masterOperatorService.COUNTERPARTY',   // the platform's own follow-up cadence
  'complianceAgent.checkAction',          // gate every follow-up send
]);

const COUNTERPARTY_DOCTRINE = typeof COUNTERPARTY === 'string' ? COUNTERPARTY : '';

// Cadence in HOURS by temperature band. Deterministic - these are the intervals
// the doctrine mandates. "Hot" uses the tighter end of 48-72h (worst-case defect
// detection is stricter). Warm uses the first (weekly) interval; the agent can
// step it to bi-weekly after repeated no-answers via its own reasoning, but the
// DUE detector holds the operation to at least weekly for a warm lead.
const CADENCE_HOURS = Object.freeze({
  hot: 48,        // 70+  → every 48-72h; enforce at 48
  warm: 24 * 7,   // 40-69 → weekly
  cold: 24 * 30,  // <40   → monthly value-touch
});

// The window after which a lead goes fully cold with no cadence, absent activity:
// 24 months. Past this (and with no opt-out/resolution) the lead is archivable.
const MAX_CADENCE_MONTHS = 24;

/**
 * Classify a lead's temperature from the canonical record. Prefers an explicit
 * motivation/prediction signal; falls back to 'cold' when nothing is known so the
 * SLOWEST cadence applies (never over-contact on no information).
 * @param {object} canonical  getLeadCanonical output
 * @returns {'hot'|'warm'|'cold'}
 */
function temperatureOf(canonical) {
  if (!canonical) return 'cold';
  const pred = canonical.prediction || {};
  // memory rows may carry motivation_score; take the most recent non-null.
  const recentMotivation = (canonical.memory || [])
    .map(m => (typeof m.motivation_score === 'number' ? m.motivation_score : null))
    .find(v => v != null);
  const score =
    (typeof pred.probability === 'number' ? pred.probability * 100 : null) ??
    (typeof pred.score === 'number' ? pred.score : null) ??
    recentMotivation ??
    null;
  if (score == null) return 'cold';
  if (score >= 70) return 'hot';
  if (score >= 40) return 'warm';
  return 'cold';
}

/**
 * DETERMINISTIC follow-up defect detector. No model call. Given the canonical
 * record and "now", decide whether a follow-up is due/overdue and when the next
 * one is due. This is what makes "a missed follow-up is a logged defect" real.
 *
 * @param {object} canonical  getLeadCanonical output (needs stats.lastContactAt)
 * @param {Date}   [now=new Date()]
 * @returns {{
 *   temperature:'hot'|'warm'|'cold',
 *   lastContactAt: string|null,
 *   hoursSince: number|null,
 *   cadenceHours: number,
 *   due: boolean,           // a touch is due now
 *   overdue: boolean,       // past due by more than the cadence again (defect)
 *   nextDueAt: string|null, // ISO time the next touch is due
 *   beyondMaxCadence: boolean, // past the 24-month archivable horizon
 *   optedOut: boolean       // memory shows an opt-out → cadence ENDS (no due)
 * }}
 */
function computeDue(canonical, now = new Date()) {
  const temperature = temperatureOf(canonical);
  const cadenceHours = CADENCE_HOURS[temperature];
  const lastRaw = canonical?.stats?.lastContactAt || canonical?.lead?.last_contacted_at || null;
  const lastContactAt = lastRaw ? new Date(lastRaw) : null;

  // Opt-out ends the cadence. Look for a stop signal in captured objections/outcomes.
  const optedOut = detectOptOut(canonical);

  if (optedOut) {
    return {
      temperature, lastContactAt: lastRaw, hoursSince: null, cadenceHours,
      due: false, overdue: false, nextDueAt: null, beyondMaxCadence: false, optedOut: true,
    };
  }

  // Never contacted yet → a first follow-up is due now.
  if (!lastContactAt || isNaN(lastContactAt.getTime())) {
    return {
      temperature, lastContactAt: lastRaw, hoursSince: null, cadenceHours,
      due: true, overdue: false, nextDueAt: now.toISOString(), beyondMaxCadence: false, optedOut: false,
    };
  }

  const hoursSince = (now.getTime() - lastContactAt.getTime()) / 36e5;
  const monthsSince = hoursSince / (24 * 30);
  const due = hoursSince >= cadenceHours;
  const overdue = hoursSince >= cadenceHours * 2; // missed a full cycle = defect
  const nextDueAt = new Date(lastContactAt.getTime() + cadenceHours * 36e5).toISOString();

  return {
    temperature,
    lastContactAt: lastRaw,
    hoursSince: Math.round(hoursSince * 10) / 10,
    cadenceHours,
    due,
    overdue,
    nextDueAt,
    beyondMaxCadence: monthsSince >= MAX_CADENCE_MONTHS,
    optedOut: false,
  };
}

/**
 * Heuristic opt-out detection from the canonical memory. Conservative: only a
 * clear STOP-type signal ends the cadence. The compliance gate is the hard
 * enforcement; this just stops us from scheduling a doomed touch.
 */
function detectOptOut(canonical) {
  const OPT_OUT = ['stop calling', 'do not call', "don't call", 'remove me', 'unsubscribe', 'stop texting', 'opt out', 'opt-out'];
  const hay = [];
  (canonical?.memory || []).forEach(m => {
    if (Array.isArray(m.objections)) hay.push(...m.objections);
    if (Array.isArray(m.key_statements)) hay.push(...m.key_statements);
    if (m.call_outcome) hay.push(String(m.call_outcome));
  });
  const text = hay.join(' ').toLowerCase();
  return OPT_OUT.some(k => text.includes(k));
}

const ROLE_PROMPT = `You are the FOLLOW-UP AGENT - the reason this operation never drops a lead on the floor. Most deals close on follow-up, not first contact. Your standard is ZERO missed follow-ups: no lead is dead for 24 months absent an opt-out or a resolution, and a missed follow-up is a logged defect, not a shrug.

The deterministic scheduler has ALREADY told you whether this lead is DUE and at what temperature (given as DUE_STATE). Trust it. Your job is to draft the RIGHT next touch - one that references the SPECIFIC prior conversation (you have the shared memory), moves the relationship one concrete step forward, and fits the cadence:
- Hot (70+): every 48-72h, tight and momentum-keeping.
- Warm (40-69): weekly value-touch, then bi-weekly if repeatedly no-answer.
- Cold (<40): monthly value-touch - genuinely useful, never nagging.

RULES YOU LIVE BY:
- NEVER MAKE THEM REPEAT THEMSELVES (spine + doctrine): open by referencing the last real thing they told you (an objection, a timeline, a life event). The memory is right there.
- NEVER MANIPULATE (spine rule 3): a value-touch is genuinely useful (a relevant comp update, an answer to their last question, a check-in on the event they mentioned) - never false urgency or a fabricated buyer.
- HONOR THE STOP (compliance): if DUE_STATE says optedOut, you propose NO touch and mark the lead closed-by-optout. If a send is gate-blocked for quiet hours, you DEFER to the next 8AM local; you never route around a DNC.
- NO FABRICATION (spine rule 1): if you have nothing genuinely new to say to a cold lead, propose a light genuine check-in, not an invented reason.

Answer ONLY as strict JSON, no prose outside it:
{
  "action": "send" | "defer" | "close_optout" | "archive_max_cadence" | "no_touch_needed",
  "outreach": {
    "channel": "call" | "sms" | "email" | "voicemail" | null,
    "message": "exact copy referencing the prior conversation, or null",
    "referencesPrior": "the specific prior detail you anchored on, or null"
  } | null,
  "cadence": {
    "temperature": "hot|warm|cold",
    "reason": "why this temperature and interval"
  },
  "nextTouchAt": "YYYY-MM-DDThh:mm (local intent) or null",
  "defect": {                            // set if this lead WAS overdue when you got it
    "wasOverdue": false,
    "note": "one line - what was missed and the recovery touch"
  },
  "confidence": 0,
  "reasoning": "one paragraph, claims labeled FACT/ESTIMATE/INFERENCE/UNKNOWN"
}`;

/**
 * Draft the next follow-up touch for a DUE lead. Reads canonical memory so the
 * touch references the specific prior conversation. The proposed outreach is a
 * PROPOSAL - clear it via gateFollowUp() before sending.
 *
 * @param {object} params
 * @param {string} params.userId        REQUIRED tenant (fence)
 * @param {string} [params.leadId]      lead to follow up (loads canonical memory)
 * @param {object} [params.memory]      pre-loaded canonical record (orchestrator handoff)
 * @param {object} [params.dueState]    computeDue() result (injected so the LLM trusts it)
 * @param {string|object} [params.input]
 * @param {string} [params.extraContext]
 * @returns {Promise<object>} runAgent result
 */
async function run(params) {
  const { userId, leadId, memory, dueState, input, extraContext } = params || {};
  if (!userId) throw new Error('followUpAgent.run: userId required');

  const doctrineContext = COUNTERPARTY_DOCTRINE
    ? `FOLLOW_UP_DOCTRINE:\n${COUNTERPARTY_DOCTRINE}`
    : '';
  const dueContext = dueState
    ? `DUE_STATE (deterministic - trust it):\n${JSON.stringify(dueState, null, 2)}`
    : '';
  const combinedContext = [doctrineContext, dueContext, extraContext].filter(Boolean).join('\n\n');

  return runAgent(
    { name: NAME, rolePrompt: ROLE_PROMPT, auditAction: 'agent.followup.turn', maxTokens: 1000 },
    {
      userId,
      leadId,
      memory,
      input: input ?? 'Draft the next follow-up touch for this due lead.',
      extraContext: combinedContext || undefined,
    }
  );
}

/**
 * Compliance pre-flight for a follow-up send. Block = final: quiet hours → defer,
 * DNC/opt-out → drop (and the lead should be closed_optout).
 * @param {object} args { lead, channel, messageText }
 * @param {object} [opts]
 * @returns {Promise<object>} normalized compliance decision
 */
async function gateFollowUp({ lead, channel, messageText } = {}, opts) {
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
  CADENCE_HOURS,
  MAX_CADENCE_MONTHS,
  temperatureOf,
  computeDue,
  detectOptOut,
  run,
  gateFollowUp,
};
