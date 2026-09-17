// ─── Autopilot ──────────────────────────────────────────────────────────────
// Runs the deal workflow end to end inside the workspace's permission settings and
// records every step (what ran, what it found, what it did, or why it stopped) in
// autopilot_runs. It never moves money, signs, or submits an offer: those become
// approval requests. The only outbound action it can take is a seller follow-up
// text, and only when ALL of these hold:
//   workspace mode = autopilot AND auto_send_sms on (permissions.authorize)
//   AND the lead has recorded consent AND a phone AND is not on DNC
//   AND the compliance spine allows it (TCPA hours, internal/federal DNC, state)
//   AND no text went to or came from this lead in the last FOLLOW_UP_GAP_HOURS.
// Otherwise the message is kept as a draft for the operator with the reason.

const supabaseDefault = require('../../config/supabase');
const registry = require('../registry');
const audit = require('../audit');
const H = require('../agents/_shared');

const FOLLOW_UP_GAP_HOURS = Number(process.env.AUTOPILOT_FOLLOW_UP_GAP_HOURS) || 72;
const MIN_RUN_GAP_MINUTES = Number(process.env.AUTOPILOT_MIN_RUN_GAP_MINUTES) || 10;
const SWEEP_RUN_GAP_HOURS = Number(process.env.AUTOPILOT_SWEEP_GAP_HOURS) || 24;
const PRE_CONTRACT = ['lead', 'contacted', 'offer_sent', 'negotiating'];
const FOLLOW_UP_STAGES = ['contacted', 'offer_sent', 'negotiating'];

const DECL = registry.declare({
  id: 'autopilot', name: 'Autopilot', domain: 'operations', version: '1.0.0',
  capabilities: ['workflow_orchestration', 'seller_follow_up', 'approval_routing', 'contract_monitoring'],
  required_inputs: ['deal', 'agent_settings'], outputs: ['autopilot_run'],
  tools: ['super_agent.run', 'monitor.checkDeal', 'smsService.sendReply', 'complianceGate'],
  knowledge_sources: ['deal understanding', 'agent outputs', 'workspace settings'],
  permissions: 'EXECUTE', risk_level: 'high', handoff_agents: ['deal_death_prevention', 'deal_rescue', 'challenger'],
  jurisdiction_aware: true, last_knowledge_update: H.KNOWLEDGE_DATE,
});

function defaultDeps() {
  return {
    db: supabaseDefault,
    perms: require('../permissions'),
    superAgent: require('../superAgent'),
    monitor: require('./monitor'),
    compliance: require('../../agents/complianceGate'),
    sms: require('../../services/smsService'),
  };
}

const maskPhone = (p) => (p ? `***-***-${String(p).replace(/\D/g, '').slice(-4)}` : null);

function followUpText({ firstName, company, address }) {
  const greet = firstName ? `Hi ${firstName}` : 'Hi';
  return `${greet}, this is ${company} following up about ${address}. Are you still open to talking about your plans for the property? Reply STOP to opt out.`;
}

/**
 * Seller follow-up decision + send. Pure inputs via deps so it can be tested without sending.
 * @returns step object
 */
