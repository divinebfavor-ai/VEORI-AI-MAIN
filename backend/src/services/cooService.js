/**
 * COO SERVICE — the AI Chief Operating Officer layer.
 *
 * The operator's mission: one AI that answers FOUR questions at all times —
 *   1. What is happening?      (state of the pipeline right now)
 *   2. Why is it happening?    (the drivers / bottlenecks behind that state)
 *   3. What is likely next?     (forecast: portfolio EV, deals about to move/die)
 *   4. What should I do now?    (the single highest-leverage action queue)
 *
 * This service does NOT rewrite the engines you already have. It FUSES them:
 *   - predictionEngine.predict()  → per-lead EV, close odds, fallout, next action
 *   - assignmentFeeService (via predict) → expected fee
 *   - the raw leads/deals/calls/follow_ups rows → counts, drivers, bottlenecks
 *
 * UNIVERSAL RULES honored natively:
 *   - Never fabricate: every number is derived from real rows; missing data →
 *     null + a reason, never a fake figure.
 *   - Confidence + evidence: opportunities carry the prediction's own confidence
 *     and evidence; bottlenecks/forecast carry the row counts that produced them.
 *   - Prioritize profit × close probability: the action queue is sorted by
 *     expected value (predictionEngine's EV), not by recency.
 *   - Auditable: pure shaping; the route persists/logs. This service writes nothing.
 *
 * It is a READER + FUSER. Pure given its inputs, null-safe, never throws. The
 * route layer does all I/O (Supabase) and passes plain arrays in.
 */

const predictionEngine = require('./predictionEngine');

const ACTIVE_EXCLUDE = ['closed', 'dead', 'dnc', 'under_contract'];

/** Safe number coerce — returns 0 for null/NaN so sums never explode. */
function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

/** Format a dollar figure or '—' when null/unknown (never a fake number). */
function money(v) {
  return v == null ? null : Math.round(Number(v));
}

/**
 * ANSWER 1 — What is happening?
 * A factual snapshot of the pipeline from real row counts. No inference here.
 */
function whatIsHappening({ leads, deals, callsToday, followUpsDue }) {
  const total      = leads.length;
  const active     = leads.filter(l => !ACTIVE_EXCLUDE.includes((l.status || '').toLowerCase())).length;
  const hot        = leads.filter(l => n(l.motivation_score) >= 70).length;
  const liveDeals  = deals.filter(d => (d.status || '') !== 'dead').length;
  const closed     = deals.filter(d => (d.status || '') === 'closed').length;
  const underK     = deals.filter(d => (d.status || '') === 'under_contract').length;

  return {
    leads_total:        total,
    leads_active:       active,
    leads_hot:          hot,
    deals_live:         liveDeals,
    deals_under_contract: underK,
    deals_closed:       closed,
    calls_today:        callsToday.length,
    follow_ups_due:     followUpsDue.length,
    summary: `${active} active leads (${hot} hot), ${liveDeals} live deals `
           + `(${underK} under contract, ${closed} closed), ${callsToday.length} calls today, `
           + `${followUpsDue.length} follow-ups due.`,
  };
}

/**
 * LEARNING SUMMARY (Rule 3, made visible) — aggregate the deal_outcome_learning
 * history the engine already learns from, so the operator can SEE what the AI has
 * picked up. This is read-only over real recorded outcomes.
 *
 * NEVER FABRICATES: with no history it returns { learned:false } and null metrics —
 * no invented win-rates. Only counts rows whose outcome is unambiguously won/lost.
 * Returns the best-performing state (highest close rate, min 3 samples) when known.
 */
