/**
 * Learning Loop Service — closes the loop that makes the platform get better
 * with every call it makes.
 *
 * Before this file, learning was WRITE-ONLY: aiLearningService recorded
 * conversation insights and deal outcomes into Supabase, and nothing ever read
 * them back. The AI made the same mistakes forever. This service completes the
 * cycle:
 *
 *   1. CAPTURE   — learnFromCall() runs after every scored call: stores the
 *                  conversation insight (objections raised, language that
 *                  worked, sentiment arc) tied to the VERIFIED outcome.
 *   2. DISTILL   — distillLessons() (nightly + on-demand) has Claude study the
 *                  operator's recent verified outcomes and produce a small set
 *                  of concrete, evidence-backed lessons ("when the seller says
 *                  X, do Y — won 6 of 8 calls"). Upserted into ai_lessons.
 *   3. APPLY     — the live voice brain injects getLessonBlockSync() into its
 *                  system prompt, so the next call actually behaves differently.
 *   4. VERIFY    — logPrediction()/verifyPrediction() keep an honest ledger in
 *                  ai_predictions so distillation learns ONLY from confirmed
 *                  outcomes, never from assumptions (doctrine: Part 7/8).
 *
 * Doctrine (masterOperatorService) is the constitution; lessons are case law.
 * Lessons NEVER override doctrine — the distillation prompt forbids lessons
 * that fabricate, manipulate, or touch protected-class targeting, and the
 * injection block states doctrine wins on conflict.
 *
 * The prompt builder (vapiService.buildAlexPrompt) is synchronous, so lessons
 * are served from an in-memory per-operator cache primed asynchronously at
 * call-context load (v2voice.loadCallContext) and refreshed on a TTL.
 */

const Anthropic = require('@anthropic-ai/sdk');
const supabase = require('../config/supabase');
const { recordConversationInsight } = require('./aiLearningService');

let anthropicClient = null;
function getAnthropic() {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      timeout: 60000,
      maxRetries: 1,
    });
  }
  return anthropicClient;
}

// Cheap by default — distillation runs nightly on transcripts, not live traffic.
const LEARNING_MODEL = process.env.LEARNING_MODEL || 'claude-haiku-4-5-20251001';

// Max lessons injected into a live-call prompt (token budget on a phone turn).
const MAX_ACTIVE_LESSONS = parseInt(process.env.LEARNING_MAX_LESSONS, 10) || 6;

// Minimum verified calls before distillation produces anything — below this the
// "lessons" would be noise dressed as insight.
const MIN_CALLS_TO_DISTILL = parseInt(process.env.LEARNING_MIN_CALLS, 10) || 8;

// ── APPLY: per-operator lesson cache ─────────────────────────────────────────
const LESSON_CACHE_TTL_MS = 10 * 60 * 1000; // 10 min
const lessonCache = new Map(); // userId -> { block: string, fetchedAt: number }

/**
 * Synchronous read for the prompt builder. Returns '' when nothing is cached —
 * the prompt is simply doctrine-only for that call (never blocks a live turn).
 */
function getLessonBlockSync(userId) {
  if (!userId) return '';
  const hit = lessonCache.get(userId);
  return hit ? hit.block : '';
}

/**
 * Async warm/refresh of the cache. Called from loadCallContext (fire-and-forget)
 * so by the seller's first reply the lessons are in memory for the turn prompt.
 */
