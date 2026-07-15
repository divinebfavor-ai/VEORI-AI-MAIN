/**
 * Decision learning - closes the loop on the SMS judgment engine.
 *
 * smsEscalationJudge logs every decision (continue_sms | escalate_call | close_out) with
 * its reasoning and the background PMI score, but nothing ever checked whether those
 * decisions were RIGHT. This service verifies each matured decision against what actually
 * happened afterward - calls placed and connected, deals created, replies received or
 * silence - and stamps a deterministic outcome + correctness onto the decision row.
 *
 * Verified-outcomes-only doctrine: correctness comes from hard rows in calls / deals /
 * sms_messages, never from a model's opinion of itself. The accuracy report this produces
 * is the measurable "is the judge getting better?" signal, and its per-action PMI
 * calibration feeds future threshold tuning.
 *
 * Correctness rules (deterministic):
 *   escalate_call  correct when a call to that lead CONNECTED after the decision
 *                  (status completed/answered or a win outcome) OR a deal was created
 *                  within the window. Decisions held for human review are recorded but
 *                  correctness stays null (a human, not the judge, owned the outcome).
 *   continue_sms   correct when the conversation stayed alive - another inbound reply
 *                  within the window (or a later escalation/deal).
 *   close_out      correct when the lead STAYED closed - no inbound within the (longer)
 *                  window; incorrect when the lead revived after we closed them.
 *
 * Manual trigger (admin endpoint), no cron - consistent with platform conventions.
 */

const supabase = require('../config/supabase');

const VERIFY_AFTER_DAYS = { escalate_call: 7, continue_sms: 7, close_out: 14 };
const CALL_WIN_OUTCOMES = ['appointment', 'offer_made', 'verbal_yes', 'callback_requested', 'interested'];
const CALL_CONNECTED_STATUSES = ['completed', 'answered', 'in-progress'];

const daysMs = (d) => d * 24 * 60 * 60 * 1000;

async function rowsAfter(table, filters, sinceIso) {
  let q = supabase.from(table).select(filters.select).gte('created_at', sinceIso).limit(50);
  for (const [col, val] of Object.entries(filters.eq || {})) q = q.eq(col, val);
  const { data, error } = await q;
  if (error) return [];
  return data || [];
}

/**
 * Determine the verified outcome for ONE matured decision. Pure given the fetched
 * evidence; exported for tests.
 */
function judgeOutcome(decision, { calls = [], deals = [], inbound = [] }) {
  const action = decision.action;

  if (action === 'escalate_call') {
    const connected = calls.some(c =>
      CALL_CONNECTED_STATUSES.includes(String(c.status || '').toLowerCase()) ||
      CALL_WIN_OUTCOMES.includes(String(c.outcome || '').toLowerCase()));
    const dealMade = deals.length > 0;
    if (decision.needs_human_review) {
      // Held for a human - record what happened, but the judge doesn't own it.
      return { outcome: dealMade ? 'held_then_deal' : connected ? 'held_then_call' : 'held_no_action', correct: null };
    }
    if (dealMade)  return { outcome: 'call_then_deal', correct: true };
    if (connected) return { outcome: 'call_connected', correct: true };
    if (calls.length) return { outcome: 'call_placed_no_connect', correct: false };
    return { outcome: 'no_call_happened', correct: false };
  }

  if (action === 'continue_sms') {
    if (deals.length)   return { outcome: 'conversation_to_deal', correct: true };
    if (inbound.length) return { outcome: 'conversation_alive', correct: true };
    if (calls.length)   return { outcome: 'later_escalated', correct: true };
    return { outcome: 'went_silent', correct: false };
  }

  if (action === 'close_out') {
    if (deals.length)   return { outcome: 'closed_but_deal_happened', correct: false };
    if (inbound.length) return { outcome: 'lead_revived_after_close', correct: false };
    return { outcome: 'stayed_closed', correct: true };
  }

  return { outcome: 'unknown_action', correct: null };
}