function summarizeLearning(outcomes) {
  const rows = Array.isArray(outcomes) ? outcomes : [];
  const isWon  = o => /clos|won|assigned|funded/i.test(o?.outcome || '');
  const isLost = o => /fell|fail|dead|lost|cancel|withdraw/i.test(o?.outcome || '');

  const won  = rows.filter(isWon).length;
  const lost = rows.filter(isLost).length;
  const decided = won + lost;

  if (decided === 0) {
    return {
      learned: false,
      sample_size: rows.length,
      won: 0, lost: 0,
      win_rate: null,
      avg_days_to_close: null,
      best_state: null,
      summary: 'No closed/dead deals recorded yet — the AI starts learning as deals reach an outcome.',
    };
  }

  const winRate = Math.round((won / decided) * 100);

  // Average days-to-close over WON deals that carry a days_to_outcome.
  const wonDays = rows.filter(o => isWon(o) && o.days_to_outcome != null)
                      .map(o => n(o.days_to_outcome));
  const avgDays = wonDays.length
    ? Math.round(wonDays.reduce((s, d) => s + d, 0) / wonDays.length)
    : null;

  // Best-performing state by close rate (min 3 decided samples → no noise).
  const byState = new Map();
  for (const o of rows) {
    const st = (o.state || '').trim();
    if (!st) continue;
    const w = isWon(o) ? 1 : 0;
    const l = isLost(o) ? 1 : 0;
    if (!w && !l) continue;
    const cur = byState.get(st) || { won: 0, decided: 0 };
    cur.won += w; cur.decided += w + l;
    byState.set(st, cur);
  }
  let bestState = null;
  for (const [st, v] of byState) {
    if (v.decided < 3) continue;
    const rate = v.won / v.decided;
    if (!bestState || rate > bestState.rate) {
      bestState = { state: st, rate, win_rate: Math.round(rate * 100), won: v.won, decided: v.decided };
    }
  }

  return {
    learned: true,
    sample_size: rows.length,
    won, lost,
    win_rate: winRate,
    avg_days_to_close: avgDays,
    best_state: bestState ? { state: bestState.state, win_rate: bestState.win_rate, won: bestState.won, decided: bestState.decided } : null,
    summary: `Learned from ${decided} decided deals: ${won} closed / ${lost} dead (${winRate}% win rate)`
           + (avgDays != null ? `, avg ${avgDays} days to close` : '')
           + (bestState ? `. Strongest market: ${bestState.state} (${bestState.win_rate}%).` : '.'),
  };
}

/**
 * ANSWER 4 (computed early — drives the others) — run the REAL predictor across
 * active leads and rank by expected value. This is the profit × close-probability
 * prioritization the rules demand. Each item carries the prediction's own
 * confidence + evidence, so nothing is fabricated.
 */
