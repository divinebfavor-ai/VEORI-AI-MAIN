// ─── Agent kit: one architecture for every intelligence agent ───────────────
// defineAgent() registers the declaration and returns an agent whose run():
//   - requires a tenant (userId) and never reaches other tenants' data
//   - calls the agent's analyze(ctx) with a time budget
//   - normalises the result to the shared AgentOutput schema
//   - enforces confidence 0-100 with reasoning, and provenance on findings
//   - persists to agent_outputs and writes an audit_events row
// Agents only return data; side effects (sends, offers) go through permissions.

const supabase = require('../config/supabase');
const registry = require('./registry');
const audit = require('./audit');
const { isStatus } = require('./provenance');

const DEFAULT_TIMEOUT_MS = Number(process.env.INTELLIGENCE_AGENT_TIMEOUT_MS) || 30000;
const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const URGENCIES = ['critical', 'high', 'medium', 'low'];
const STATUSES = ['complete', 'insufficient_data', 'not_applicable', 'error'];

function clampConfidence(c) {
  const n = Math.round(Number(c));
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

// Validate and normalise whatever analyze() returned into AgentOutput.
function normalizeOutput(decl, raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const problems = [];
  const status = STATUSES.includes(r.status) ? r.status : 'complete';
  const findings = (Array.isArray(r.findings) ? r.findings : []).filter(f => {
    const ok = f && typeof f.label === 'string' && f.claim && isStatus(f.claim.status);
    if (!ok) problems.push('finding without a label or provenance claim dropped');
    return ok;
  });
  const risks = (Array.isArray(r.risks) ? r.risks : []).map(x => ({
    risk: String(x.risk || '').slice(0, 500), severity: SEVERITIES.includes(x.severity) ? x.severity : 'medium',
    category: x.category || null, evidence: x.evidence || null, mitigation: x.mitigation || null,
  })).filter(x => x.risk);
  const recommendations = (Array.isArray(r.recommendations) ? r.recommendations : []).map(x => ({
    action: String(x.action || '').slice(0, 500), why: String(x.why || '').slice(0, 1000),
    urgency: URGENCIES.includes(x.urgency) ? x.urgency : 'medium', impact: x.impact ? String(x.impact).slice(0, 500) : null,
    action_type: x.action_type || null, dependencies: Array.isArray(x.dependencies) ? x.dependencies : [],
    assigned_to: x.assigned_to || 'operator', payload: x.payload || null,
  })).filter(x => x.action && x.why);
  const missing = (Array.isArray(r.missing) ? r.missing : []).map(m => ({
    item: String(m.item || '').slice(0, 200), why_it_matters: String(m.why_it_matters || '').slice(0, 500), how_to_get: String(m.how_to_get || '').slice(0, 500),
  })).filter(m => m.item);
  let confidence = clampConfidence(r.confidence?.score);
  let reasoning = typeof r.confidence?.reasoning === 'string' ? r.confidence.reasoning.trim() : '';
  if (!reasoning) { problems.push('confidence had no reasoning'); reasoning = 'No reasoning supplied - confidence set to 0'; confidence = 0; }
  if (status === 'insufficient_data') confidence = Math.min(confidence, 40);
  return {
    agent_id: decl.id, agent_version: decl.version, output_type: r.output_type || decl.outputs[0],
    status, summary: String(r.summary || '').slice(0, 2000),
    findings, calculations: Array.isArray(r.calculations) ? r.calculations : [],
    recommendations, risks, missing,
    confidence: { score: confidence, reasoning: reasoning.slice(0, 1500) },
    sources: Array.isArray(r.sources) ? r.sources : [],
    positions: r.positions && typeof r.positions === 'object' ? r.positions : {},   // numeric stances used for disagreement detection
    handoffs: (Array.isArray(r.handoffs) ? r.handoffs : []).filter(h => registry.has(h)),
    attorney_review: r.attorney_review === true,
    data: r.data && typeof r.data === 'object' ? r.data : {},
    integrity_notes: problems,
  };
}

function defineAgent({ declaration, analyze, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const decl = registry.declare(declaration);
  if (typeof analyze !== 'function') throw new Error(`Agent ${decl.id}: analyze(ctx) is required`);

  async function run(ctx, { persist = true } = {}) {
    if (!ctx || !ctx.userId) throw new Error(`${decl.id}: ctx.userId is required (tenant isolation)`);
    const started = Date.now();
    let output;
    try {
      let timer;
      const raw = await Promise.race([
        analyze(ctx),
        new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error(`${decl.name} timed out after ${timeoutMs}ms`), { code: 'TIMEOUT' })), timeoutMs); }),
      ]).finally(() => clearTimeout(timer));
      output = normalizeOutput(decl, raw);
    } catch (err) {
      output = normalizeOutput(decl, {
        status: 'error', summary: `${decl.name} could not complete: ${err.message}`,
        confidence: { score: 0, reasoning: 'The agent failed, so nothing it would have said can be relied on.' },
      });
      output.error = { message: err.message, code: err.code || null };
    }
    output.duration_ms = Date.now() - started;

    if (persist && supabase?.from) {
      const { data, error } = await supabase.from('agent_outputs').insert({
        user_id: ctx.userId, deal_id: ctx.dealId || null, run_id: ctx.runId || null,
        agent_id: decl.id, agent_version: decl.version, output_type: output.output_type,
        data: output, confidence: output.confidence.score, confidence_reasoning: output.confidence.reasoning,
        sources: output.sources,
      }).select('id').single();
      if (error) console.error(`[Agent ${decl.id}] output persist failed:`, error.message);
      else output.output_id = data.id;
      await audit.record({
        userId: ctx.userId, dealId: ctx.dealId || null, runId: ctx.runId || null, agentId: decl.id,
        actorUserId: ctx.actorUserId || null, actionType: `agent.run.${decl.id}`,
        inputs: { command: ctx.command || null, input_keys: Object.keys(ctx.inputs || {}) },
        outputs: { status: output.status, summary: output.summary, recommendations: output.recommendations.length, risks: output.risks.length, missing: output.missing.length, output_id: output.output_id || null, error: output.error || null },
        confidence: output.confidence.score, sources: output.sources,
      });
    }
    return output;
  }

  return { declaration: decl, run, id: decl.id };
}

module.exports = { defineAgent, normalizeOutput, SEVERITIES, URGENCIES };
