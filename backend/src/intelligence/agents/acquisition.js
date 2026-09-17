// ─── Acquisition domain: LeadIntelligenceAgent, MotivatedSellerAgent ────────

const { defineAgent } = require('../agentKit');
const { claim, STATUS } = require('../provenance');
const H = require('./_shared');

const leadIntelligence = defineAgent({
  declaration: {
    id: 'lead_intelligence', name: 'Lead Intelligence Agent', domain: 'acquisition', version: '1.0.0',
    capabilities: ['lead_profile', 'contactability', 'outreach_strategy'],
    required_inputs: ['deal_understanding'], outputs: ['lead_profile'],
    tools: ['deal_graph.read', 'connectors.property_record'], knowledge_sources: ['lead record', 'provider property record', 'call analysis'],
    permissions: 'RECOMMEND', risk_level: 'low', handoff_agents: ['motivated_seller', 'valuation'],
    jurisdiction_aware: false, last_knowledge_update: H.KNOWLEDGE_DATE,
  },
  async analyze({ understanding: rep }) {
    const profilePaths = ['property.address', 'property.property_type', 'property.sqft', 'property.bedrooms', 'property.occupancy', 'property.ownership.owner_names', 'people.seller.name', 'people.seller.motivation_score', 'financial.as_is_value', 'property.financing.loan_balance'];
    const findings = profilePaths.filter(p => H.known(rep, p)).map(p => H.finding(p, H.c(rep, p)));
    const signals = ['property.distress.probate', 'property.distress.foreclosure_stage', 'property.distress.vacant', 'property.distress.absentee_owner', 'property.liens.tax_owed', 'property.distress.signals']
      .filter(p => H.known(rep, p) && H.val(rep, p) !== false).map(p => H.finding(`motivation signal: ${p.split('.').pop()}`, H.c(rep, p)));

    const phone = H.val(rep, 'people.seller.phone_on_file') === true;
    const consent = H.val(rep, 'people.seller.consent_to_text') === true;
    const recommendations = [];
    if (!phone) {
      recommendations.push({ action: 'Skip trace the owner to get a phone number', why: 'No phone number is on file, so the seller cannot be called or texted.', urgency: 'high', impact: 'Makes the lead contactable', assigned_to: 'operator' });
    } else if (consent) {
      recommendations.push({ action: 'Open with a text, then call within local calling hours', why: 'The seller has text consent on file and a phone number.', urgency: 'medium', impact: 'Fastest first contact', action_type: 'send_sms', assigned_to: 'operator' });
    } else {
      recommendations.push({ action: 'Call within local calling hours; do not text', why: 'A phone number is on file but there is no record of consent to receive automated texts.', urgency: 'medium', impact: 'Compliant first contact', action_type: 'place_call', assigned_to: 'operator' });
    }
    const missing = H.missingFrom(rep, ['property.sqft', 'property.bedrooms', 'property.condition', 'people.seller.timeline_days', 'transaction.asking_price', 'property.financing.loan_balance']);
    const conf = H.evidenceConfidence(rep, profilePaths);
    return {
      status: findings.length < 3 ? 'insufficient_data' : 'complete',
      summary: `${findings.length} of ${profilePaths.length} profile facts known; ${signals.length} motivation signal(s) on record. ${phone ? (consent ? 'Phone and text consent on file.' : 'Phone on file, no text consent.') : 'No phone on file.'}`,
      findings: [...findings, ...signals], recommendations, missing,
      confidence: conf, sources: H.sourcesOf(rep, profilePaths),
      handoffs: ['motivated_seller', 'valuation'],
      data: { contactable: phone, text_consent: consent, signal_count: signals.length },
    };
  },
});

// PMI (Probability of Motivation Index): deterministic weights over documented
// property/financial evidence only - never protected characteristics or proxies.
const PMI_WEIGHTS = [
  { key: 'foreclosure', label: 'Foreclosure / lis pendens', points: 25, test: (rep) => !!H.val(rep, 'property.distress.foreclosure_stage') || H.val(rep, 'property.liens.lis_pendens') === true, paths: ['property.distress.foreclosure_stage', 'property.liens.lis_pendens'] },
  { key: 'probate', label: 'Probate / estate', points: 20, test: (rep) => H.val(rep, 'property.distress.probate') === true, paths: ['property.distress.probate'] },
  { key: 'tax_delinquent', label: 'Tax delinquency (2+ years or taxes owed)', points: 15, test: (rep) => Number(H.val(rep, 'property.liens.years_tax_delinquent')) >= 2 || Number(H.val(rep, 'property.liens.tax_owed')) > 0, paths: ['property.liens.years_tax_delinquent', 'property.liens.tax_owed'] },
  { key: 'short_timeline', label: 'Seller timeline 30 days or less', points: 12, test: (rep) => { const d = H.val(rep, 'people.seller.timeline_days'); return d != null && Number(d) <= 30; }, paths: ['people.seller.timeline_days'] },
  { key: 'vacant', label: 'Vacant property', points: 10, test: (rep) => H.val(rep, 'property.distress.vacant') === true || H.val(rep, 'property.occupancy') === 'vacant', paths: ['property.distress.vacant', 'property.occupancy'] },
  { key: 'high_equity', label: 'High equity (50%+ of value)', points: 10, test: (rep) => { const e = H.val(rep, 'financial.equity'); const v = H.val(rep, 'financial.as_is_value'); return e != null && v > 0 && e / v >= 0.5; }, paths: ['financial.equity', 'financial.as_is_value'] },
  { key: 'absentee', label: 'Absentee owner', points: 8, test: (rep) => H.val(rep, 'property.distress.absentee_owner') === true || H.val(rep, 'property.occupancy') === 'absentee_owner', paths: ['property.distress.absentee_owner'] },
  { key: 'long_ownership', label: 'Owned 10+ years', points: 5, test: (rep) => Number(H.val(rep, 'property.ownership.years_owned')) >= 10, paths: ['property.ownership.years_owned'] },
];