function rankOpportunities({ leads, dealsByLead, outcomes }) {
  const scored = [];

  for (const lead of leads) {
    if (ACTIVE_EXCLUDE.includes((lead.status || '').toLowerCase())) continue;
    const deal = dealsByLead.get(lead.id) || null;

    let pred;
    try {
      pred = predictionEngine.predict(lead, deal, { outcomes });
    } catch {
      continue; // a single bad row never breaks the whole COO view
    }

    scored.push({
      lead_id:        lead.id,
      name:           `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Unnamed lead',
      phone:          lead.phone || null,
      state:          lead.property_state || null,
      strategy:       pred.strategy?.primary || 'cash',
      expected_value: pred.expected_value,            // null when pricing missing — honest
      close_odds:     pred.predictions?.closes?.value ?? null,
      fallout_risk:   pred.predictions?.fallout_risk?.value ?? null,
      confidence:     pred.overall_confidence,
      escalate:       pred.escalate,
      next_action:    pred.best_next_action?.action || null,
      next_reason:    pred.best_next_action?.reason || null,
      evidence:       (pred.evidence || []).slice(0, 4),
    });
  }

  // Rule 5 — sort by expected value first (nulls last), then close odds, then
  // confidence. The operator's time goes to the most profitable, likeliest deals.
  scored.sort((a, b) => {
    const ev = (b.expected_value ?? -1) - (a.expected_value ?? -1);
    if (ev !== 0) return ev;
    const co = (b.close_odds ?? -1) - (a.close_odds ?? -1);
    if (co !== 0) return co;
    return (b.confidence ?? 0) - (a.confidence ?? 0);
  });

  return scored;
}

/**
 * ANSWER 3 — What is likely to happen next?
 * Portfolio forecast built ONLY from the per-lead predictions we just computed.
 * Pipeline EV = Σ expected_value across opportunities that have one. We never
 * invent EV for leads whose pricing is unknown — those are counted separately as
 * "needs pricing" so the forecast stays honest.
 */
function whatHappensNext(opportunities) {
  const withEv    = opportunities.filter(o => o.expected_value != null);
  const pipelineEv = withEv.reduce((s, o) => s + n(o.expected_value), 0);

  const aboutToClose = opportunities
    .filter(o => (o.close_odds ?? 0) >= 70)
    .slice(0, 5)
    .map(o => ({ lead_id: o.lead_id, name: o.name, close_odds: o.close_odds, expected_value: o.expected_value }));

  const atRisk = opportunities
    .filter(o => (o.fallout_risk ?? 0) >= 50)
    .sort((a, b) => (b.fallout_risk ?? 0) - (a.fallout_risk ?? 0))
    .slice(0, 5)
    .map(o => ({ lead_id: o.lead_id, name: o.name, fallout_risk: o.fallout_risk, reason: o.next_reason }));

  const needsPricing = opportunities.filter(o => o.expected_value == null).length;

  return {
    pipeline_expected_value: money(pipelineEv),
    deals_with_ev:           withEv.length,
    deals_need_pricing:      needsPricing,
    about_to_close:          aboutToClose,
    at_risk:                 atRisk,
    summary: withEv.length
      ? `Pipeline expected value ≈ $${money(pipelineEv).toLocaleString()} across ${withEv.length} priced deal(s). `
        + `${aboutToClose.length} likely to close, ${atRisk.length} at fallout risk.`
      : `No priced deals yet — set buyer price + seller cost on your top leads to unlock a revenue forecast. `
        + `${needsPricing} lead(s) waiting on pricing.`,
  };
}

/**
 * ANSWER 2 — Why is it happening?
 * Bottleneck scan. Looks at where the pipeline is leaking, derived from the same
 * rows. Each bottleneck is a plain observation + the count behind it (evidence),
 * never a guess. Returns the top drivers sorted by severity.
 */
function whyIsItHappening({ leads, deals, callsRecent, followUpsDue, opportunities }) {
  const bottlenecks = [];

  // 1. Hot leads with no recent contact = warmest revenue leaking.
  const staleHot = leads.filter(l =>
    n(l.motivation_score) >= 70 &&
    !ACTIVE_EXCLUDE.includes((l.status || '').toLowerCase()) &&
    isStale(l.last_call_date, 3)
  );
  if (staleHot.length) {
    bottlenecks.push({
      key: 'stale_hot_leads', severity: staleHot.length >= 5 ? 'high' : 'medium',
      title: `${staleHot.length} hot lead(s) going cold`,
      detail: `Motivation ≥70 but no call in 3+ days. Warm motivation decays — these are your fastest dollars leaking.`,
      count: staleHot.length, evidence: `${staleHot.length} leads, motivation≥70, last_call >3d ago`,
    });
  }

  // 2. Follow-ups overdue = commitments slipping.
  if (followUpsDue.length >= 3) {
    bottlenecks.push({
      key: 'overdue_followups', severity: followUpsDue.length >= 10 ? 'high' : 'medium',
      title: `${followUpsDue.length} follow-up(s) overdue`,
      detail: `Scheduled touches past due. Each missed follow-up is a promise broken with a seller.`,
      count: followUpsDue.length, evidence: `${followUpsDue.length} follow_ups with due_date in the past`,
    });
  }

  // 3. Deals under contract at high fallout risk = closing pipeline at risk.
  const riskyK = opportunities.filter(o => (o.fallout_risk ?? 0) >= 60);
  if (riskyK.length) {
    bottlenecks.push({
      key: 'fallout_risk', severity: 'high',
      title: `${riskyK.length} deal(s) at high fallout risk`,
      detail: `Close odds are weak on deals already in motion. Clear title, confirm the buyer, or re-engage the seller now.`,
      count: riskyK.length, evidence: riskyK.slice(0, 3).map(o => `${o.name}: fallout ${o.fallout_risk}%`).join('; '),
    });
  }

  // 4. Low answered-call rate = top-of-funnel contact problem.
  const answered = callsRecent.filter(c => (c.status === 'ended' || c.status === 'completed') && n(c.duration_seconds) > 10).length;
  const rate = callsRecent.length ? Math.round((answered / callsRecent.length) * 100) : null;
  if (rate != null && callsRecent.length >= 10 && rate < 25) {
    bottlenecks.push({
      key: 'low_answer_rate', severity: 'medium',
      title: `Answer rate is ${rate}%`,
      detail: `Fewer than 1 in 4 calls connect. Number reputation, call windows, or list quality may be the leak.`,
      count: rate, evidence: `${answered}/${callsRecent.length} recent calls connected (>10s)`,
    });
  }

  // 5. Leads with no pricing = predictions blind. Why the forecast is thin.
  const noPricing = opportunities.filter(o => o.expected_value == null).length;
  if (noPricing >= 5) {
    bottlenecks.push({
      key: 'missing_pricing', severity: 'low',
      title: `${noPricing} lead(s) missing pricing`,
      detail: `Without buyer price + seller cost, the engine can't forecast fee, EV, or closing — your revenue view is partial.`,
      count: noPricing, evidence: `${noPricing} active leads with no derivable spread`,
    });
  }

  const order = { high: 0, medium: 1, low: 2 };
  bottlenecks.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    bottlenecks,
    summary: bottlenecks.length
      ? `Top drivers: ${bottlenecks.slice(0, 3).map(b => b.title).join('; ')}.`
      : 'No major bottlenecks detected — pipeline is flowing.',
  };
}