async function primeLessonCache(userId) {
  if (!userId) return;
  const hit = lessonCache.get(userId);
  if (hit && Date.now() - hit.fetchedAt < LESSON_CACHE_TTL_MS) return;
  try {
    const { data: rows } = await supabase
      .from('ai_lessons')
      .select('lesson, evidence, evidence_count')
      .eq('active', true)
      .or(`user_id.eq.${userId},user_id.is.null`)
      .order('evidence_count', { ascending: false })
      .limit(MAX_ACTIVE_LESSONS);

    let block = '';
    if (rows && rows.length > 0) {
      const lines = rows.map((r) => `- ${r.lesson}${r.evidence ? ` (${r.evidence})` : ''}`).join('\n');
      block = `
══════════════════════════════════════════════════════
WHAT YOUR OWN CALL HISTORY HAS PROVEN (learned from verified outcomes — apply it)
══════════════════════════════════════════════════════
These are patterns distilled from this operator's real, verified call results —
not theory. Apply them naturally. If any lesson ever conflicts with the
OPERATING DOCTRINE or NON-NEGOTIABLE RULES, doctrine wins.
${lines}`;
    }
    lessonCache.set(userId, { block, fetchedAt: Date.now() });
  } catch (err) {
    console.warn('[LearningLoop] primeLessonCache failed:', err.message);
    // Cache the miss briefly so a DB blip can't hammer every call.
    lessonCache.set(userId, { block: '', fetchedAt: Date.now() - LESSON_CACHE_TTL_MS + 60000 });
  }
}

// ── CAPTURE: post-call learning hook ─────────────────────────────────────────
/**
 * Runs after a call is scored (v2voice.scoreTwilioCall). Best-effort, never
 * throws — a learning miss must never affect the call pipeline.
 * @param {object} callRec     the calls row (with leads(*) joined)
 * @param {object} aiAnalysis  analyzeCallTranscript result
 */
async function learnFromCall(callRec, aiAnalysis = {}) {
  try {
    if (!callRec) return;
    const outcome = aiAnalysis.outcome || callRec.outcome || 'unknown';
    await recordConversationInsight({
      dealId: null,
      contactId: callRec.lead_id || null,
      contactType: 'seller',
      phase: 'qualification',
      conversationText: (callRec.transcript || '').slice(0, 12000),
      outcome,
    });
  } catch (err) {
    console.warn('[LearningLoop] learnFromCall failed:', err.message);
  }
}

// ── VERIFY: honest prediction ledger ─────────────────────────────────────────
async function logPrediction({ userId, subjectType, subjectId, prediction, probability, confidence, reasoning }) {
  try {
    await supabase.from('ai_predictions').insert({
      user_id: userId || null,
      subject_type: subjectType,
      subject_id: subjectId,
      prediction,
      probability,
      confidence: confidence || null,
      reasoning: reasoning || null,
    }).then(null, () => {});
  } catch (_) { /* best-effort */ }
}

async function verifyPrediction({ subjectType, subjectId, prediction, outcome }) {
  try {
    await supabase.from('ai_predictions')
      .update({ outcome: !!outcome, verified_at: new Date().toISOString() })
      .eq('subject_type', subjectType)
      .eq('subject_id', subjectId)
      .eq('prediction', prediction)
      .is('outcome', null)
      .then(null, () => {});
  } catch (_) { /* best-effort */ }
}

// ── DISTILL: verified outcomes → evidence-backed lessons ─────────────────────
/**
 * Study the operator's recent VERIFIED call outcomes and produce a small set of
 * concrete lessons. Replaces that operator's active outcome-distilled lessons
 * atomically (deactivate old → insert new) so the set never grows stale or
 * unbounded. Runs nightly per active operator; safe to call on demand.
 */