const motivatedSeller = defineAgent({
  declaration: {
    id: 'motivated_seller', name: 'Motivated Seller Agent', domain: 'acquisition', version: '1.0.0',
    capabilities: ['pmi_score', 'motivation_drivers', 'outreach_channel'],
    required_inputs: ['deal_understanding'], outputs: ['motivation_assessment'],
    tools: ['deal_graph.read'], knowledge_sources: ['lead record', 'call analysis', 'provider property record'],
    permissions: 'RECOMMEND', risk_level: 'medium', handoff_agents: [],
    jurisdiction_aware: false, last_knowledge_update: H.KNOWLEDGE_DATE,
  },
  async analyze({ understanding: rep }) {
    const drivers = [];
    let points = 0;
    const evidencePaths = [];
    for (const w of PMI_WEIGHTS) {
      evidencePaths.push(...w.paths);
      if (w.test(rep)) {
        points += w.points;
        const strongestEv = H.strongest(rep, w.paths);
        drivers.push({ driver: w.label, points: w.points, evidence: strongestEv ? { field: strongestEv.path, value: strongestEv.claim.value, status: strongestEv.claim.status, source: strongestEv.claim.source } : null });
      }
    }
    const callScore = H.c(rep, 'people.seller.motivation_score');
    let callPoints = 0;
    if (callScore.status !== STATUS.UNKNOWN) {
      callPoints = Math.round(Math.max(0, Math.min(100, Number(callScore.value))) * 0.25);
      drivers.push({ driver: 'Seller conversation (AI call analysis)', points: callPoints, evidence: { field: 'people.seller.motivation_score', value: callScore.value, status: callScore.status, source: callScore.source } });
    }
    const pmi = Math.min(100, points + callPoints);
    const knownEvidence = [...new Set(evidencePaths)].filter(p => H.known(rep, p)).length;
    const totalEvidence = new Set(evidencePaths).size;
    const verifiedDrivers = drivers.filter(d => d.evidence && ['VERIFIED', 'USER_PROVIDED'].includes(d.evidence.status)).length;
    const confidenceScore = Math.round(20 + 50 * (knownEvidence / totalEvidence) + (drivers.length ? 20 * (verifiedDrivers / drivers.length) : 0));
    const pmiClaim = claim(pmi, STATUS.INFERRED, { source: 'PMI weights v1', basis: drivers.map(d => `${d.driver} +${d.points}`).join('; ') || 'no drivers on record' });

    const top = [...drivers].sort((a, b) => b.points - a.points)[0];
    const approach = !top ? 'No documented distress: lead with a low-pressure, value-first introduction.'
      : /Probate/.test(top.driver) ? 'Estate situation: acknowledge the family\'s situation, no urgency, offer to handle clean-out and paperwork timing.'
      : /Foreclosure/.test(top.driver) ? 'Pre-foreclosure: be factual about timelines, present options (sale, reinstatement help, creative terms); never threaten or exaggerate.'
      : /Tax/.test(top.driver) ? 'Tax delinquency: position a sale as a clean way to settle the tax balance before penalties grow.'
      : /timeline/.test(top.driver) ? 'Short timeline: lead with speed and certainty of closing.'
      : 'Lead with simplicity: as-is sale, flexible closing date, no repairs.';
    return {
      summary: `PMI ${pmi}/100 from ${drivers.length} documented driver(s). ${knownEvidence}/${totalEvidence} evidence fields are on record.`,
      findings: [H.finding('PMI score', pmiClaim), ...drivers.map(d => H.finding(`driver: ${d.driver}`, claim(d.points, STATUS.CALCULATED, { source: d.evidence?.source || null, basis: d.evidence ? `${d.evidence.field} = ${JSON.stringify(d.evidence.value)} (${d.evidence.status})` : null })))],
      recommendations: [{ action: approach, why: top ? `Strongest documented driver: ${top.driver}.` : 'No distress evidence on record.', urgency: pmi >= 60 ? 'high' : 'medium', impact: 'Sets the tone of first contact', assigned_to: 'operator' }],
      missing: H.missingFrom(rep, ['people.seller.timeline_days', 'property.financing.loan_balance', 'people.seller.objectives']),
      confidence: { score: Math.min(95, confidenceScore), reasoning: `${knownEvidence} of ${totalEvidence} motivation evidence fields are known; ${verifiedDrivers} of ${drivers.length} drivers rest on verified or operator-provided evidence. Score uses property and financial signals only.` },
      sources: H.sourcesOf(rep, [...new Set(evidencePaths)]),
      positions: { 'motivation.pmi': pmi },
      data: { pmi, drivers, weights: PMI_WEIGHTS.map(w => ({ key: w.key, label: w.label, points: w.points })) },
    };
  },
});

module.exports = { leadIntelligence, motivatedSeller, PMI_WEIGHTS };
