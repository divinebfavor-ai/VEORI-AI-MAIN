// ─── Title / transaction domain: TitleIntelligenceAgent, TransactionCoordinatorAgent ─

const { defineAgent } = require('../agentKit');
const { claim, STATUS } = require('../provenance');
const H = require('./_shared');

const titleIntelligence = defineAgent({
  declaration: {
    id: 'title_intelligence', name: 'Title Intelligence Agent', domain: 'title', version: '1.0.0',
    capabilities: ['title_red_flags', 'lien_indicators', 'ownership_check'],
    required_inputs: ['deal_understanding'], outputs: ['title_assessment'],
    tools: ['deal_graph.read'], knowledge_sources: ['lead distress data', 'provider owner record', 'title logs'],
    permissions: 'RECOMMEND', risk_level: 'high', handoff_agents: [], jurisdiction_aware: true, last_knowledge_update: H.KNOWLEDGE_DATE,
  },
  async analyze({ understanding: rep }) {
    const risks = [];
    const flags = [];
    const add = (flag, severity, category, mitigation, evidencePath) => {
      flags.push(H.finding(flag, H.c(rep, evidencePath)));
      risks.push({ risk: flag, severity, category, mitigation, evidence: evidencePath });
    };
    if (H.val(rep, 'property.distress.probate') === true) add('Probate indicated: the heirs or estate representative must have authority to sell, often needing court approval.', 'high', 'title', 'Confirm the personal representative\'s letters and whether court approval is required; involve a probate attorney.', 'property.distress.probate');
    if (H.val(rep, 'property.distress.foreclosure_stage') || H.val(rep, 'property.liens.lis_pendens') === true) add('Foreclosure / lis pendens recorded: the lender\'s claim and any sale date must be resolved at closing.', 'critical', 'title', 'Order title immediately and get a payoff or reinstatement figure and the sale date.', H.known(rep, 'property.distress.foreclosure_stage') ? 'property.distress.foreclosure_stage' : 'property.liens.lis_pendens');
    if (Number(H.val(rep, 'property.liens.tax_owed')) > 0) add(`Delinquent taxes of ${H.money(H.val(rep, 'property.liens.tax_owed'))} on record must be paid at closing.`, 'medium', 'title', 'Confirm the payoff with the county tax collector.', 'property.liens.tax_owed');
    const owners = H.val(rep, 'property.ownership.owner_names');
    const seller = H.val(rep, 'people.seller.name');
    if (Array.isArray(owners) && owners.length && seller) {
      const norm = (s) => String(s).toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(w => w.length > 1);
      const sellerWords = new Set(norm(seller));
      const match = owners.some(o => norm(o).some(w => sellerWords.has(w)));
      if (!match) add('The person you are dealing with does not appear in the owner names on record.', 'high', 'title', 'Confirm authority to sell (deed, power of attorney, entity documents) before contracting.', 'property.ownership.owner_names');
    }
    if (H.val(rep, 'property.ownership.owner_type') === 'Organization') add('Owned by an entity: the signer needs documented authority (operating agreement or resolution).', 'medium', 'title', 'Request entity documents and signer authority.', 'property.ownership.owner_type');

    const titleOrdered = Array.isArray(H.val(rep, 'transaction.title'));
    return {
      summary: `${flags.length} title red flag(s) found in available data. Title cannot be confirmed clear without a title report${titleOrdered ? ' - a title file is open' : ' - none on file'}.`,
      findings: [...flags, H.finding('Title status', claim(titleOrdered ? 'title file open, not confirmed clear' : 'not confirmed clear', STATUS.UNVERIFIED, { source: 'title_logs' }))],
      risks,
      recommendations: [{ action: titleOrdered ? 'Get the preliminary title report / commitment and review exceptions' : 'Order a preliminary title report', why: 'Only a title search confirms liens, judgments and ownership; public data here is incomplete.', urgency: flags.some(f => /Foreclosure|lis pendens/.test(f.label)) ? 'critical' : 'high', impact: 'Finds problems before earnest money goes hard', assigned_to: 'operator' }],
      missing: [H.missingItem('property.liens.summary'), ...(!H.known(rep, 'property.parcel_id') ? [H.missingItem('property.parcel_id')] : []), ...(!H.known(rep, 'property.ownership.owner_names') ? [H.missingItem('property.ownership.owner_names')] : [])],
      confidence: { score: 30, reasoning: 'Title indicators come from lead and provider data, not a title search; absence of flags does not mean title is clear.' },
      attorney_review: flags.length > 0,
      data: { flag_count: flags.length, title_file_open: titleOrdered },
    };
  },
});

