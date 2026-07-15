/**
 * SMS -> voice escalation judge (judgment-based)
 *
 * Replaces the old fixed rule (score >= threshold -> call). After every inbound message the
 * AI evaluates the WHOLE conversation and picks the single best next action:
 *   continue_sms | escalate_call | close_out
 * reasoning contextually about tone, urgency, timeline, price expectations, property
 * condition, stated intent, and whether the deal is trending forward or stalling - not a
 * fixed message count or single score.
 *
 * The PMI motivation score keeps running in the BACKGROUND as a sanity check only: if the
 * AI wants to escalate to a call while the background score shows no motivation signal at
 * all, we flag the lead for human review BEFORE the call is placed (we flag, we do not
 * auto-block - this catches clear mismatches without overriding good judgment).
 *
 * Every decision (action + reasoning + background score + signals) is logged to
 * sms_decisions for review and tuning.
 */

const supabase = require('../config/supabase');
const { callAnthropic } = require('./aiService');

const JUDGE_MODEL = 'claude-haiku-4-5-20251001';
const ACTIONS = ['continue_sms', 'escalate_call', 'close_out'];
const MIN_SIGNAL_SCORE = 25; // below this, and with no tracked signals, motivation is "negligible"

// Sanity check (NOT the deciding rule): is there any meaningful motivation signal?
function hasMotivationSignal(pmi) {
  if (!pmi) return false;
  const score = Number(pmi.score) || 0;
  const signals = Array.isArray(pmi.signals) ? pmi.signals.filter(Boolean) : [];
  return score >= MIN_SIGNAL_SCORE || signals.length > 0;
}

// LLM judgment over the full conversation. `llm` injectable for tests.
async function judge({ history, latestBody, pmi, userId = null }, { llm = callAnthropic } = {}) {
  const convo = (history || []).map(m => `${m.role === 'inbound' ? 'SELLER' : 'AI'}: ${m.body}`).join('\n');

  // Calibration feedback: this operator's VERIFIED decision track record (empty until
  // enough outcomes are verified - see decisionLearningService). Best-effort.
  let calibration = '';
  try { calibration = await require('./decisionLearningService').getCalibrationBlock(userId); } catch (_) {}

  const prompt = `You are an expert real estate acquisitions manager deciding the single best next step in a live SMS conversation with a property owner.

Conversation so far:
${convo}
SELLER (latest): "${latestBody}"

Decide ONE next action. Reason contextually about tone, urgency, and concrete signals
(timeline to sell, price expectations, property condition, stated intent to sell), and
whether the conversation is moving toward a deal or stalling. Do NOT rely on a fixed number
of messages or a single score.

- "escalate_call": a live phone call would move the deal forward FASTER than more texting
  (real motivation and momentum are present).
- "continue_sms": texting is still productively building toward that point.
- "close_out": the owner is clearly unlikely to convert; end gracefully instead of texting
  indefinitely.

Background motivation score (context only, NOT the deciding rule): ${pmi && pmi.score != null ? pmi.score : 'n/a'}.
${calibration}
Reply with ONLY JSON: {"action":"continue_sms|escalate_call|close_out","reasoning":"<1-2 sentences citing the specific signals>"}`;

  const msg = await llm({ model: JUDGE_MODEL, max_tokens: 300, messages: [{ role: 'user', content: prompt }] }, { label: 'sms-escalation-judge' });
  const text = (msg && msg.content && msg.content[0] && msg.content[0].text || '').trim();
  let parsed;
  try { parsed = JSON.parse(text.replace(/^```json\s*/i, '').replace(/```$/, '').trim()); }
  catch { parsed = { action: 'continue_sms', reasoning: 'Could not parse judgment; defaulting to continue.' }; }
  if (!ACTIONS.includes(parsed.action)) parsed.action = 'continue_sms';
  return { action: parsed.action, reasoning: String(parsed.reasoning || '') };
}

