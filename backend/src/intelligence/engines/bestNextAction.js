// ─── Best Next Action ───────────────────────────────────────────────────────
// One specific, evidence-backed next step for a deal - never a generic task.
// Deterministic priority:
//   1. A decision already waiting on the operator (pending approval)
//   2. A critical risk (e.g. foreclosure sale date, closing passed)
//   3. A missing fact that blocks the deal's current stage
//   4. The most urgent agent recommendation
//   5. The stage's natural next step

const { STATUS } = require('../provenance');
const { getPath } = require('../dealGraph');

const URGENCY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };

// Facts each stage can't progress without, most important first.
const STAGE_BLOCKERS = {
  lead: ['people.seller.name', 'transaction.asking_price', 'property.condition'],
  contacted: ['transaction.asking_price', 'property.condition', 'people.seller.timeline_days'],
  offer_sent: ['financial.arv', 'financial.repairs'],
  negotiating: ['financial.arv', 'financial.repairs', 'property.financing.loan_balance'],
  under_contract: ['property.liens.summary', 'transaction.closing_date', 'transaction.buyer_price'],
  sent_to_title: ['property.liens.summary', 'transaction.closing_date'],
  closing_prep: ['transaction.closing_date'],
};

const STAGE_DEFAULTS = {
  lead: { action: 'Make first contact with the seller', why: 'The deal has not been contacted yet.', impact: 'Starts the conversation that everything else depends on' },
  contacted: { action: 'Get the seller\'s price, timeline and property condition', why: 'Those three facts decide whether and how to offer.', impact: 'Enables an offer' },
  offer_sent: { action: 'Follow up on the offer', why: 'An offer is out without a response on record.', impact: 'Moves the deal toward contract' },
  negotiating: { action: 'Close the gap between the seller\'s price and your maximum offer', why: 'The deal is in negotiation.', impact: 'Gets to contract' },
  under_contract: { action: 'Open title and line up the end buyer', why: 'Under contract; title and disposition run in parallel.', impact: 'Keeps the closing date' },
  sent_to_title: { action: 'Confirm title commitment and buyer funds', why: 'The file is at title.', impact: 'Clears the path to closing' },
  closing_prep: { action: 'Confirm closing appointment, funds and documents', why: 'Closing is being prepared.', impact: 'Closes the deal' },
};

function isUnknown(rep, path) {
  const c = getPath(rep, path);
  return !c || c.status === STATUS.UNKNOWN;
}

function compute({ understanding: rep, outputs = {}, pendingApprovals = [], stage = null }) {
  const st = stage || getPath(rep, 'transaction.stage')?.value || 'lead';

  if (pendingApprovals.length) {
    const a = pendingApprovals[0];
    return {
      action: `Review and decide: ${a.reason}`, why: `${a.agent_id} is waiting for your approval (${a.action_type.replace(/_/g, ' ')}).`,
      urgency: 'high', impact: 'Nothing proceeds on this action until you decide', dependencies: [], assigned_to: 'operator', source_agent: a.agent_id,
    };
  }

  const risks = Object.values(outputs).flatMap(o => (o.risks || []).map(r => ({ ...r, agent: o.agent_id })));
  const critical = risks.find(r => r.severity === 'critical');
  if (critical) {
    return {
      action: critical.mitigation || `Resolve: ${critical.risk}`, why: critical.risk, urgency: 'critical',
      impact: 'Prevents the deal from failing on this issue', dependencies: [], assigned_to: 'operator', source_agent: critical.agent,
    };
  }

  const blockers = (STAGE_BLOCKERS[st] || []).filter(p => isUnknown(rep, p));
  if (blockers.length) {
    const u = (rep.unknowns || []).find(x => x.field === blockers[0]);
    return {
      action: u ? `Get ${blockers[0].split('.').pop().replace(/_/g, ' ')}: ${u.how_to_get}` : `Get ${blockers[0]}`,
      why: u ? u.why_it_matters : `Required at the ${st.replace(/_/g, ' ')} stage.`,
      urgency: ['under_contract', 'sent_to_title', 'closing_prep'].includes(st) ? 'high' : 'medium',
      impact: `Unblocks the ${st.replace(/_/g, ' ')} stage`, dependencies: blockers.slice(1), assigned_to: 'operator', source_agent: 'deal_understanding_engine',
    };
  }

  const recs = Object.values(outputs).flatMap(o => (o.recommendations || []).map(r => ({ ...r, agent: o.agent_id, conf: o.confidence?.score || 0 })))
    .sort((a, b) => (URGENCY_RANK[b.urgency] - URGENCY_RANK[a.urgency]) || (b.conf - a.conf));
  if (recs.length) {
    const r = recs[0];
    return { action: r.action, why: r.why, urgency: r.urgency, impact: r.impact || 'Advances the deal', dependencies: r.dependencies || [], assigned_to: r.assigned_to || 'operator', source_agent: r.agent, action_type: r.action_type || null };
  }

  const d = STAGE_DEFAULTS[st] || { action: 'Review the deal', why: 'No specific next step identified from available data.', impact: 'Keeps the deal moving' };
  return { ...d, urgency: 'low', dependencies: [], assigned_to: 'operator', source_agent: 'stage_default' };
}

module.exports = { compute, STAGE_BLOCKERS };
