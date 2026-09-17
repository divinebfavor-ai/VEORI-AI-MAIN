// ─── Model access for intelligence agents ───────────────────────────────────
// Agents use the model to interpret, explain and reason about evidence - never to
// compute money (calc/ does that) and never as a source of facts. Every call:
//   - inherits the shared compliance spine (agents/agentSpine)
//   - wraps operator/seller/provider text as untrusted data
//   - runs through aiService.callAnthropic (shared concurrency limit + retries)
//   - returns parsed JSON or { ok:false } - callers must handle the failure

const { callAnthropic } = require('../services/aiService');
const { composeAgentPrompt } = require('../agents/agentSpine');
const { DATA_ONLY_RULE, untrustedBlock, detectInjection, cleanText } = require('./sanitize');
const { parseStructured, textOf } = require('../agents/agentRuntime');

const FAST_MODEL = process.env.INTELLIGENCE_FAST_MODEL || 'claude-haiku-4-5-20251001';
const TIMEOUT_MS = Number(process.env.INTELLIGENCE_LLM_TIMEOUT_MS) || 25000;

const JSON_RULES = `OUTPUT RULES
- Answer with one JSON object only, no prose outside it.
- Do not calculate money, rates or returns; use only the numbers given in VERIFIED/CALCULATED facts.
- Any statement you add is INFERRED or ESTIMATED unless a supplied fact already carries a stronger status.
- If the facts don't support an answer, say what is missing instead of guessing.`;

function withTimeout(promise, ms) {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(Object.assign(new Error('Model call timed out'), { code: 'TIMEOUT' })), ms); })])
    .finally(() => clearTimeout(t));
}

/**
 * @param {object} p
 * @param {string} p.agentId
 * @param {string} p.rolePrompt   the agent's instructions
 * @param {object} p.facts        structured, already-provenanced facts (trusted structure)
 * @param {object} [p.untrusted]  label -> free text from operators/sellers/providers
 * @param {string} p.task         what to produce
 * @param {string} p.schema       JSON shape description
 */
async function json({ agentId, rolePrompt, facts = {}, untrusted = {}, task, schema, maxTokens = 900, model = FAST_MODEL }) {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: 'Model not configured (ANTHROPIC_API_KEY)', code: 'NOT_CONFIGURED' };
  const injectionFlags = [];
  const untrustedText = Object.entries(untrusted)
    .filter(([, v]) => v != null && v !== '')
    .map(([label, v]) => { injectionFlags.push(...detectInjection(v)); return untrustedBlock(label, v); })
    .join('\n\n');
  const system = `${composeAgentPrompt(rolePrompt)}\n\n${DATA_ONLY_RULE}\n\n${JSON_RULES}`;
  const user = [
    `FACTS (JSON, each value carries its provenance status):\n${cleanText(JSON.stringify(facts), 24000)}`,
    untrustedText,
    `TASK:\n${cleanText(task, 2000)}`,
    `RESPOND WITH JSON MATCHING:\n${schema}`,
  ].filter(Boolean).join('\n\n');
  try {
    const msg = await withTimeout(callAnthropic({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }, { label: `intel:${agentId}`, retries: 2 }), TIMEOUT_MS);
    const { parsed } = parseStructured(textOf(msg));
    if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'Model did not return valid JSON', code: 'BAD_OUTPUT', injectionFlags };
    return { ok: true, data: parsed, model, injectionFlags, usage: msg.usage || null };
  } catch (err) {
    return { ok: false, error: err.message, code: err.code || 'MODEL_ERROR', injectionFlags };
  }
}

module.exports = { json, FAST_MODEL };
