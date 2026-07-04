/**
 * SECTION E - COPILOT / AUTOPILOT operator mode.
 *
 * Veori is the operator's AI COO. This service decides, for each AI-recommended
 * action, whether it may run AUTOMATICALLY or must wait for the operator to approve.
 * It does NOT execute anything - it's a pure policy/classifier the COO route uses to
 * annotate the action queue. Execution stays in the existing engines.
 *
 * THREE MODES (operator-set on the users row, defaults to the safest):
 *   • 'manual'   - AI only suggests; the operator does everything. (Most cautious.)
 *   • 'copilot'  - DEFAULT. AI drafts/queues every action but each one needs a click
 *                  to fire. The operator is always in the loop.
 *   • 'autopilot'- AI auto-fires LOW-risk, reversible actions within guardrails;
 *                  anything medium/high-risk still routes to the operator for
 *                  approval. Autopilot NEVER skips the hard guardrails below.
 *
 * HARD GUARDRAILS (apply in EVERY mode, autopilot included - these can never auto):
 *   - Anything that sends a legal document or contract.
 *   - Anything that moves money or commits funds.
 *   - Anything touching DNC / consent / compliance.
 *   - Anything irreversible (deleting, closing a deal, marking dead).
 * These always require an explicit human approval. Autopilot is a convenience for the
 * routine, reversible nudges - never for the consequential, irreversible commitments.
 *
 * HONESTY: this returns a decision + reason for each action so the UI can show WHY an
 * action is auto vs needs-approval. Nothing here fabricates; it only classifies.
 */

const MODES = ['manual', 'copilot', 'autopilot'];
const DEFAULT_MODE = 'copilot';

// Action risk tiers. The COO action queue uses short verbs like "call", "text",
// "follow_up", "send_contract". We classify by intent keywords, defaulting to the
// safer 'high' tier for anything we don't recognize (fail-closed).
const LOW_RISK    = ['follow_up', 'followup', 'remind', 'nudge', 'review', 'research', 'note', 'tag', 'score', 'prioritize', 'queue'];
const MEDIUM_RISK = ['call', 'text', 'sms', 'email', 'message', 'reach_out', 'outreach', 'voicemail'];
// Anything matching these is ALWAYS approval-gated, even in autopilot.
const GUARDRAILED = ['contract', 'sign', 'send_contract', 'offer_letter', 'wire', 'pay', 'fund', 'deposit', 'transfer', 'dnc', 'opt_out', 'delete', 'close', 'mark_dead', 'dispo', 'assign'];

/** Normalize an operator's stored mode to a known value (safe default). */
function normalizeMode(raw) {
  const m = String(raw || '').trim().toLowerCase();
  return MODES.includes(m) ? m : DEFAULT_MODE;
}

/** Lowercased haystack from an action's verb + reason for keyword matching. */
function actionText(action) {
  if (!action) return '';
  if (typeof action === 'string') return action.toLowerCase();
  return `${action.action || ''} ${action.reason || ''} ${action.type || ''}`.toLowerCase();
}

function matchesAny(text, words) {
  return words.some(w => text.includes(w));
}

/**
 * Classify a single action's risk tier: 'guardrailed' | 'medium' | 'low'.
 * Guardrailed wins first (most conservative); unknown verbs fall through to medium
 * (we only auto-fire things we explicitly recognize as low-risk).
 */
function classifyRisk(action) {
  const text = actionText(action);
  if (!text.trim()) return 'medium';
  if (matchesAny(text, GUARDRAILED)) return 'guardrailed';
  if (matchesAny(text, LOW_RISK))    return 'low';
  if (matchesAny(text, MEDIUM_RISK)) return 'medium';
  return 'medium';
}

/**
 * Decide how an action should be handled given the operator's mode.
 * @returns {{ disposition:'auto'|'approve'|'suggest', risk:string, reason:string }}
 *   - 'auto'    → may fire without a click (autopilot + low-risk only)
 *   - 'approve' → queued, needs one operator click to fire (copilot, or gated)
 *   - 'suggest' → shown as advice only; operator acts manually (manual mode)
 */
function decide(action, mode) {
  const m = normalizeMode(mode);
  const risk = classifyRisk(action);

  if (m === 'manual') {
    return { disposition: 'suggest', risk, reason: 'Manual mode - AI suggests, you act.' };
  }

  if (risk === 'guardrailed') {
    return { disposition: 'approve', risk, reason: 'High-stakes/irreversible - always needs your approval, even on autopilot.' };
  }

  if (m === 'autopilot') {
    if (risk === 'low') {
      return { disposition: 'auto', risk, reason: 'Autopilot - low-risk, reversible action runs automatically.' };
    }
    return { disposition: 'approve', risk, reason: 'Autopilot - medium-risk action queued for a quick approval.' };
  }

  // copilot (default)
  return { disposition: 'approve', risk, reason: 'Copilot - queued for your one-click approval.' };
}

/**
 * Annotate a COO action queue with per-action dispositions for the given mode.
 * Pure + additive: returns a NEW array; each item gains { mode, disposition, risk,
 * decision_reason } without losing any existing field. Also returns a summary the
 * dashboard can show ("3 will auto-run, 4 need approval").
 */
function annotateActions(actions, mode) {
  const m = normalizeMode(mode);
  const list = Array.isArray(actions) ? actions : [];
  const annotated = list.map(a => {
    const d = decide(a, m);
    return { ...a, mode: m, disposition: d.disposition, risk: d.risk, decision_reason: d.reason };
  });

  const auto    = annotated.filter(a => a.disposition === 'auto').length;
  const approve = annotated.filter(a => a.disposition === 'approve').length;
  const suggest = annotated.filter(a => a.disposition === 'suggest').length;

  let summary;
  if (m === 'manual')      summary = `Manual mode - ${annotated.length} suggestions for you to act on.`;
  else if (m === 'autopilot') summary = `Autopilot - ${auto} will run automatically, ${approve} need your approval.`;
  else                     summary = `Copilot - ${approve} actions queued for your approval.`;

  return { mode: m, actions: annotated, auto_count: auto, approve_count: approve, suggest_count: suggest, summary };
}

module.exports = {
  MODES,
  DEFAULT_MODE,
  normalizeMode,
  classifyRisk,
  decide,
  annotateActions,
};
