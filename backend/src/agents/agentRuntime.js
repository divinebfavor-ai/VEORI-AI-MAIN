// ─────────────────────────────────────────────────────────────────────────────
// agentRuntime - the shared execution harness every Veori agent runs on.
//
// PURPOSE: give all 8 agents ONE consistent way to (1) inherit the spine,
// (2) read the shared lead memory, (3) call the model through the existing
// concurrency-limited/retry wrapper (aiService.callAnthropic - NOT a new client),
// (4) parse a structured JSON result, and (5) emit a tenant-scoped audit record.
// This keeps agents small: an agent file is really just a role prompt + a tool
// allowlist + an I/O schema; the plumbing lives here once.
//
// REUSE, DON'T DUPLICATE:
//   • Model calls go through services/aiService.callAnthropic → inherits the
//     process-wide MAX_CONCURRENT limiter, exponential-backoff retries, and lazy
//     client. No agent opens its own Anthropic client or its own rate pool.
//   • Memory comes from agents/leadMemory.getLeadCanonical → the same canonical
//     record for every agent, tenant-guarded.
//   • Audit goes through services/auditLog.log → the same audit_logs table the
//     rest of the platform uses. Best-effort; never throws.
//
// AUTONOMY: runAgent does NOT insert a human-approval gate. Agents act. The only
// pre-flight that can stop an action is agents/complianceGate.complianceGate,
// which an agent invokes for a concrete outbound ACTION (not for thinking). The
// runtime exposes gateAction() as the single call site so every agent gates the
// same way, but thinking/analysis is never gated.
//
// TENANT ISOLATION: runAgent REQUIRES ctx.userId. If a leadId is supplied, memory
// is loaded with that userId; a foreign/missing lead yields null memory (never
// another tenant's data). userId is stamped on the audit record.
// ─────────────────────────────────────────────────────────────────────────────

const { callAnthropic } = require('../services/aiService');
const auditLog = require('../services/auditLog');
const { composeAgentPrompt } = require('./agentSpine');
const { getLeadCanonical, toPromptContext } = require('./leadMemory');
const { complianceGate } = require('./complianceGate');

// Agent turns run on the fast model by default (same family the platform already
// uses). An agent may override via def.model for a heavier reasoning task.
const DEFAULT_AGENT_MODEL = process.env.AGENT_MODEL || 'claude-haiku-4-5-20251001';
const DEFAULT_MAX_TOKENS = 1200;

/**
 * Pull the first text block out of an Anthropic messages response.
 */
function textOf(msg) {
  if (!msg || !Array.isArray(msg.content)) return '';
  const block = msg.content.find(b => b.type === 'text');
  return block ? block.text : '';
}

/**
 * Best-effort JSON extraction from a model response. Agents are instructed to
 * answer in JSON; this tolerates code fences or leading prose without throwing.
 * Returns { parsed, raw } - parsed is null if nothing valid was found.
 */
function parseStructured(text) {
  const raw = String(text || '');
  // Strip a ```json ... ``` fence if present.
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  // Grab the outermost {...} or [...] if there is surrounding prose.
  const objMatch = candidate.match(/[[{][\s\S]*[\]}]/);
  const jsonStr = objMatch ? objMatch[0] : candidate;
  try {
    return { parsed: JSON.parse(jsonStr), raw };
  } catch {
    return { parsed: null, raw };
  }
}

/**
 * Run a compliance pre-flight for a concrete outbound action. The single gate
 * call site for every agent. Returns the complianceGate contract.
 * @param {object} action  see complianceGate() action shape
 * @param {object} [opts]
 */
async function gateAction(action, opts) {
  return complianceGate(action, opts);
}

/**
 * Execute one agent turn.
 *
 * @param {object} def   the agent definition:
 *   {
 *     name:        'compliance' | 'acquisition' | ...   (audit label)
 *     rolePrompt:  string       (agent-specific instructions; spine is prepended)
 *     model?:      string       (override DEFAULT_AGENT_MODEL)
 *     maxTokens?:  number
 *     auditAction?: string      (audit_logs.action; defaults to `agent.<name>`)
 *   }
 * @param {object} ctx   the call context:
 *   {
 *     userId:   string   (REQUIRED - the owning tenant / fence)
 *     leadId?:  string   (if set, canonical memory is loaded + injected)
 *     input:    string|object  (the task for this turn)
 *     memory?:  object   (pre-loaded canonical record to reuse across a handoff,
 *                        avoids re-querying when the orchestrator already has it)
 *     extraContext?: string  (any additional prompt context, e.g. upstream agent output)
 *   }
 * @returns {Promise<object>}
 *   {
 *     ok, agent, parsed, raw, memoryUsed:boolean, model
 *   }
 */
async function runAgent(def, ctx) {
  if (!def || !def.name || !def.rolePrompt) {
    throw new Error('runAgent: def.name and def.rolePrompt are required');
  }
  if (!ctx || !ctx.userId) {
    throw new Error('runAgent: ctx.userId is required (tenant isolation)');
  }

  // 1. Load shared memory (reuse a pre-loaded record if the orchestrator passed one).
  let canonical = ctx.memory || null;
  if (!canonical && ctx.leadId) {
    canonical = await getLeadCanonical(ctx.userId, ctx.leadId);
  }
  const memoryBlock = canonical ? toPromptContext(canonical) : '';

  // 2. Compose the full system prompt: spine + role.
  const system = composeAgentPrompt(def.rolePrompt);

  // 3. Build the user turn: memory + upstream context + the task.
  const inputText = typeof ctx.input === 'string'
    ? ctx.input
    : JSON.stringify(ctx.input ?? {}, null, 2);
  const userParts = [];
  if (memoryBlock) userParts.push(memoryBlock);
  if (ctx.extraContext) userParts.push(String(ctx.extraContext));
  userParts.push(`TASK:\n${inputText}`);
  const userContent = userParts.join('\n\n');

  // 4. Call the model through the shared limited/retried wrapper.
  let msg, err = null;
  try {
    msg = await callAnthropic({
      model: def.model || DEFAULT_AGENT_MODEL,
      max_tokens: def.maxTokens || DEFAULT_MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: userContent }],
    }, { label: `agent:${def.name}` });
  } catch (e) {
    err = e;
  }

  const raw = textOf(msg);
  const { parsed } = parseStructured(raw);

  // 5. Audit - tenant-scoped, best-effort (never throws, never blocks the agent).
  auditLog.log({
    userId: ctx.userId,
    action: def.auditAction || `agent.${def.name}`,
    resource: ctx.leadId ? `lead:${ctx.leadId}` : null,
    metadata: {
      agent: def.name,
      model: def.model || DEFAULT_AGENT_MODEL,
      memoryUsed: !!memoryBlock,
      ok: !err,
      error: err ? err.message : undefined,
      // store the structured verdict when we got one, else a short raw preview
      result: parsed || (raw ? raw.slice(0, 500) : undefined),
    },
  }).catch(() => {}); // audit must never break the agent

  if (err) {
    return { ok: false, agent: def.name, parsed: null, raw: '', error: err.message, memoryUsed: !!memoryBlock, model: def.model || DEFAULT_AGENT_MODEL };
  }

  return {
    ok: true,
    agent: def.name,
    parsed,
    raw,
    memoryUsed: !!memoryBlock,
    model: def.model || DEFAULT_AGENT_MODEL,
  };
}

module.exports = {
  runAgent,
  gateAction,
  parseStructured,
  textOf,
  DEFAULT_AGENT_MODEL,
};