async function sellerFollowUp({ userId, deal, lead, settings, company, deps }) {
  const step = { step: 'seller_follow_up', label: 'Seller follow-up text' };
  if (!FOLLOW_UP_STAGES.includes(deal.status)) return { ...step, status: 'skipped', detail: `Not applicable at stage "${deal.status}".` };
  if (!lead) return { ...step, status: 'skipped', detail: 'Deal has no linked lead.' };
  if (!lead.phone) return { ...step, status: 'skipped', detail: 'Lead has no phone number.' };
  if (lead.is_on_dnc) return { ...step, status: 'blocked', detail: 'Lead is on the do-not-contact list.' };
  if (lead.consent !== true) return { ...step, status: 'blocked', detail: 'No recorded consent to text this lead.' };
  if (!company) return { ...step, status: 'skipped', detail: 'Add your company name in your profile - texts must identify the sender.' };
  const address = deal.property_address || lead.property_address;
  if (!address) return { ...step, status: 'skipped', detail: 'No property address to reference.' };

  const since = new Date(Date.now() - FOLLOW_UP_GAP_HOURS * 3600000).toISOString();
  const { data: recent, error } = await deps.db.from('sms_messages').select('direction, sent_at')
    .eq('user_id', userId).eq('lead_id', lead.id).gte('sent_at', since).limit(1);
  if (error) return { ...step, status: 'failed', detail: `Could not check message history: ${error.message}` };
  if (recent?.length) return { ...step, status: 'skipped', detail: `A text was exchanged with this lead in the last ${FOLLOW_UP_GAP_HOURS} hours.` };

  const body = followUpText({ firstName: lead.first_name, company, address });
  const decision = deps.perms.authorize({ agent: DECL, actionType: 'send_sms', settings });
  if (!decision.allowed || decision.requiresApproval) {
    return { ...step, status: 'drafted', detail: `Draft kept for you: ${decision.reason}.`, draft: { to: maskPhone(lead.phone), body } };
  }
  const gate = await deps.compliance.complianceGate({ type: 'send_sms', channel: 'sms', lead, phone: lead.phone, stateCode: lead.property_state });
  if (!gate.allowed) {
    return { ...step, status: 'blocked', detail: `Compliance stopped the text: ${gate.hardStops.map(s => s.detail).join(' ')}`, draft: { to: maskPhone(lead.phone), body } };
  }
  if (gate.requiredDisclosures?.length) {
    return { ...step, status: 'drafted', detail: 'This state requires a disclosure in outreach - review and send it yourself.', draft: { to: maskPhone(lead.phone), body }, disclosures: gate.requiredDisclosures };
  }
  const msgId = await deps.sms.sendReply(lead.phone, body, userId, lead.id);
  if (!msgId) return { ...step, status: 'failed', detail: 'The SMS provider did not send the message (provider not configured, DNC, or no outreach credits).', draft: { to: maskPhone(lead.phone), body } };
  await audit.record({ userId, dealId: deal.id, agentId: 'autopilot', actionType: 'autopilot.sms_sent', inputs: { lead_id: lead.id, to: maskPhone(lead.phone) }, outputs: { message_id: msgId }, humanApproved: false });
  return { ...step, status: 'done', detail: `Follow-up text sent to ${maskPhone(lead.phone)}.`, warnings: (gate.warnings || []).map(w => w.detail) };
}

/**
 * @param {object} p
 * @param {'operator'|'sweep'} p.triggeredBy
 */
