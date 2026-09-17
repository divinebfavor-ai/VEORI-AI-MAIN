// ─── Deal stage changes - the one path every stage move goes through ─────────
// Before this existed, the pipeline had two vocabularies and two write paths:
//   • the UI saved labels like 'under contract' / 'offer made' through PUT /deals/:id,
//     which triggered nothing;
//   • PATCH /deals/:id/stage used snake_case keys and owned the automation
//     (buyer outreach and title hand-off on under_contract, the close ritual on
//     closed) - but no screen ever called it;
//   • contract signing wrote status 'under_contract' straight to the table, so a
//     fully signed contract never started buyer outreach either.
// Every caller now uses changeDealStage, so a stage means the same thing no matter
// where it was set, and its automation runs exactly once per real transition.

const supabase = require('../config/supabase');
const { logActivity } = require('./dealActivityService');

// Ordered working path, then the off-path terminal stage. Keys are what the
// deals.status column stores and what analytics, sms.js and cooService query.
const DEAL_STAGES = [
  { key: 'lead',           label: 'New' },
  { key: 'contacted',      label: 'Contacted' },
  { key: 'offer_sent',     label: 'Offer Sent' },
  { key: 'negotiating',    label: 'Negotiating' },
  { key: 'under_contract', label: 'Under Contract' },
  { key: 'sent_to_title',  label: 'At Title' },
  { key: 'closing_prep',   label: 'Closing' },
  { key: 'closed',         label: 'Closed' },
  { key: 'lost',           label: 'Lost' },
];
const STAGE_KEYS = DEAL_STAGES.map(s => s.key);
const labelFor = (key) => (DEAL_STAGES.find(s => s.key === key) || {}).label || key;

// A deal can be created at these stages; later stages must be reached by a
// transition so their automation runs.
const CREATABLE_STAGES = ['lead', 'contacted', 'offer_sent', 'negotiating'];

const TERMINAL_OUTCOME = { closed: 'closed', lost: 'dead' };

class StageError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function isValidStage(stage) { return STAGE_KEYS.includes(stage); }

// ─── Learning loop: record a terminal outcome (won or lost) ───────────────────
// Best-effort, never throws, never fabricates - unknown fields are written null.
async function recordTerminalOutcome(deal, toStage, leadRow = null) {
  try {
    const outcome = TERMINAL_OUTCOME[toStage];
    if (!outcome || !deal) return;
    const createdAt = deal.created_at ? new Date(deal.created_at) : null;
    const now = new Date();
    const seasons = ['winter','winter','spring','spring','spring','summer','summer','summer','fall','fall','fall','winter'];
    const { error } = await supabase.from('deal_outcome_learning').insert({
      deal_id:                deal.id || null,
      outcome,
      reason:                 deal.notes || null,
      days_to_outcome:        createdAt ? Math.max(0, Math.floor((now - createdAt) / 86400000)) : null,
      final_motivation_score: leadRow?.motivation_score ?? null,
      state:                  deal.property_state || leadRow?.property_state || null,
      property_type:          deal.property_type || leadRow?.property_type || null,
      month:                  now.getMonth() + 1,
      season:                 seasons[now.getMonth()],
      assignment_fee:         outcome === 'closed' ? (deal.assignment_fee ?? null) : null,
      created_at:             now.toISOString(),
    });
    if (error) console.warn('[DealStage] outcome learning insert failed:', error.message);
  } catch (e) {
    console.warn('[DealStage] outcome learning record failed:', e.message);
  }
}

