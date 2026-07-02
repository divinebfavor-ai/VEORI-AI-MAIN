/**
 * Voice Brain Service — the "what does the agent say next" seam for the live,
 * turn-based Twilio + ElevenLabs conversation (v2 calling layer).
 *
 * MODULE 7 (this file, now): the real Claude brain. nextTurn() runs the actual
 * Anthropic completion using the SAME system prompt the Vapi path used
 * (vapiService.getScriptByLeadTag(lead, operator, useCaseOverride)), threading
 * the running per-call transcript so Claude has full conversational context. The
 * PUBLIC SHAPE of this module is unchanged from Module 6, so v2voice.js never
 * changes:
 *
 *   openingLine(ctx) -> string
 *   nextTurn({ ...ctx, callId, callSid, speech, confidence }) -> { reply, end, emotion }
 *
 * (emotion is an ADDITIVE field — an optional per-line delivery cue like 'gentle'
 * or 'excited' that the audio seam maps to dynamic ElevenLabs voice_settings so
 * the line is spoken with feeling instead of one flat setting. Callers that ignore
 * it behave exactly as before.)
 *
 * ctx is what loadCallContext() returns: { call, lead, operator, operatorId,
 * leadId, voiceId }.
 *
 * STATE: each /gather webhook is a fresh stateless HTTP request, so the running
 * transcript is held in an in-memory Map keyed by callId (single Railway process,
 * a call lasts minutes). If the process restarts mid-call the history resets for
 * that one call — acceptable; Module 8 adds the durable Supabase transcript log.
 *
 * END-OF-CALL: Claude is told to append a sentinel token [[END_CALL]] to its
 * final line when the conversation is naturally done. We strip the sentinel
 * before speaking and set end:true. A seller goodbye cue and a hard max-turn cap
 * are safety nets so a call always terminates even if Claude never emits it.
 *
 * RESILIENCE: any Claude/SDK failure falls back to a safe spoken line and keeps
 * the call listening rather than dropping — the line is never left dead.
 */

const Anthropic = require('@anthropic-ai/sdk');
const vapiService = require('./vapiService');
const supabase = require('../config/supabase');
const elevenLabs = require('./elevenLabsService');

// ── Anthropic client (lazy, mirrors dualAIService.js) ────────────────────────
let anthropicClient = null;
function getAnthropic() {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      timeout: 30000,   // 30s — a live phone turn must resolve fast or fall back
      maxRetries: 1,    // one quick retry only; latency is king on a live call
    });
  }
  return anthropicClient;
}

// Model for the live voice brain. Defaults to the same low-latency model the Vapi
// path used (claude-haiku-4-5-20251001). Override with VOICE_BRAIN_MODEL on
// Railway to swap in a smarter/slower model (e.g. claude-sonnet-4-6) with no code
// change. Latency matters per turn — the seller is waiting on the line.
const BRAIN_MODEL = process.env.VOICE_BRAIN_MODEL || 'claude-haiku-4-5-20251001';
const BRAIN_MAX_TOKENS = parseInt(process.env.VOICE_BRAIN_MAX_TOKENS, 10) || 200;
const BRAIN_TEMPERATURE = process.env.VOICE_BRAIN_TEMPERATURE
  ? parseFloat(process.env.VOICE_BRAIN_TEMPERATURE)
  : 0.7;

// Sentinel Claude appends to its FINAL line when the conversation is naturally
// complete. Stripped before we speak; presence flips end:true. Kept distinctive
// so it never collides with real speech.
const END_SENTINEL = '[[END_CALL]]';

// Hard safety cap so a call always ends even if Claude never emits the sentinel.
// Generous — real conversations should end on intent well before this.
const MAX_TURNS = parseInt(process.env.VOICE_BRAIN_MAX_TURNS, 10) || 40;

// Seller goodbye cues — a clear opt-out ends the call immediately and politely,
// independent of the model. Lowercased substring match against the transcript.
const GOODBYE_CUES = [
  'not interested', 'stop calling', 'take me off', 'remove me',
  'do not call', "don't call", 'lose my number', 'hang up',
];