const DAY = 86400000;
const transactionCoordinator = defineAgent({
  declaration: {
    id: 'transaction_coordinator', name: 'Transaction Coordinator Agent', domain: 'transaction', version: '1.0.0',
    capabilities: ['deadline_tracking', 'document_status', 'closing_readiness'],
    required_inputs: ['deal_understanding'], outputs: ['transaction_status'],
    tools: ['deal_graph.read'], knowledge_sources: ['deal record', 'contracts', 'title logs', 'follow-ups'],
    permissions: 'RECOMMEND', risk_level: 'medium', handoff_agents: [], jurisdiction_aware: false, last_knowledge_update: H.KNOWLEDGE_DATE,
  },
  async analyze({ understanding: rep, now = Date.now() }) {
    const stage = H.val(rep, 'transaction.stage');
    const closing = H.val(rep, 'transaction.closing_date');
    const contracts = H.val(rep, 'transaction.contracts') || [];
    const title = H.val(rep, 'transaction.title');
    const emdStatus = H.val(rep, 'transaction.emd.status');
    const buyer = H.val(rep, 'people.buyer.id');
    const checklist = [
      { item: 'Purchase agreement signed', done: contracts.some(c => c.status === 'fully_signed' || c.signed_at) },
      { item: 'Title opened', done: Array.isArray(title) && title.length > 0 },
      { item: 'Earnest money received', done: ['received', 'deposited'].includes(emdStatus) },
      { item: 'End buyer assigned', done: !!buyer },
      { item: 'Closing date set', done: !!closing },
    ];
    const alerts = [];
    let daysToClose = null;
    if (closing) {
      daysToClose = Math.ceil((new Date(closing).getTime() - now) / DAY);
      if (daysToClose < 0 && !['closed', 'lost'].includes(stage)) alerts.push({ risk: `Closing date passed ${Math.abs(daysToClose)} day(s) ago and the deal is not closed.`, severity: 'critical', category: 'timeline', mitigation: 'Extend the contract in writing or close.' });
      else if (daysToClose <= 7) {
        for (const c of checklist.filter(x => !x.done)) alerts.push({ risk: `${c.item} is not done with ${daysToClose} day(s) to closing.`, severity: daysToClose <= 3 ? 'critical' : 'high', category: 'timeline', mitigation: `Complete: ${c.item.toLowerCase()}.` });
      }
    } else if (['under_contract', 'sent_to_title', 'closing_prep'].includes(stage)) {
      alerts.push({ risk: 'Deal is under contract with no closing date on record.', severity: 'high', category: 'timeline', mitigation: 'Enter the closing date from the purchase agreement.' });
    }
    const open = checklist.filter(c => !c.done);
    return {
      summary: `${checklist.length - open.length}/${checklist.length} closing items done${daysToClose != null ? `; ${daysToClose} day(s) to closing` : ''}; ${alerts.length} alert(s).`,
      findings: checklist.map(c => H.finding(c.item, claim(c.done, STATUS.VERIFIED, { source: 'deal records' }))),
      risks: alerts,
      recommendations: open.slice(0, 3).map((c, i) => ({ action: c.item.replace(/ signed| opened| received| assigned| set/, (m) => ` - get it ${m.trim()}`), why: 'Required before closing.', urgency: alerts.length ? 'high' : i === 0 ? 'medium' : 'low', impact: 'Keeps the closing on schedule', assigned_to: 'operator' })),
      confidence: { score: 80, reasoning: 'Checklist reads the deal, contract, title and EMD records directly; items tracked outside Veori are not visible.' },
      data: { checklist, days_to_close: daysToClose, stage },
    };
  },
});

module.exports = { titleIntelligence, transactionCoordinator };