/**
 * Verify all matured, unverified decisions (optionally for one operator).
 * Deterministic, idempotent (verified rows are skipped by the query).
 */
async function verifyDecisionOutcomes({ userId = null, limit = 500, now = new Date() } = {}) {
  let q = supabase.from('sms_decisions')
    .select('id, user_id, lead_id, action, needs_human_review, created_at')
    .is('verified_at', null)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (userId) q = q.eq('user_id', userId);
  const { data: decisions, error } = await q;
  if (error) throw error;

  let verified = 0, correct = 0, incorrect = 0, held = 0;
  for (const d of decisions || []) {
    const matureAfter = daysMs(VERIFY_AFTER_DAYS[d.action] || 7);
    const decidedAt = new Date(d.created_at).getTime();
    if (now.getTime() - decidedAt < matureAfter) continue; // not matured yet

    const sinceIso = new Date(decidedAt).toISOString();
    const [calls, deals, inbound] = await Promise.all([
      rowsAfter('calls',        { select: 'id, status, outcome', eq: { lead_id: d.lead_id } }, sinceIso),
      rowsAfter('deals',        { select: 'id',                  eq: { lead_id: d.lead_id } }, sinceIso),
      rowsAfter('sms_messages', { select: 'id',                  eq: { lead_id: d.lead_id, direction: 'inbound' } }, sinceIso),
    ]);

    const { outcome, correct: ok } = judgeOutcome(d, { calls, deals, inbound });
    const { error: upErr } = await supabase.from('sms_decisions')
      .update({ outcome, outcome_correct: ok, verified_at: now.toISOString() })
      .eq('id', d.id);
    if (upErr) continue;
    verified++;
    if (ok === true) correct++; else if (ok === false) incorrect++; else held++;
  }
  return { scanned: (decisions || []).length, verified, correct, incorrect, held };
}

/**
 * Accuracy + PMI-calibration report over verified decisions. The self-evaluation
 * surface: per-action accuracy and whether the background PMI score separates good
 * decisions from bad ones (avg PMI on correct vs incorrect).
 */
async function decisionAccuracyReport({ userId = null } = {}) {
  let q = supabase.from('sms_decisions')
    .select('action, outcome, outcome_correct, pmi_score')
    .not('verified_at', 'is', null)
    .limit(5000);
  if (userId) q = q.eq('user_id', userId);
  const { data, error } = await q;
  if (error) throw error;

  const byAction = {};
  for (const d of data || []) {
    const a = byAction[d.action] || (byAction[d.action] = {
      total: 0, correct: 0, incorrect: 0, held: 0,
      pmiCorrectSum: 0, pmiCorrectN: 0, pmiIncorrectSum: 0, pmiIncorrectN: 0, outcomes: {},
    });
    a.total++;
    a.outcomes[d.outcome] = (a.outcomes[d.outcome] || 0) + 1;
    if (d.outcome_correct === true) {
      a.correct++;
      if (d.pmi_score != null) { a.pmiCorrectSum += d.pmi_score; a.pmiCorrectN++; }
    } else if (d.outcome_correct === false) {
      a.incorrect++;
      if (d.pmi_score != null) { a.pmiIncorrectSum += d.pmi_score; a.pmiIncorrectN++; }
    } else a.held++;
  }

  const report = {};
  for (const [action, a] of Object.entries(byAction)) {
    const judged = a.correct + a.incorrect;
    report[action] = {
      total: a.total,
      accuracy: judged ? Math.round((a.correct / judged) * 100) : null,
      correct: a.correct, incorrect: a.incorrect, held_for_human: a.held,
      avg_pmi_when_correct:   a.pmiCorrectN   ? Math.round(a.pmiCorrectSum / a.pmiCorrectN)     : null,
      avg_pmi_when_incorrect: a.pmiIncorrectN ? Math.round(a.pmiIncorrectSum / a.pmiIncorrectN) : null,
      outcomes: a.outcomes,
    };
  }
  return report;
}