async function run({ userId, actorUserId = null, dealId, triggeredBy = 'operator', useModel = true, deps: overrides = {} }) {
  const deps = { ...defaultDeps(), ...overrides };
  const { db } = deps;
  const settings = await deps.perms.getSettings(userId);
  if (settings.mode !== 'autopilot') throw Object.assign(new Error('Autopilot is off for this workspace. Switch to Autopilot in Deal Room settings first.'), { status: 409 });

  const { data: deal, error: dErr } = await db.from('deals')
    .select('id, user_id, lead_id, status, property_address, last_autopilot_at').eq('id', dealId).eq('user_id', userId).maybeSingle();
  if (dErr) throw dErr;
  if (!deal) throw Object.assign(new Error('Deal not found'), { status: 404 });
  if (['closed', 'lost'].includes(deal.status)) throw Object.assign(new Error(`Autopilot does not run on ${deal.status} deals.`), { status: 409 });

  // Claim: one run per deal per MIN_RUN_GAP_MINUTES, across servers.
  const gapCutoff = new Date(Date.now() - MIN_RUN_GAP_MINUTES * 60000).toISOString();
  if (deal.last_autopilot_at && deal.last_autopilot_at > gapCutoff) {
    throw Object.assign(new Error(`Autopilot ran on this deal less than ${MIN_RUN_GAP_MINUTES} minutes ago.`), { status: 429 });
  }
  let claim = db.from('deals').update({ last_autopilot_at: new Date().toISOString() }).eq('id', dealId).eq('user_id', userId);
  claim = deal.last_autopilot_at ? claim.eq('last_autopilot_at', deal.last_autopilot_at) : claim.is('last_autopilot_at', null);
  const { data: claimed, error: cErr } = await claim.select('id');
  if (cErr) throw cErr;
  if (!claimed?.length) throw Object.assign(new Error('Autopilot is already running on this deal.'), { status: 409 });

  const { data: runRow, error: rErr } = await db.from('autopilot_runs').insert({ user_id: userId, deal_id: dealId, triggered_by: triggeredBy, actor_user_id: actorUserId, steps: [], status: 'running' }).select('id').single();
  if (rErr) throw rErr;
  const steps = [];
  const save = (status) => db.from('autopilot_runs').update({ steps, status, ...(status !== 'running' ? { completed_at: new Date().toISOString() } : {}) }).eq('id', runRow.id).eq('user_id', userId);
  const push = async (s) => { steps.push({ ...s, at: new Date().toISOString() }); await save('running'); };

  try {
    await push({ step: 'permissions', label: 'Check workspace permissions', status: 'done', detail: `Autopilot on. Automatic texts ${settings.auto_send_sms ? 'on' : 'off'}, calls ${settings.auto_place_calls ? 'on' : 'off'}, drafts ${settings.auto_draft ? 'on' : 'off'}. Offers, contracts, money and legal filings always wait for you.` });

    // Monitor first: its alerts decide which analysis to run.
    const postContract = !PRE_CONTRACT.includes(deal.status);
    let alerts = [];
    if (postContract) {
      const m = await deps.monitor.checkDeal({ userId, dealId, db });
      alerts = m?.alerts || [];
      await push({ step: 'contract_monitoring', label: 'Deal Death Prevention', status: 'done', detail: alerts.length ? `${alerts.length} warning(s): ${alerts.map(a => a.message).join(' ')}` : 'No warning signs on this contract.', opened: (m?.opened || []).length, resolved: m?.resolved || 0 });
    } else {
      await push({ step: 'contract_monitoring', label: 'Deal Death Prevention', status: 'skipped', detail: 'Starts once the deal is under contract.' });
    }

    const atRisk = alerts.some(a => ['critical', 'high'].includes(a.severity));
    const intent = postContract ? (atRisk ? 'deal_not_working' : 'contract_health') : 'full_analysis';
    const synthesis = await deps.superAgent.run({ userId, actorUserId, dealId, command: `Autopilot: ${intent.replace(/_/g, ' ')}`, intent, useModel });
    await push({ step: 'understand_and_verify', label: 'Understand and verify the deal', status: 'done', detail: `${(synthesis.missing || []).length} missing item(s); ${(synthesis.data_gaps || []).length} data provider gap(s).`, run_id: synthesis.run_id });
    await push({ step: 'analyze', label: synthesis.intent_label, status: 'done', detail: `${synthesis.agents.length} agents ran (${synthesis.agents.filter(a => a.status === 'complete').length} complete). Overall confidence ${synthesis.confidence.score}/100.`, agents: synthesis.agents.map(a => ({ agent: a.agent, status: a.status, summary: a.summary })) });
    await push({ step: 'challenge', label: 'Challenger review', status: synthesis.agents.some(a => a.agent === 'challenger') ? 'done' : 'skipped', detail: `${(synthesis.challenges || []).length} challenge(s); ${(synthesis.disagreements || []).length} disagreement(s) between agents.` });
    const rescue = synthesis.agents.find(a => a.agent === 'deal_rescue');
    await push({ step: 'rescue', label: 'Deal Rescue diagnosis', status: rescue ? 'done' : 'skipped', detail: rescue ? rescue.summary : 'Deal is not flagged at risk.' });
    await push({ step: 'approvals', label: 'Approval gate', status: 'done', detail: synthesis.approvals_requested.length ? `Requested your approval for: ${synthesis.approvals_requested.map(a => a.reason).join('; ')}` : `${synthesis.pending_approvals.length} approval(s) already waiting for you.`, approvals_requested: synthesis.approvals_requested, pending: synthesis.pending_approvals.length });

    let lead = null;
    if (deal.lead_id) {
      const { data } = await db.from('leads').select('id, first_name, phone, consent, is_on_dnc, property_address, property_state').eq('id', deal.lead_id).eq('user_id', userId).maybeSingle();
      lead = data || null;
    }
    const { data: owner } = await db.from('users').select('company_name').eq('id', userId).maybeSingle();
    await push(await sellerFollowUp({ userId, deal, lead, settings, company: owner?.company_name || null, deps }));

    const bna = synthesis.best_next_action;
    await push({ step: 'best_next_action', label: 'Best next action', status: 'done', detail: bna ? `${bna.action} - ${bna.why}` : 'None computed.' });
    await save('completed');
    await audit.record({ userId, dealId, actorUserId, agentId: 'autopilot', actionType: 'autopilot.run', inputs: { triggered_by: triggeredBy, intent }, outputs: { run_id: runRow.id, steps: steps.map(s => `${s.step}:${s.status}`) } });
    return { id: runRow.id, status: 'completed', steps };
  } catch (err) {
    steps.push({ step: 'error', label: 'Run stopped', status: 'failed', detail: err.message, at: new Date().toISOString() });
    await save('failed');
    await audit.record({ userId, dealId, actorUserId, agentId: 'autopilot', actionType: 'autopilot.run_failed', inputs: { triggered_by: triggeredBy }, outputs: { run_id: runRow.id, error: err.message } });
    return { id: runRow.id, status: 'failed', steps };
  }
}

