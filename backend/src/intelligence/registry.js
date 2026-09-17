// ─── Agent registry ─────────────────────────────────────────────────────────
// Every agent declares itself here when its module loads. Declarations are
// validated against the AgentDeclaration contract; an invalid declaration throws at
// startup instead of producing an agent the orchestrator can't reason about.
// syncToDatabase() mirrors the registry into agent_registry for the UI and audit.

const supabase = require('../config/supabase');

const PERMISSION_LEVELS = Object.freeze(['READ', 'RECOMMEND', 'DRAFT', 'EXECUTE', 'HIGH_RISK']);
const RISK_LEVELS = Object.freeze(['low', 'medium', 'high']);

const agents = new Map();

function assertStringArray(value, field, id) {
  if (!Array.isArray(value) || value.some(v => typeof v !== 'string' || !v.trim())) {
    throw new Error(`Agent ${id}: ${field} must be an array of non-empty strings`);
  }
}

function validateDeclaration(d) {
  if (!d || typeof d !== 'object') throw new Error('Agent declaration must be an object');
  const id = d.id;
  if (typeof id !== 'string' || !/^[a-z][a-z0-9_]{2,60}$/.test(id)) throw new Error(`Agent id "${id}" must be snake_case`);
  for (const f of ['name', 'domain', 'version', 'last_knowledge_update']) {
    if (typeof d[f] !== 'string' || !d[f].trim()) throw new Error(`Agent ${id}: ${f} is required`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(d.version)) throw new Error(`Agent ${id}: version must be semver (x.y.z)`);
  for (const f of ['capabilities', 'required_inputs', 'outputs', 'tools', 'knowledge_sources', 'handoff_agents']) {
    assertStringArray(d[f], f, id);
  }
  if (!d.capabilities.length) throw new Error(`Agent ${id}: at least one capability is required`);
  if (!d.outputs.length) throw new Error(`Agent ${id}: at least one output is required`);
  if (!PERMISSION_LEVELS.includes(d.permissions)) throw new Error(`Agent ${id}: permissions must be one of ${PERMISSION_LEVELS.join(', ')}`);
  if (!RISK_LEVELS.includes(d.risk_level)) throw new Error(`Agent ${id}: risk_level must be low, medium or high`);
  if (typeof d.jurisdiction_aware !== 'boolean') throw new Error(`Agent ${id}: jurisdiction_aware must be true or false`);
  return true;
}

function declare(declaration) {
  validateDeclaration(declaration);
  const existing = agents.get(declaration.id);
  if (existing && existing.version !== declaration.version) {
    throw new Error(`Agent ${declaration.id} declared twice with different versions (${existing.version}, ${declaration.version})`);
  }
  const frozen = Object.freeze({ ...declaration });
  agents.set(declaration.id, frozen);
  return frozen;
}

const get = (id) => agents.get(id) || null;
const list = () => [...agents.values()].sort((a, b) => a.domain.localeCompare(b.domain) || a.id.localeCompare(b.id));
const has = (id) => agents.has(id);

// Handoffs must point at declared agents; call after all agent modules load.
function validateHandoffs() {
  const problems = [];
  for (const a of agents.values()) {
    for (const h of a.handoff_agents) if (!agents.has(h)) problems.push(`${a.id} hands off to undeclared agent ${h}`);
  }
  return problems;
}

async function syncToDatabase() {
  const rows = list().map(a => ({
    id: a.id, name: a.name, domain: a.domain, version: a.version,
    capabilities: a.capabilities, required_inputs: a.required_inputs, outputs: a.outputs,
    tools: a.tools, knowledge_sources: a.knowledge_sources, permissions: a.permissions,
    risk_level: a.risk_level, handoff_agents: a.handoff_agents, jurisdiction_aware: a.jurisdiction_aware,
    last_knowledge_update: a.last_knowledge_update, status: a.status || 'active', updated_at: new Date().toISOString(),
  }));
  if (!rows.length) return 0;
  const { error } = await supabase.from('agent_registry').upsert(rows, { onConflict: 'id' });
  if (error) throw error;
  return rows.length;
}

module.exports = { PERMISSION_LEVELS, RISK_LEVELS, declare, get, list, has, validateDeclaration, validateHandoffs, syncToDatabase, _reset: () => agents.clear() };