// Background PMI + judgment + human-review flag. `scorer`/`llm` injectable for tests.
async function evaluate({ history, latestBody, sellerContext, dealBlock = '', userId = null }, { llm, scorer } = {}) {
  const raw = await scorer(history || [], latestBody, sellerContext, dealBlock);
  const pmi = typeof raw === 'number' ? { score: raw } : (raw || { score: 50 });
  const signals = Array.isArray(pmi.signals) ? pmi.signals : (pmi.reason ? [pmi.reason] : []);
  const decision = await judge({ history, latestBody, pmi, userId }, { llm });
  const needs_human_review = decision.action === 'escalate_call' && !hasMotivationSignal({ score: pmi.score, signals });
  return {
    pmi_score: Number(pmi.score) || 0,
    pmi_signals: signals,
    action: decision.action,
    reasoning: decision.reasoning,
    needs_human_review,
  };
}

async function logDecision(row) {
  try { await supabase.from('sms_decisions').insert(row); }
  catch (e) { console.warn('[SMSJudge] decision log failed (non-fatal):', e.message); }
}

/**
 * Full inbound handler used by BOTH the queue worker and the inline fallback. Evaluates,
 * logs, persists the background score, and carries out the chosen action. `deps` lets tests
 * inject the LLM / scorer and disable real sends (execute:false).
 */
async function decideAndExecute({ lead, userId, from, body, history, sellerContext, dealBlock = '', inboundMsgId }, deps = {}) {
  const sms = deps.sms || require('./smsService');
  const scorer = deps.scorer || sms.scoreReply;
  const execute = deps.execute !== false;

  const d = await evaluate({ history, latestBody: body, sellerContext, dealBlock, userId }, { llm: deps.llm, scorer });

  // Background PMI stays on the lead (unchanged from before).
  await supabase.from('leads').update({ motivation_score: d.pmi_score }).eq('id', lead.id).then(() => {}, () => {});

  await logDecision({
    user_id: userId, lead_id: lead.id, inbound_message_id: inboundMsgId || null,
    pmi_score: d.pmi_score, pmi_signals: d.pmi_signals, action: d.action,
    reasoning: d.reasoning, needs_human_review: d.needs_human_review, message_count: (history || []).length,
  });

  if (d.action === 'escalate_call') {
    if (d.needs_human_review) {
      await supabase.from('leads').update({
        needs_human_review: true,
        human_review_reason: `AI recommended a call, but the background motivation score is negligible (${d.pmi_score}). A human should sanity-check before this call is placed.`,
      }).eq('id', lead.id).then(() => {}, () => {});
      console.log(`[SMSJudge] lead ${lead.id}: escalate FLAGGED for human review (score ${d.pmi_score})`);
    } else if (execute) {
      await sms.sendReply(from, 'Thanks for getting back to me. Let me give you a quick call to run through this.', userId, lead.id);
      await sms.escalateToCall(lead, userId); // standard call flow -> opens with the mandatory AI disclosure
    }
  } else if (d.action === 'continue_sms') {
    if (execute) {
      const reply = await sms.continueConversation(lead, body, history, sellerContext, dealBlock);
      if (reply) await sms.sendReply(from, reply, userId, lead.id);
    }
  } else { // close_out
    await supabase.from('leads').update({ status: 'closed_lost', relationship_stage: 'closed' }).eq('id', lead.id).then(() => {}, () => {});
    if (execute) {
      await sms.sendReply(from, 'Totally understand, I appreciate you letting me know. If anything changes down the road, feel free to reach out anytime.', userId, lead.id).catch(() => {});
    }
    console.log(`[SMSJudge] lead ${lead.id}: gracefully closed out`);
  }

  return d;
}

module.exports = { JUDGE_MODEL, ACTIONS, MIN_SIGNAL_SCORE, hasMotivationSignal, judge, evaluate, logDecision, decideAndExecute };