// ── Calibration feedback: verified accuracy -> the judge's next decision ──────
// A compact, evidence-only block injected into the judge prompt so it learns from its
// own VERIFIED track record ("your escalations below PMI 40 connected 20% of the
// time"). Data-gated: silent ('') until enough decisions are verified, so early noise
// never steers live behavior. Cached per operator (the judge runs per inbound message).

const MIN_VERIFIED_FOR_CALIBRATION = Number(process.env.DECISION_CALIBRATION_MIN_VERIFIED || 10);
const CALIBRATION_TTL_MS = 10 * 60 * 1000;
const calibrationCache = new Map(); // userId -> { block, at }

function pct(n, d) { return d ? Math.round((n / d) * 100) : null; }

// Pure: builds the block from verified decision rows. Exported for tests.
function buildCalibrationBlock(rows = []) {
  const judged = rows.filter(r => r.outcome_correct === true || r.outcome_correct === false);
  if (judged.length < MIN_VERIFIED_FOR_CALIBRATION) return '';

  const lines = [];
  const esc = judged.filter(r => r.action === 'escalate_call');
  if (esc.length >= 5) {
    const lo = esc.filter(r => (r.pmi_score ?? 50) < 40);
    const hi = esc.filter(r => (r.pmi_score ?? 50) >= 40);
    const loOk = pct(lo.filter(r => r.outcome_correct).length, lo.length);
    const hiOk = pct(hi.filter(r => r.outcome_correct).length, hi.length);
    if (lo.length >= 3 && loOk != null) lines.push(`- Your escalations with motivation score BELOW 40 worked out ${loOk}% of the time (${lo.length} verified). ${loOk < 40 ? 'Lean toward continuing the text conversation at low scores unless the signals are unmistakable.' : ''}`);
    if (hi.length >= 3 && hiOk != null) lines.push(`- Your escalations with motivation score 40+ worked out ${hiOk}% of the time (${hi.length} verified).`);
  }
  const clo = judged.filter(r => r.action === 'close_out');
  if (clo.length >= 5) {
    const revived = clo.filter(r => r.outcome === 'lead_revived_after_close' || r.outcome === 'closed_but_deal_happened').length;
    const rate = pct(revived, clo.length);
    if (rate != null && rate >= 20) lines.push(`- ${rate}% of the leads you closed out later revived (${clo.length} verified). Close out less aggressively when any live signal remains.`);
  }
  const cont = judged.filter(r => r.action === 'continue_sms');
  if (cont.length >= 5) {
    const silent = pct(cont.filter(r => r.outcome === 'went_silent').length, cont.length);
    if (silent != null && silent >= 60) lines.push(`- ${silent}% of your continue-texting decisions went silent (${cont.length} verified). When momentum is real, escalating sooner has outperformed waiting.`);
  }
  if (!lines.length) return '';
  return `\nYOUR VERIFIED TRACK RECORD (from real outcomes of your past decisions - weigh it, it is evidence, not a rule):\n${lines.join('\n')}`;
}

// Cached fetch + build. Best-effort: any failure returns ''.
async function getCalibrationBlock(userId) {
  if (!userId) return '';
  const hit = calibrationCache.get(userId);
  if (hit && Date.now() - hit.at < CALIBRATION_TTL_MS) return hit.block;
  try {
    const { data } = await supabase.from('sms_decisions')
      .select('action, outcome, outcome_correct, pmi_score')
      .eq('user_id', userId)
      .not('verified_at', 'is', null)
      .order('created_at', { ascending: false })
      .limit(500);
    const block = buildCalibrationBlock(data || []);
    calibrationCache.set(userId, { block, at: Date.now() });
    return block;
  } catch (_) { return ''; }
}

module.exports = {
  VERIFY_AFTER_DAYS, MIN_VERIFIED_FOR_CALIBRATION,
  judgeOutcome, verifyDecisionOutcomes, decisionAccuracyReport,
  buildCalibrationBlock, getCalibrationBlock,
};