async function distillLessons(userId) {
  if (!userId || !process.env.ANTHROPIC_API_KEY) return { distilled: 0 };
  try {
    // Verified material only: completed calls WITH a transcript AND an outcome.
    const { data: calls } = await supabase
      .from('calls')
      .select('outcome, motivation_score, objections, ai_summary, duration_seconds')
      .eq('user_id', userId)
      .not('outcome', 'is', null)
      .not('transcript', 'is', null)
      .order('ended_at', { ascending: false })
      .limit(60);

    if (!calls || calls.length < MIN_CALLS_TO_DISTILL) {
      return { distilled: 0, reason: `only ${calls?.length || 0} verified calls (need ${MIN_CALLS_TO_DISTILL})` };
    }

    const wins = ['appointment', 'offer_made', 'verbal_yes', 'callback_requested', 'interested'];
    const summaryLines = calls.map((c) => {
      const tag = wins.includes(c.outcome) ? 'WIN' : 'LOSS';
      const obj = Array.isArray(c.objections) ? c.objections.join('; ') : (c.objections || 'none noted');
      return `[${tag}] outcome=${c.outcome} score=${c.motivation_score ?? 'n/a'} dur=${c.duration_seconds ?? '?'}s objections=${obj} summary=${(c.ai_summary || '').slice(0, 220)}`;
    }).join('\n');

    const anthropic = getAnthropic();
    const msg = await anthropic.messages.create({
      model: LEARNING_MODEL,
      max_tokens: 1200,
      temperature: 0.2,
      system: `You distill VERIFIED cold-call outcomes into lessons a live phone AI will apply on its next call. Output STRICT JSON only: an array of at most ${MAX_ACTIVE_LESSONS} objects, each {"lesson": string, "evidence": string, "evidence_count": number, "scope": "calling"}.
Rules:
- A lesson is a concrete in-call behavior ("When the seller mentions needed repairs, acknowledge the burden before any number — repair-first empathy preceded most appointments"), never a platitude ("be nice").
- evidence is one plain sentence quantifying the basis ("seen in 6 of 8 calls that reached an appointment").
- Only patterns supported by MULTIPLE calls. If the data supports fewer strong lessons, return fewer. If it supports none, return [].
- NEVER produce a lesson that fabricates information, pressures or manipulates, fakes urgency or competition, or targets/treats people differently by any protected class or proxy for one. Compliance and honesty lessons are welcome.`,
      messages: [{ role: 'user', content: `Verified call outcomes (newest first):\n${summaryLines}` }],
    });

    const raw = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    const jsonText = raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1);
    let lessons;
    try {
      lessons = JSON.parse(jsonText);
    } catch (_) {
      console.warn('[LearningLoop] distill returned non-JSON — skipping this cycle');
      return { distilled: 0 };
    }
    if (!Array.isArray(lessons)) return { distilled: 0 };
    lessons = lessons
      .filter((l) => l && typeof l.lesson === 'string' && l.lesson.length > 10)
      .slice(0, MAX_ACTIVE_LESSONS);

    // Atomic-enough swap: deactivate this operator's old distilled set, insert new.
    await supabase.from('ai_lessons')
      .update({ active: false })
      .eq('user_id', userId)
      .eq('source', 'outcome_distillation')
      .then(null, () => {});

    if (lessons.length > 0) {
      await supabase.from('ai_lessons').insert(lessons.map((l) => ({
        user_id: userId,
        scope: l.scope || 'calling',
        lesson: l.lesson.slice(0, 500),
        evidence: (l.evidence || '').slice(0, 300),
        evidence_count: Number(l.evidence_count) || 2,
        source: 'outcome_distillation',
        active: true,
        last_verified_at: new Date().toISOString(),
      }))).then(null, (e) => console.warn('[LearningLoop] lesson insert failed:', e.message));
    }

    lessonCache.delete(userId); // next call re-primes with the fresh set
    console.log(`[LearningLoop] distilled ${lessons.length} lessons for operator ${userId} from ${calls.length} verified calls`);
    return { distilled: lessons.length };
  } catch (err) {
    console.warn('[LearningLoop] distillLessons failed:', err.message);
    return { distilled: 0, error: err.message };
  }
}

/**
 * Nightly sweep: distill for every operator with recent verified call activity.
 * Serial on purpose (cheap model, small N today; kind to rate limits at 5k users
 * it becomes a queued job — the per-operator unit of work is already isolated).
 */
async function distillAllActiveOperators() {
  try {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const { data: rows } = await supabase
      .from('calls')
      .select('user_id')
      .not('outcome', 'is', null)
      .gte('ended_at', since)
      .limit(2000);
    const operatorIds = [...new Set((rows || []).map((r) => r.user_id).filter(Boolean))];
    console.log(`[LearningLoop] nightly distillation for ${operatorIds.length} active operator(s)`);
    for (const uid of operatorIds) {
      await distillLessons(uid);
    }
  } catch (err) {
    console.warn('[LearningLoop] distillAllActiveOperators failed:', err.message);
  }
}

module.exports = {
  getLessonBlockSync,
  primeLessonCache,
  learnFromCall,
  logPrediction,
  verifyPrediction,
  distillLessons,
  distillAllActiveOperators,
};
