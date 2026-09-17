// ─── Agent catalogue ─────────────────────────────────────────────────────────
// Loading this file declares every intelligence agent in the registry. The eight
// original agents (src/agents/*) are declared too so the registry is the single
// list of what exists; they keep running through their own orchestrator, which
// stays behind AGENTS_ENABLED.

const registry = require('../registry');
const H = require('./_shared');
const { leadIntelligence, motivatedSeller } = require('./acquisition');
const { valuation, arv } = require('./valuation');
const { wholesale } = require('./wholesale');
const { creativeFinance, subjectTo, sellerFinance } = require('./creativeFinance');
const { financing } = require('./finance');
const { titleIntelligence, transactionCoordinator } = require('./transaction');
const { disposition, buyerMatching } = require('./disposition');
const { risk, challenger } = require('./risk');

const legacyStatus = process.env.AGENTS_ENABLED === 'true' ? 'active' : 'flagged_off';
const legacy = (id, name, domain, capabilities, permissions, risk_level) => registry.declare({
  id, name, domain, version: '1.0.0', capabilities, required_inputs: ['lead_memory'], outputs: [`${id}_verdict`],
  tools: ['agents/agentRuntime'], knowledge_sources: ['lead memory', 'agent spine'], permissions, risk_level,
  handoff_agents: [], jurisdiction_aware: domain === 'compliance', last_knowledge_update: H.KNOWLEDGE_DATE, status: legacyStatus,
});
legacy('legacy_acquisition', 'Acquisition Agent (original)', 'acquisition', ['seller_conversation', 'fact_capture'], 'EXECUTE', 'high');
legacy('legacy_underwriting', 'Underwriting Agent (original)', 'underwriting', ['arv_range', 'mao'], 'RECOMMEND', 'medium');
legacy('legacy_disposition', 'Disposition Agent (original)', 'disposition', ['deal_package', 'buyer_outreach'], 'EXECUTE', 'medium');
legacy('compliance_spine', 'Compliance Agent (shared spine)', 'compliance', ['tcpa_gate', 'dnc_gate', 'structure_gate'], 'HIGH_RISK', 'high');
legacy('legacy_follow_up', 'Follow-Up Agent (original)', 'acquisition', ['follow_up_cadence'], 'EXECUTE', 'medium');
legacy('legacy_buyer_match', 'Buyer Match Agent (original)', 'disposition', ['buyer_ranking'], 'RECOMMEND', 'low');
legacy('legacy_title', 'Title / Transaction Coordination Agent (original)', 'title', ['title_status'], 'RECOMMEND', 'medium');
legacy('legacy_ops', 'Ops / Prediction Agent (original)', 'operations', ['pipeline_prediction'], 'READ', 'low');

const AGENTS = Object.fromEntries([
  leadIntelligence, motivatedSeller, valuation, arv, wholesale, creativeFinance, subjectTo, sellerFinance,
  financing, titleIntelligence, transactionCoordinator, disposition, buyerMatching, risk, challenger,
].map(a => [a.id, a]));

const handoffProblems = registry.validateHandoffs();
if (handoffProblems.length) throw new Error(`Agent registry handoff errors: ${handoffProblems.join('; ')}`);

module.exports = { AGENTS };
