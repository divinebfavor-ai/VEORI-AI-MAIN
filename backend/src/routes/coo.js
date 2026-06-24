/**
 * /api/coo — the AI Chief Operating Officer command center.
 *
 * GET /api/coo/briefing → one fused view that answers the operator's four
 * standing questions:
 *   1. What is happening?     2. Why is it happening?
 *   3. What is likely next?   4. What should I do right now?
 *
 * This route is the I/O layer: it pulls the operator's leads, deals, calls, and
 * follow-ups (all scoped to req.user.id), pairs each lead with its newest deal,
 * pulls best-effort outcome history, then hands plain arrays to cooService —
 * which runs the REAL predictionEngine across the pipeline and shapes the answer.
 *
 * NEW FILE — mounts beside /api/briefing. Does not modify any existing route.
 * Every query is best-effort: a missing table or a single bad row degrades that
 * section to empty, never 500s the whole briefing.
 */

const express  = require('express');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const cooService = require('../services/cooService');
const operatorMode = require('../services/operatorMode');

const router = express.Router();
router.use(requireAuth);

function todayStart() {
  return new Date().toISOString().split('T')[0] + 'T00:00:00Z';
}
function daysAgoIso(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

/** Best-effort select — returns [] on any error (table missing, RLS, etc.). */
async function safeSelect(build) {
  try {
    const { data, error } = await build();
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

// GET /api/coo/briefing — the full 4-answer COO briefing for the current operator.
router.get('/briefing', async (req, res, next) => {
  try {
    const uid = req.user.id;

    // Pull the working set in parallel. Leads + deals drive predictions; calls +
    // follow-ups drive the "what's happening" snapshot and bottleneck scan.
    const [leads, deals, callsToday, callsRecent, followUpsDue] = await Promise.all([
      safeSelect(() => supabase.from('leads')
        .select('id, first_name, last_name, phone, property_state, status, motivation_score, last_call_date, mortgage_balance, est_monthly_payment, interest_rate, arrears_amount, loan_type, detected_strategy, strategy_confidence, strategy_override, arv, offer_price, seller_agreed_price')
        .eq('user_id', uid)
        .limit(500)),
      safeSelect(() => supabase.from('deals')
        .select('id, lead_id, status, price, deal_type, arv, offer_price, seller_agreed_price, deal_velocity_score, created_at, closing_date')
        .eq('user_id', uid)
        .limit(500)),
      safeSelect(() => supabase.from('calls')
        .select('id, status, duration_seconds')
        .eq('user_id', uid)
        .gte('created_at', todayStart())
        .limit(500)),
      safeSelect(() => supabase.from('calls')
        .select('id, status, duration_seconds')
        .eq('user_id', uid)
        .gte('created_at', daysAgoIso(7))
        .limit(1000)),
      safeSelect(() => supabase.from('follow_ups')
        .select('id, lead_id, due_date, title, status')
        .eq('user_id', uid)
        .eq('status', 'pending')
        .lte('due_date', new Date().toISOString())
        .limit(200)),
    ]);

    // Pair each lead with its NEWEST deal so the predictor sees current pricing.
    const dealsByLead = new Map();
    for (const d of deals) {
      if (!d.lead_id) continue;
      const prev = dealsByLead.get(d.lead_id);
      if (!prev || new Date(d.created_at || 0) > new Date(prev.created_at || 0)) {
        dealsByLead.set(d.lead_id, d);
      }
    }

    // Best-effort outcome history (Rule 3 learning nudge). Pull a recent slice;
    // cooService passes it through to predictionEngine per lead.
    const outcomes = await safeSelect(() => supabase.from('deal_outcome_learning')
      .select('outcome, state, days_to_outcome')
      .order('created_at', { ascending: false })
      .limit(200));

    const briefing = cooService.buildBriefing({
      leads, deals, dealsByLead,
      callsToday, callsRecent, followUpsDue, outcomes,
    });

    // SECTION E — copilot/autopilot. Read the operator's mode (defaults to the
    // safest 'copilot' if the column isn't set/migrated) and annotate the action
    // queue with per-action dispositions (auto vs needs-approval). Additive: the
    // existing what_to_do_now.actions shape is preserved; we attach an operator_mode
    // block alongside it. Best-effort — never blocks the briefing.
    let opMode = operatorMode.DEFAULT_MODE;
    try {
      const { data: u } = await supabase.from('users').select('operator_mode').eq('id', uid).single();
      opMode = operatorMode.normalizeMode(u?.operator_mode);
    } catch { /* column not migrated — safe default */ }
    try {
      const queue = briefing?.what_to_do_now?.actions || [];
      briefing.what_to_do_now.operator_mode = operatorMode.annotateActions(queue, opMode);
    } catch { /* shaping guard — leave queue untouched */ }

    // Best-effort audit log (Rule 6). Never blocks the response.
    try {
      await supabase.from('coo_briefings').insert({
        user_id:            uid,
        headline:           briefing.headline,
        what_is_happening:  briefing.what_is_happening,
        why_is_it_happening: briefing.why_is_it_happening,
        what_happens_next:  briefing.what_happens_next,
        what_to_do_now:     briefing.what_to_do_now,
      });
    } catch { /* table not migrated — non-blocking */ }

    res.json({ success: true, data: briefing });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