// Per-call conversation state: callId -> { messages: [{role, content}], turns }.
// messages is the running transcript handed to Claude each turn (assistant =
// agent lines, user = seller speech). Cleared when the call ends.
const sessions = new Map();

// ── Module 8: durable transcript ─────────────────────────────────────────────
// Render the in-memory message list into the same plain "Speaker: line" format
// the Vapi path stored in calls.transcript, so aiService.analyzeCallTranscript
// and the existing UI read Twilio transcripts identically. assistant -> "Agent",
// user -> "Seller"; the silence placeholder is dropped so it never pollutes the
// stored transcript or the score.
function formatTranscript(messages = []) {
  return messages
    .filter((m) => m && m.content && m.content !== '(no response / silence)')
    .map((m) => `${m.role === 'assistant' ? 'Agent' : 'Seller'}: ${m.content}`)
    .join('\n');
}

// Persist the running transcript to calls.transcript after each turn (best-effort).
// Keyed by callId (= calls.id, which the brain holds). This is what lets the
// /status call-end hook score even after the in-memory session is deleted
// (sentinel/goodbye/max-turns) or the process restarts mid-call. Never throws —
// a persistence miss must never break a live turn.
async function persistTranscript(callId, messages) {
  if (!callId) return;
  try {
    const transcript = formatTranscript(messages);
    if (!transcript) return;
    const { error } = await supabase
      .from('calls')
      .update({ transcript })
      .eq('id', callId);
    if (error) console.warn('[voiceBrain] persistTranscript failed:', error.message);
  } catch (err) {
    console.warn('[voiceBrain] persistTranscript error:', err.message);
  }
}

/** Append the appended-to-system end-call directive onto the base script. */
function withEndDirective(systemPrompt) {
  return `${systemPrompt}

══════════════════════════════════════════════════════
ENDING THE CALL (system mechanic — never speak this aloud)
══════════════════════════════════════════════════════
When the conversation has reached a natural end — the seller has clearly opted
out, you've agreed on next steps, or there is genuinely nothing left to say —
finish your final spoken sentence normally, then append the exact token ${END_SENTINEL}
to the very end of your reply. Do NOT say the token out loud or reference it. It
is a silent signal to hang up. If the conversation should continue, do NOT include
it. Only ever place it at the end of your last line.`;
}

/**
 * The agent's opening line when the seller picks up. Seeds the per-call
 * transcript so Claude has continuity from turn one. Deterministic (no model
 * call) so the very first thing the seller hears is instant — no dead air while
 * a completion runs. Claude takes over from the seller's first reply onward.
 * @param {object} ctx  loadCallContext() result
 * @returns {string}
 */
function openingLine(ctx = {}) {
  const aiName = ctx.operator?.ai_caller_name || 'Alex';
  const company = ctx.operator?.company_name || 'a local real estate group';
  const firstName = ctx.lead?.first_name || 'there';
  const line = `Hi ${firstName}, this is ${aiName} with ${company}. ` +
    `I know I'm catching you out of the blue — do you have a quick minute?`;

  // Seed the session so the opener is in Claude's context as the first assistant
  // turn. callId may be absent here (twiml builds it); seed lazily in nextTurn if
  // so, but seeding now keeps the transcript honest when callId is present.
  const callId = ctx.callId || ctx.call?.id;
  if (callId) {
    sessions.set(callId, { messages: [{ role: 'assistant', content: line }], turns: 0 });
  }
  return line;
}

/**
 * Produce the agent's next line for one conversational turn via Claude.
 *
 * Builds (or reuses) the per-call session, appends the seller's speech, calls
 * Claude with the operator's system prompt + full transcript, strips the end
 * sentinel, and returns { reply, end }. Falls back to a safe spoken line on any
 * model/SDK failure so the call is never dropped.
 *
 * @param {object} args  ctx (call, lead, operator, ...) plus:
 * @param {string} args.callId
 * @param {string} args.speech       seller's transcribed words (may be empty on silence)
 * @param {object} [args.operator]
 * @param {object} [args.lead]
 * @returns {Promise<{ reply: string, end: boolean, emotion: string|null }>}
 *          emotion is the parsed per-line delivery cue (or null) — additive.
 */