// ─── Automation for a real transition. Runs after the write; never throws. ────
async function runStageAutomation({ deal, from, to, userId }) {
  const dealId = deal.id;
  const commandLog = (actionType, summary, status = 'success', errorMessage = null) =>
    require('./aiCommandLog').logAiCommand({
      actionType, userId, dealId, leadId: deal.lead_id || null, summary, status, errorMessage,
    });

  // Prediction ledger: under_contract opens a "deal closes" prediction; a terminal
  // stage verifies it against what actually happened.
  try {
    const { logPrediction, verifyPrediction } = require('./learningLoopService');
    if (to === 'under_contract' && deal.lead_id) {
      const { data: prob } = await supabase.from('deal_probability_scores')
        .select('score').eq('lead_id', deal.lead_id).limit(1).maybeSingle();
      await logPrediction({
        userId, subjectType: 'deal', subjectId: dealId, prediction: 'deal_closes',
        probability: prob?.score != null ? prob.score / 100 : null,
        reasoning: `Deal moved under contract from ${from || 'new'}`,
      });
    } else if (TERMINAL_OUTCOME[to]) {
      const won = to === 'closed';
      await verifyPrediction({ subjectType: 'deal', subjectId: dealId, prediction: 'deal_closes', outcome: won });
      await require('./aiLearningService').recordDealOutcome({
        dealId, outcome: won ? 'closed' : 'fell_through', reason: `stage -> ${to}`,
        state: deal.property_state, assignmentFee: deal.assignment_fee,
      });
    }
  } catch (e) {
    console.warn('[DealStage] prediction ledger skipped:', e.message);
  }

  if (TERMINAL_OUTCOME[to]) {
    let lead = null;
    if (deal.lead_id) {
      const { data } = await supabase.from('leads').select('*').eq('id', deal.lead_id).eq('user_id', deal.user_id).maybeSingle();
      lead = data || null;
    }
    await recordTerminalOutcome(deal, to, lead);

    if (to === 'closed') {
      try {
        const { count: callCount } = await supabase.from('calls')
          .select('id', { count: 'exact', head: true }).eq('lead_id', deal.lead_id).eq('user_id', deal.user_id);
        const daysToClose = deal.created_at ? Math.round((Date.now() - new Date(deal.created_at)) / 86400000) : null;
        await require('./dataMotService').recordWinningPlaybook({
          deal, lead, calls_to_close: callCount || 0, days_to_close: daysToClose,
        });
      } catch (e) { console.error('[DealStage] winning playbook record failed:', e.message); }
      try {
        await require('./closeRitualService').runCloseRitual({ dealId, userId });
      } catch (e) { console.error('[DealStage] close ritual failed:', e.message); }
    }
  }

  if (to === 'under_contract') {
    try {
      const { matched, enqueued, usedFallback } = await require('./buyerDispoService').startBuyerBlast(dealId, userId);
      await commandLog('buyer_blast_auto', usedFallback
        ? `No buyer's buy box matched - queued ${enqueued} texts to all active buyers when the deal went under contract`
        : `Matched ${matched} buyers, queued ${enqueued} texts when the deal went under contract`);
    } catch (e) {
      console.error('[DealStage] buyer outreach failed:', e.message);
      await commandLog('buyer_blast_auto', 'Buyer outreach failed', 'failed', e.message);
    }
    try {
      const title = require('./titleService');
      const assigned = await title.autoAssignTitleCompany(dealId, userId);
      if (assigned) {
        await title.sendDealPackageToTitle(dealId, userId);
        await title.scheduleTitleFollowUps(dealId, userId);
        await commandLog('title_auto', `Deal package sent to ${assigned.name}`);
      } else {
        await commandLog('title_auto', 'No title company on file - deal package not sent', 'skipped');
      }
    } catch (e) {
      console.error('[DealStage] title workflow failed:', e.message);
      await commandLog('title_auto', 'Title workflow failed', 'failed', e.message);
    }
  }
}

/**
 * Move a deal to a stage and run that stage's automation.
 *
 * The write is conditional on the deal NOT already being at `stage`, so two
 * simultaneous requests (or a re-save of the same stage) cannot start buyer
 * outreach twice: only the request whose update actually changed the row runs
 * automation.
 *
 * @param {object} p
 * @param {string} p.dealId
 * @param {string} p.userId     owner; the deal must belong to this user
 * @param {string} p.stage      one of STAGE_KEYS
 * @param {string} [p.actor]    'operator' | 'system' - recorded on the activity
 * @param {string} [p.reason]   why it moved, shown in the deal timeline
 * @param {boolean} [p.awaitAutomation=false]  await automation (tests); routes
 *                              respond first and let it run in the background
 * @returns {Promise<{ deal: object, changed: boolean, from: string|null }>}
 * @throws {StageError} 400 invalid stage, 404 deal not found
 */
async function changeDealStage({ dealId, userId, stage, actor = 'operator', reason = null, awaitAutomation = false }) {
  if (!isValidStage(stage)) throw new StageError(400, `Invalid stage. Use one of: ${STAGE_KEYS.join(', ')}`);
  if (!dealId || !userId) throw new StageError(404, 'Deal not found');

  const { data: current, error: readErr } = await supabase.from('deals')
    .select('*').eq('id', dealId).eq('user_id', userId).maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!current) throw new StageError(404, 'Deal not found');
  if (current.status === stage) return { deal: current, changed: false, from: current.status };

  const now = new Date().toISOString();
  const { data: rows, error: updErr } = await supabase.from('deals')
    .update({ status: stage, stage_changed_at: now, updated_at: now })
    .eq('id', dealId).eq('user_id', userId)
    .or(`status.is.null,status.neq.${stage}`)
    .select();
  if (updErr) throw new Error(updErr.message);
  const deal = rows && rows[0];
  if (!deal) {
    // Another request moved it to this stage first; its automation is running.
    const { data: latest } = await supabase.from('deals').select('*').eq('id', dealId).eq('user_id', userId).maybeSingle();
    return { deal: latest || current, changed: false, from: current.status };
  }

  const from = current.status || null;
  await logActivity({
    userId, dealId, leadId: deal.lead_id, actorType: actor,
    activityType: 'stage_updated',
    message: `Stage changed from ${labelFor(from || 'lead')} to ${labelFor(stage)}${reason ? ` - ${reason}` : ''}`,
    metadata: { from, to: stage, reason },
  }).catch(e => console.warn('[DealStage] activity log failed:', e.message));

  require('./webhookService').emitEvent(userId, 'deal.stage_changed', { deal_id: deal.id, lead_id: deal.lead_id, from, to: stage, reason, actor });

  const automation = runStageAutomation({ deal, from, to: stage, userId })
    .catch(e => console.error('[DealStage] automation error:', e.message));
  if (awaitAutomation) await automation;

  return { deal, changed: true, from };
}

module.exports = {
  DEAL_STAGES, STAGE_KEYS, CREATABLE_STAGES, TERMINAL_OUTCOME,
  StageError, isValidStage, changeDealStage, recordTerminalOutcome,
};
