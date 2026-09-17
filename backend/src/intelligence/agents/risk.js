// ─── RiskAgent and ChallengerAgent ───────────────────────────────────────────
// Risk consolidates a scored risk register from the deal and every other agent.
// Challenger argues against each recommendation before it reaches the operator.

const { defineAgent } = require('../agentKit');
const { claim, STATUS } = require('../provenance');
const llm = require('../llm');
const H = require('./_shared');

const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };
const CATEGORIES = ['financial', 'market', 'legal', 'construction', 'financing', 'liquidity', 'exit', 'title', 'operational', 'valuation', 'timeline', 'compliance'];

const risk = defineAgent({
  declaration: {
    id: 'risk', name: 'Risk Agent', domain: 'underwriting', version: '1.0.0',
    capabilities: ['risk_register', 'risk_scoring'],
    required_inputs: ['deal_understanding', 'agent_outputs'], outputs: ['risk_register'],
    tools: ['deal_graph.read'], knowledge_sources: ['deal understanding', 'all agent outputs'],
    permissions: 'RECOMMEND', risk_level: 'medium', handoff_agents: [], jurisdiction_aware: false, last_knowledge_update: H.KNOWLEDGE_DATE,
  },
  async analyze(ctx) {
    const rep = ctx.understanding;
    const register = [];
    const seen = new Set();
    const add = (r, from) => {
      const key = `${r.category}|${String(r.risk).slice(0, 80).toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      register.push({ ...r, category: CATEGORIES.includes(r.category) ? r.category : 'operational', identified_by: from });
    };
    for (const [agentId, out] of Object.entries(ctx.priorOutputs || {})) {
      for (const r of out.risks || []) add(r, agentId);
    }
    // Deal-level risks not owned by a specialist.
    const unknownCount = (rep.unknowns || []).length;
    if (unknownCount >= 10) add({ risk: `${unknownCount} material facts are unknown; decisions rest on incomplete information.`, severity: 'medium', category: 'operational', mitigation: 'Work through the missing-information list, starting with value, repairs and debt.' }, 'risk');
    if ((rep.conflicts || []).length) add({ risk: `${rep.conflicts.length} data conflict(s) between sources.`, severity: 'medium', category: 'valuation', mitigation: 'Resolve conflicts shown in the Deal Room before relying on those numbers.' }, 'risk');
    if ((rep.data_gaps || []).length) add({ risk: `Data provider unavailable: ${rep.data_gaps.map(g => g.reason).join('; ')}`, severity: 'medium', category: 'market', mitigation: 'Restore the data connection or supply the figures manually.' }, 'risk');
    if (H.val(rep, 'people.seller.consent_to_text') !== true) add({ risk: 'No record of consent to receive automated texts from this seller.', severity: 'medium', category: 'compliance', mitigation: 'Use calls within calling hours or obtain written consent before texting.' }, 'risk');
    const dom = Number(H.val(rep, 'property.market.median_days_on_market'));
    if (dom > 90) add({ risk: `Median days on market in the zip is ${dom}; resale may be slow.`, severity: 'medium', category: 'liquidity', mitigation: 'Price the exit conservatively and budget extra holding months.' }, 'risk');
    register.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
    const counts = register.reduce((m, r) => { m[r.severity] = (m[r.severity] || 0) + 1; return m; }, {});
    const byCategory = register.reduce((m, r) => { m[r.category] = (m[r.category] || 0) + 1; return m; }, {});
    const top = register[0];
    return {
      summary: register.length ? `${register.length} risk(s): ${['critical', 'high', 'medium', 'low'].filter(s => counts[s]).map(s => `${counts[s]} ${s}`).join(', ')}. Biggest: ${top.risk}` : 'No risks identified from available data - which is not the same as no risk.',
      findings: [H.finding('risk count', claim(register.length, STATUS.CALCULATED, { source: 'risk register' }))],
      risks: register,
      recommendations: top ? [{ action: top.mitigation || `Address: ${top.risk}`, why: `Highest-severity risk (${top.severity}, ${top.category}).`, urgency: top.severity === 'critical' ? 'critical' : top.severity === 'high' ? 'high' : 'medium', impact: 'Reduces the chance the deal fails', assigned_to: 'operator' }] : [],
      confidence: { score: Math.max(20, 70 - Math.min(40, unknownCount * 2)), reasoning: `Register combines ${Object.keys(ctx.priorOutputs || {}).length} agent analyses; ${unknownCount} unknown facts may hide further risks.` },
      data: { register, counts, by_category: byCategory },
    };
  },
});

// Deterministic challenges: every recommendation is questioned on the evidence behind it.
function deterministicChallenges(ctx) {
  const rep = ctx.understanding;
  const outs = ctx.priorOutputs || {};
  const challenges = [];
  const push = (target, question, evidence, severity = 'medium') => challenges.push({ target, question, evidence, severity });
  const arvOut = outs.arv?.data;
  if (outs.wholesale?.data?.mao != null) {
    if (!arvOut || arvOut.status !== STATUS.CALCULATED) push('wholesale', 'Why trust this MAO when the ARV is not backed by sold comparables?', `ARV status: ${arvOut?.status || 'from record'}; ${(rep.comparables || []).filter(c => c.price_type === 'sold').length} sold comps on file.`, 'high');
    if (!H.known(rep, 'property.condition')) push('wholesale', 'What if repairs are much higher than estimated? Condition has not been confirmed.', 'property.condition is unknown.', 'high');
  }
  if (outs.valuation?.data?.basis === 'listing prices') push('valuation', 'Listing prices are asking prices - what did comparable homes actually sell for?', 'Only listings are on file.', 'high');
  const title = outs.title_intelligence?.data;
  if (title && !title.title_file_open) push('all', 'Why proceed toward contract before a title search? Unknown liens can erase the spread.', 'No title file open.', 'high');
  if (outs.buyer_matching?.data && outs.buyer_matching.data.total_matches === 0) push('disposition', 'Who buys this if no buyer on your list fits?', 'Zero buyer matches.', 'high');
  if (outs.financing && !(outs.financing.data?.ranked_by_cost || []).length) push('financing', 'Financing cost is unpriced - does the deal still work at today\'s rates?', 'No lender terms supplied.', 'medium');
  if (outs.subject_to?.data?.viable_on_numbers) push('subject_to', 'What happens if the lender calls the loan due?', 'Due-on-sale clause risk; exit plan not documented.', 'high');
  if (outs.seller_finance?.data?.illustrative) push('seller_finance', 'Would the seller actually accept these terms? They are illustrative.', 'No seller-agreed terms on record.', 'medium');
  const pmi = outs.motivated_seller?.data?.pmi;
  if (pmi != null && pmi >= 60 && outs.motivated_seller.confidence.score < 50) push('motivated_seller', 'Is the seller really motivated, or is the score built on unverified list data?', `PMI ${pmi} with confidence ${outs.motivated_seller.confidence.score}.`, 'medium');
  const disagreements = ctx.disagreements || [];
  for (const d of disagreements) push('all', `Agents disagree on ${d.key} by ${d.spread_pct}% - which figure is right?`, d.positions.map(p => `${p.agent}: ${H.money(p.value)}`).join('; '), d.material ? 'high' : 'medium');
  return challenges;
}

const challenger = defineAgent({
  declaration: {
    id: 'challenger', name: 'Challenger Agent', domain: 'system', version: '1.0.0',
    capabilities: ['adversarial_review', 'assumption_testing'],
    required_inputs: ['agent_outputs'], outputs: ['challenges'],
    tools: ['deal_graph.read', 'llm.reasoning'], knowledge_sources: ['all agent outputs', 'deal understanding'],
    permissions: 'READ', risk_level: 'low', handoff_agents: [], jurisdiction_aware: false, last_knowledge_update: H.KNOWLEDGE_DATE,
  },
  timeoutMs: 20000,
  async analyze(ctx) {
    const challenges = deterministicChallenges(ctx);
    let modelChallenges = [];
    let modelNote = null;
    const recs = Object.entries(ctx.priorOutputs || {}).flatMap(([a, o]) => (o.recommendations || []).map(r => ({ agent: a, action: r.action, why: r.why })));
    if (recs.length && ctx.useModel !== false) {
      const res = await llm.json({
        agentId: 'challenger',
        rolePrompt: 'You are the Challenger. Your only job is to argue against the recommendations below: find bad assumptions, hidden costs, weak evidence, financing, exit, legal, market and construction problems. Use only the facts given. Do not invent facts or numbers.',
        facts: {
          recommendations: recs.slice(0, 12),
          evidence_status: Object.fromEntries(['financial.arv', 'financial.repairs', 'financial.as_is_value', 'property.condition', 'property.financing.loan_balance', 'transaction.asking_price'].map(p => [p, H.c(ctx.understanding, p).status])),
          unknown_count: (ctx.understanding.unknowns || []).length,
          existing_challenges: challenges.map(c => c.question),
        },
        task: 'Add up to 4 NEW challenges not already listed. Each must point to a specific recommendation and the missing or weak evidence.',
        schema: '{"challenges":[{"target":"agent id or all","question":"one sentence","evidence":"what in the facts supports raising it","severity":"low|medium|high"}]}',
        maxTokens: 700,
      });
      if (res.ok && Array.isArray(res.data.challenges)) {
        modelChallenges = res.data.challenges.slice(0, 4).filter(c => c && c.question).map(c => ({ target: String(c.target || 'all'), question: String(c.question).slice(0, 300), evidence: String(c.evidence || '').slice(0, 300), severity: ['low', 'medium', 'high'].includes(c.severity) ? c.severity : 'medium', origin: 'model (INFERRED)' }));
      } else if (!res.ok) modelNote = `Model review unavailable: ${res.error}`;
    }
    const all = [...challenges.map(c => ({ ...c, origin: 'rule' })), ...modelChallenges];
    const high = all.filter(c => c.severity === 'high').length;
    return {
      summary: all.length ? `${all.length} challenge(s), ${high} high. Strongest: ${all.find(c => c.severity === 'high')?.question || all[0].question}` : 'No challenges raised from available outputs.',
      findings: all.map(c => H.finding(`challenge (${c.target})`, claim(c.question, c.origin === 'rule' ? STATUS.INFERRED : STATUS.INFERRED, { basis: c.evidence, source: c.origin }))),
      risks: all.filter(c => c.severity === 'high').map(c => ({ risk: c.question, severity: 'high', category: 'operational', evidence: c.evidence, mitigation: 'Answer this before acting on the recommendation.' })),
      confidence: { score: 60, reasoning: `${challenges.length} rule-based challenge(s) tied to evidence${modelChallenges.length ? ` and ${modelChallenges.length} model-raised (inferred)` : ''}.${modelNote ? ` ${modelNote}` : ''}` },
      data: { challenges: all, recommendations_reviewed: recs.length },
    };
  },
});

module.exports = { risk, challenger, deterministicChallenges, SEVERITY_RANK };