async function nextTurn(args = {}) {
  const { callId, speech = '', operator = {}, lead = {} } = args;
  const heard = String(speech || '').trim();
  const heardLower = heard.toLowerCase();

  // Pull or create the session. If openingLine never ran with a callId (e.g. the
  // opener was built before callId was known), start a fresh transcript here.
  let session = sessions.get(callId);
  if (!session) {
    session = { messages: [], turns: 0 };
    sessions.set(callId, session);
  }
  session.turns += 1;

  // Seller explicitly opted out — close immediately and politely, no model call.
  if (heardLower && GOODBYE_CUES.some((c) => heardLower.includes(c))) {
    const closer = 'No problem at all — I appreciate your time. Have a great day.';
    session.messages.push({ role: 'user', content: heard });
    session.messages.push({ role: 'assistant', content: closer });
    await persistTranscript(callId, session.messages); // flush before discarding
    sessions.delete(callId);
    return { reply: closer, end: true, emotion: 'warm' };
  }

  // Record the seller's turn (skip empty/silence so we don't feed Claude blanks).
  if (heard) {
    session.messages.push({ role: 'user', content: heard });
  } else {
    // Silence: nudge once via a neutral user turn so Claude reprompts naturally.
    session.messages.push({ role: 'user', content: '(no response / silence)' });
  }

  // Hard safety cap — always terminate eventually.
  if (session.turns >= MAX_TURNS) {
    const closer = "I appreciate you taking the time with me today. I'll follow up shortly. Take care.";
    session.messages.push({ role: 'assistant', content: closer });
    await persistTranscript(callId, session.messages); // flush before discarding
    sessions.delete(callId);
    return { reply: closer, end: true, emotion: 'warm' };
  }

  try {
    // Same system prompt the Vapi path used, plus the silent end-call directive.
    const basePrompt = vapiService.getScriptByLeadTag(lead, operator, args.useCaseOverride || null);
    const system = withEndDirective(basePrompt);

    const anthropic = getAnthropic();
    const msg = await anthropic.messages.create({
      model: BRAIN_MODEL,
      max_tokens: BRAIN_MAX_TOKENS,
      temperature: BRAIN_TEMPERATURE,
      system,
      messages: session.messages,
    });

    // Concatenate any text blocks Claude returns.
    let reply = (msg.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join(' ')
      .trim();

    // Detect + strip the end sentinel (anywhere in the reply, just in case).
    const end = reply.includes(END_SENTINEL);
    if (end) reply = reply.split(END_SENTINEL).join('').trim();

    // Parse + strip the leading emotion cue ("{gentle} ...") the prompt asks
    // Claude to prefix each line with. The cue must come off HERE — before the
    // line is stored/fed back to Claude and before it's spoken — so the tag never
    // pollutes the scored transcript nor the next-turn context, and never gets
    // read aloud. Unknown/absent tag → emotion null → base voice (identical to
    // today). The audio seam (speakLine) turns emotion into dynamic voice_settings.
    const { emotion, text: spoken } = elevenLabs.parseEmotionCue(reply);
    reply = spoken;

    // Empty completion guard — never speak nothing.
    if (!reply) {
      reply = 'Sorry, could you say that again?';
    }

    // Thread the agent's line back into the transcript for the next turn.
    session.messages.push({ role: 'assistant', content: reply });

    // Durable per-turn snapshot so the call-end scorer always has the transcript,
    // even if this turn is the last one (sentinel) or the process restarts.
    await persistTranscript(callId, session.messages);

    if (end) sessions.delete(callId);
    return { reply, end, emotion };
  } catch (err) {
    console.warn('[voiceBrain] Claude turn failed, using fallback line:', err.message);
    // Don't drop the call — speak a safe line and keep the conversation going.
    return {
      reply: "Sorry, I didn't quite catch that — could you say that again?",
      end: false,
      emotion: 'warm',
    };
  }
}

module.exports = {
  openingLine,
  nextTurn,
};