async function listRuns(userId, dealId, { limit = 20, db = supabaseDefault } = {}) {
  const { data, error } = await db.from('autopilot_runs').select('*').eq('user_id', userId).eq('deal_id', dealId)
    .order('started_at', { ascending: false }).limit(Math.min(Math.max(1, limit), 100));
  if (error) throw error;
  return data || [];
}

// Background sweep (AUTOPILOT_SWEEP_ENABLED=true): workspaces in Autopilot, active deals
// not run in SWEEP_RUN_GAP_HOURS. Model calls off to bound cost; each run is claimed.
async function sweep({ perWorkspace = Number(process.env.AUTOPILOT_SWEEP_PER_WORKSPACE) || 5, db = supabaseDefault } = {}) {
  const { data: workspaces, error } = await db.from('agent_settings').select('user_id').eq('mode', 'autopilot').limit(1000);
  if (error) throw error;
  const cutoff = new Date(Date.now() - SWEEP_RUN_GAP_HOURS * 3600000).toISOString();
  const stats = { workspaces: (workspaces || []).length, runs: 0, failed: 0, skipped: 0 };
  for (const w of workspaces || []) {
    const { data: deals } = await db.from('deals').select('id').eq('user_id', w.user_id).not('status', 'in', '(closed,lost)')
      .or(`last_autopilot_at.is.null,last_autopilot_at.lt.${cutoff}`).order('last_autopilot_at', { ascending: true, nullsFirst: true }).limit(perWorkspace);
    for (const d of deals || []) {
      try {
        const r = await run({ userId: w.user_id, dealId: d.id, triggeredBy: 'sweep', useModel: false });
        if (r.status === 'completed') stats.runs++; else stats.failed++;
      } catch (err) {
        if ([409, 429].includes(err.status)) stats.skipped++; else { stats.failed++; console.error(`[Autopilot] deal ${d.id}:`, err.message); }
      }
    }
  }
  return stats;
}

module.exports = { run, listRuns, sweep, sellerFollowUp, followUpText, maskPhone, FOLLOW_UP_STAGES };