/** True if a date is null/missing or older than `days` days ago. */
function isStale(dateStr, days) {
  if (!dateStr) return true;
  const then = new Date(dateStr).getTime();
  if (!Number.isFinite(then)) return true;
  return (Date.now() - then) > days * 86400000;
}

/**
 * Compose the full COO briefing from already-fetched rows. Pure, null-safe.
 *
 * @param {object} rows
 *   leads[]         active+inactive leads for the user (each may carry deals via join? no — see dealsByLead)
 *   deals[]         deals for the user
 *   dealsByLead     Map<lead_id, newest deal>
 *   callsToday[]    calls created today
 *   callsRecent[]   calls in the last ~7 days (for answer-rate)
 *   followUpsDue[]  pending follow-ups past due
 *   outcomes[]      deal_outcome_learning rows (best-effort; may be [])
 * @returns {object} the 4-answer briefing
 */
function buildBriefing(rows) {
  const leads         = Array.isArray(rows.leads) ? rows.leads : [];
  const deals         = Array.isArray(rows.deals) ? rows.deals : [];
  const dealsByLead   = rows.dealsByLead instanceof Map ? rows.dealsByLead : new Map();
  const callsToday    = Array.isArray(rows.callsToday) ? rows.callsToday : [];
  const callsRecent   = Array.isArray(rows.callsRecent) ? rows.callsRecent : [];
  const followUpsDue  = Array.isArray(rows.followUpsDue) ? rows.followUpsDue : [];
  const outcomes      = Array.isArray(rows.outcomes) ? rows.outcomes : [];

  const opportunities = rankOpportunities({ leads, dealsByLead, outcomes });

  const happening = whatIsHappening({ leads, deals, callsToday, followUpsDue });
  const next      = whatHappensNext(opportunities);
  const why       = whyIsItHappening({ leads, deals, callsRecent, followUpsDue, opportunities });

  // ANSWER 4 — the action queue: top opportunities by EV, plus any escalations
  // surfaced first (Rule 4). Capped so the operator sees a focused list.
  const escalations = opportunities.filter(o => o.escalate).slice(0, 3);
  const topActions  = opportunities.slice(0, 7).map(o => ({
    lead_id:        o.lead_id,
    name:           o.name,
    phone:          o.phone,
    action:         o.next_action,
    reason:         o.next_reason,
    expected_value: o.expected_value,
    close_odds:     o.close_odds,
    confidence:     o.confidence,
    strategy:       o.strategy,
  }));

  return {
    generated_at: new Date().toISOString(),
    what_is_happening:   happening,   // Q1
    why_is_it_happening: why,         // Q2
    what_happens_next:   next,        // Q3
    what_to_do_now: {                 // Q4
      escalations,
      actions: topActions,
      summary: topActions.length
        ? `Work these ${topActions.length} in order — highest expected value first.`
        : 'No active opportunities to action. Focus on new outreach.',
    },
    // A compact headline the dashboard can show at the top.
    headline: happening.summary,
    opportunities_count: opportunities.length,
    // What the AI has LEARNED so far (Rule 3, made visible). Best-effort: null/false
    // when there's no recorded outcome history yet — never a fabricated win-rate.
    learning: summarizeLearning(outcomes),
    rules_applied: [
      'rule1_no_fabrication', 'rule2_confidence_evidence', 'rule3_outcome_learning',
      'rule5_prioritize_profit_x_close', 'rule6_auditable',
    ],
  };
}

module.exports = { buildBriefing, rankOpportunities, ACTIVE_EXCLUDE };
