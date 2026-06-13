/**
 * Voice Brain Service — the "what does the agent say next" seam for the live,
 * turn-based Twilio + ElevenLabs conversation (v2 calling layer).
 *
 * MODULE 6 SCOPE (this file, right now): a deterministic STUB so the conversation
 * loop in /api/v2/voice/twiml + /gather is fully testable without spending a
 * Claude call. It produces a sensible opening line and short acknowledging
 * replies, and ends the call politely after a few turns or on a goodbye cue.
 *
 * MODULE 7 replaces the body of nextTurn() with the real Claude brain — reusing
 * vapiService.getScriptByLeadTag(lead, operator, useCaseOverride) for the system
 * prompt and the Anthropic SDK for the completion, threading the running
 * transcript. The PUBLIC SHAPE of this module (openingLine, nextTurn) stays the
 * same so v2voice.js never changes again.
 *
 * Contract (stable):
 *   openingLine(ctx) -> string
 *   nextTurn({ ...ctx, callId, callSid, speech, confidence }) -> { reply, end }
 *
 * ctx is what loadCallContext() returns: { call, lead, operator, operatorId,
 * leadId, voiceId }.
 */

// How many seller turns the stub will entertain before wrapping up. Keeps test
// calls short and deterministic. Module 7's Claude path will end on intent, not
// a turn counter — this is stub-only state.
const STUB_MAX_TURNS = 4;

// Simple in-memory per-call turn counter for the stub. Real Claude (Module 7)
// reconstructs state from the persisted transcript, so this Map goes away then.
const stubTurns = new Map();

// Goodbye cues that let the stub end the call naturally if the seller signals
// they're done. Lowercased substring match against the transcribed speech.
const GOODBYE_CUES = [
  'not interested', 'stop calling', 'take me off', 'remove me',
  'goodbye', 'bye', 'no thanks', 'no thank you', 'hang up',
];

/**
 * The agent's opening line when the seller picks up.
 * @param {object} ctx  loadCallContext() result
 * @returns {string}
 */
function openingLine(ctx = {}) {
  const aiName = ctx.operator?.ai_caller_name || 'Alex';
  const company = ctx.operator?.company_name || 'a local real estate group';
  const firstName = ctx.lead?.first_name || 'there';
  return `Hi ${firstName}, this is ${aiName} with ${company}. ` +
    `I know I'm catching you out of the blue — do you have a quick minute?`;
}

/**
 * Produce the agent's next line for one conversational turn.
 *
 * MODULE 6: deterministic stub. Acknowledges what was heard, asks a light
 * follow-up, and ends after STUB_MAX_TURNS or on a goodbye cue.
 * MODULE 7: this becomes the Claude call (system prompt from
 * vapiService.getScriptByLeadTag + transcript history).
 *
 * @param {object} args
 * @param {string} args.callId
 * @param {string} args.speech     seller's transcribed words (may be empty on silence)
 * @returns {Promise<{ reply: string, end: boolean }>}
 */
async function nextTurn(args = {}) {
  const { callId, speech = '' } = args;
  const heard = String(speech || '').toLowerCase().trim();

  // Track turns per call so the stub call always terminates.
  const turn = (stubTurns.get(callId) || 0) + 1;
  stubTurns.set(callId, turn);

  // Seller signalled they're done — close out politely.
  if (heard && GOODBYE_CUES.some((c) => heard.includes(c))) {
    stubTurns.delete(callId);
    return { reply: "No problem at all — I appreciate your time. Have a great day.", end: true };
  }

  // Silence (empty SpeechResult) — one gentle reprompt, then move on.
  if (!heard) {
    if (turn >= STUB_MAX_TURNS) {
      stubTurns.delete(callId);
      return { reply: "Looks like I may have caught you at a bad time. I'll try you again later. Take care.", end: true };
    }
    return { reply: "Sorry, I didn't quite catch that — are you still there?", end: false };
  }

  // Reached the turn budget — wrap the stubbed conversation.
  if (turn >= STUB_MAX_TURNS) {
    stubTurns.delete(callId);
    return {
      reply: "I really appreciate you chatting with me. I'll follow up shortly with a few details. Thanks again, and take care.",
      end: true,
    };
  }

  // Generic acknowledging reply that keeps the conversation moving. The real
  // Claude brain (Module 7) replaces this with property-specific dialogue.
  return {
    reply: "Got it, thanks for sharing that. Just so I understand — what's prompting you to consider your options with the property right now?",
    end: false,
  };
}

module.exports = {
  openingLine,
  nextTurn,
};
