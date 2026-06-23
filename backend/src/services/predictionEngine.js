/**
 * AI DEAL PREDICTION ENGINE — the unifying spine.
 *
 * Every existing scorer in Veori produces a number in isolation:
 *   • leadTaggingService.detectStrategy(lead)      → best play + ranked fallbacks
 *   • assignmentFeeService.suggestAssignmentFee()  → fee from the live spread
 *   • leadEngineScorer.calculateSourcingScore()    → distress signal score
 * …plus the persisted motivation_score on the lead itself.
 *
 * This engine CONSUMES those (it rewrites none of them) and fuses them into ONE
 * prediction object for a lead/deal:
 *   { predictions:{ sells, accepts_offer, motivation, under_contract, closes,
 *                   assignment_fee, closing_date, fallout_risk },
 *     best_next_action, overall_confidence, evidence[], rules_applied[] }
 *
 * It honors the operator's 7 AI Rules NATIVELY:
 *   1. NEVER fabricate → every probability is null when the inputs to derive it are
 *      missing. We return reasons, not invented numbers.
 *   2. Every prediction carries confidence + evidence → each field has { value,
 *      confidence, evidence[] }, and the engine returns a flat evidence[] too.
 *   3. Learn from closed/failed deals → if deal_outcome_learning history is passed
 *      in, recent outcomes nudge confidence (see applyOutcomeLearning). Absent =
 *      no nudge (never blocks).
 *   4. Escalate below threshold → overall_confidence < ESCALATE_BELOW sets
 *      escalate=true so the caller can flag for human review.
 *   5. Prioritize close probability × expected profit → best_next_action and the
 *      expected_value field weigh closes against the suggested fee.
 *   6. Log every prediction → the route persists the returned object to
 *      deal_predictions (this module stays pure; it writes nothing).
 *   7. Real-time → pure & synchronous-ish; the route calls it on demand.
 *
 * PURE & SAFE: no DB calls, no network, never throws. Missing inputs collapse to
 * null + a reason. Pass it a joined lead (optionally its best deal + outcome
 * history); it never mutates them.
 */

const { detectStrategy } = require('./leadTaggingService');
const { suggestAssignmentFee } = require('./assignmentFeeService');
const { calculateSourcingScore } = require('./leadEngineScorer');

// Rule 4 — escalate to a human when we're not confident enough to act alone.
const ESCALATE_BELOW = 55;

const clampPct = n =>
  n == null || Number.isNaN(n) ? null : Math.max(0, Math.min(100, Math.round(n)));
const clampConf = n => (n == null || Number.isNaN(n) ? 0 : Math.max(0, Math.min(100, Math.round(n))));

/** A single prediction field — value (nullable, never fabricated), confidence, evidence. */
function field(value, confidence, evidence, reason) {
  return {
    value: value == null ? null : value,
    confidence: clampConf(confidence),
    evidence: Array.isArray(evidence) ? evidence.filter(Boolean) : (evidence ? [evidence] : []),
    ...(reason ? { reason } : {}),
  };
}

/**
 * Motivation 0..100. Prefer the lead's persisted motivation_score; else derive a
 * floor from distress signals via the existing sourcing scorer; else null.
 */
function predictMotivation(lead) {
  const persisted = lead.motivation_score != null ? Number(lead.motivation_score) : null;
  const sourcing = calculateSourcingScore(lead); // pure, never throws
  const signals = sourcing.signals || [];

  if (persisted != null && !Number.isNaN(persisted)) {
    return field(
      clampPct(persisted),
      // confidence in the motivation read grows with how many signals corroborate it
      Math.min(95, 60 + signals.length * 8),
      [
        `persisted motivation_score = ${persisted}`,
        ...(signals.length ? [`${signals.length} distress signal(s): ${signals.join(', ')}`] : []),
      ],
    );
  }
  if (sourcing.score > 0) {
    return field(
      clampPct(sourcing.score),
      Math.min(85, 45 + signals.length * 8),
      [`derived from ${signals.length} distress signal(s): ${signals.join(', ')}`],
    );
  }
  return field(null, 0, [], 'No motivation_score and no distress signals — capture seller signals to score.');
}

/**
 * P(seller actually sells) — built off motivation + engagement signals already on
 * the lead (answered calls, replied texts, asked for offer). Conservative; null if
 * we have nothing to read.
 */
function predictSells(lead, motivation) {
  const ev = [];
  let base = motivation.value; // anchor on motivation
  if (base == null) {
    return field(null, 0, [], 'No motivation signal yet — cannot estimate likelihood to sell.');
  }
  let conf = Math.min(80, 50 + Math.round(motivation.confidence * 0.3));
  ev.push(`motivation ${motivation.value}`);

  // Engagement lifts: real conversation beats raw distress.
  const status = (lead.status || '').toLowerCase();
  if (/answered|connected|engaged|warm|hot|appointment|offer/i.test(status)) {
    base = Math.min(100, base + 12); conf = Math.min(90, conf + 8);
    ev.push(`engaged status "${lead.status}"`);
  }
  if (lead.asked_for_offer || /offer/i.test(status)) {
    base = Math.min(100, base + 8); conf = Math.min(92, conf + 6);
    ev.push('seller asked about an offer');
  }
  if (/dnc|wrong|dead|not.?interested|do.?not/i.test(status)) {
    base = Math.max(0, base - 35); conf = Math.min(88, conf + 10);
    ev.push(`negative status "${lead.status}"`);
  }
  return field(clampPct(base), conf, ev);
}

/**
 * P(accepts our offer) — only meaningful once there's a deal with pricing. Anchors
 * on the spread (room to land a deal both sides accept) + motivation.
 */
function predictAcceptsOffer(lead, deal, motivation, fee) {
  if (!deal) {
    return field(null, 0, [], 'No deal yet — create a deal with pricing to estimate offer acceptance.');
  }
  const spread = fee?.basis?.spread;
  if (spread == null) {
    return field(null, 0, [], fee?.basis?.reason || 'Need buyer price + seller cost to estimate acceptance.');
  }
  const ev = [`spread $${Number(spread).toLocaleString()}`];
  // More motivated sellers accept at a wider range; thicker spread = more room.
  let p = 40;
  if (motivation.value != null) { p += Math.round((motivation.value - 50) * 0.4); ev.push(`motivation ${motivation.value}`); }
  if (spread > 0)      { p += 15; }
  if (spread >= 25000) { p += 10; ev.push('healthy spread to negotiate'); }
  if (spread <= 0)     { p = Math.min(p, 20); ev.push('no spread — acceptance unlikely without renegotiation'); }
  return field(clampPct(p), motivation.value != null ? 70 : 55, ev);
}

/** P(gets under contract) — sells × accepts, when both exist. */
function predictUnderContract(sells, accepts) {
  if (sells.value == null || accepts.value == null) {
    return field(null, 0, [], 'Needs both likelihood-to-sell and offer-acceptance.');
  }
  const p = Math.round((sells.value / 100) * (accepts.value / 100) * 100);
  return field(clampPct(p), Math.round((sells.confidence + accepts.confidence) / 2),
    [`P(sells)=${sells.value}% × P(accepts)=${accepts.value}%`]);
}

/**
 * P(deal closes) — under_contract discounted by title/fallout risk. Title clears,
 * buyer performs, no liens surprise. Null until under_contract exists.
 */
function predictCloses(underContract, lead, deal) {
  if (underContract.value == null) {
    return field(null, 0, [], 'Not under contract yet — closing probability not meaningful.');
  }
  let p = underContract.value;
  const ev = [`under-contract ${underContract.value}%`];
  // Known frictions pull it down.
  if (lead.has_liens)        { p = Math.round(p * 0.9);  ev.push('liens present — title risk'); }
  if (lead.has_lis_pendens)  { p = Math.round(p * 0.88); ev.push('lis pendens — timeline risk'); }
  if (deal?.title_status && /clear|clean/i.test(deal.title_status)) { p = Math.min(100, Math.round(p * 1.05)); ev.push('title reported clear'); }
  return field(clampPct(p), Math.max(40, underContract.confidence - 5), ev);
}

/**
 * Assignment fee range — wraps the existing suggester verbatim (no new math). Returns
 * the {suggested, floor, ceiling} band + its basis as evidence.
 */
function predictAssignmentFee(fee) {
  if (!fee || fee.suggested == null) {
    return field(null, 0, [], fee?.basis?.reason || 'No spread yet — set buyer + seller pricing to derive a fee.');
  }
  return field(
    { suggested: fee.suggested, floor: fee.floor, ceiling: fee.ceiling },
    fee.basis?.spread > 25000 ? 75 : 60,
    [fee.basis?.reason].filter(Boolean),
  );
}

/**
 * Estimated closing date — only when a deal carries a close-by / period signal. We
 * never invent a date; null + reason otherwise.
 */
function predictClosingDate(deal) {
  if (!deal) return field(null, 0, [], 'No deal — no closing timeline.');
  if (deal.target_close_date) {
    return field(deal.target_close_date, 70, [`deal.target_close_date set`]);
  }
  const period = Number(deal.closing_period_days || deal.closing_period || 0);
  if (period > 0 && deal.under_contract_at) {
    const d = new Date(deal.under_contract_at);
    if (!Number.isNaN(d.getTime())) {
      d.setDate(d.getDate() + period);
      return field(d.toISOString().slice(0, 10), 65, [`under-contract + ${period}d closing period`]);
    }
  }
  return field(null, 0, [], 'Set a target close date or closing period to estimate.');
}

/** Fallout risk 0..100 = inverse of closes, surfaced with its drivers. */
function predictFalloutRisk(closes, lead) {
  if (closes.value == null) {
    return field(null, 0, [], 'Closing probability unknown — fallout risk not yet meaningful.');
  }
  const risk = 100 - closes.value;
  const ev = [`inverse of close probability (${closes.value}%)`];
  if (lead.has_liens)       ev.push('liens');
  if (lead.has_lis_pendens) ev.push('active foreclosure timeline');
  return field(clampPct(risk), closes.confidence, ev);
}

/**
 * Rule 5 — best next action ranks by close probability × expected profit, then by
 * what's blocking progress. Always returns SOMETHING actionable (never null), but
 * its confidence reflects how much we actually know.
 */
function bestNextAction({ sells, accepts, underContract, closes, fee, strategy, escalate }) {
  // Escalation wins — Rule 4.
  if (escalate) {
    return { action: 'escalate_to_human', reason: 'Overall confidence below threshold — route to operator review before acting.', confidence: 90 };
  }
  // No pricing yet → get the numbers that unlock every downstream prediction.
  if (accepts.value == null && fee?.suggested == null) {
    return { action: 'capture_pricing', reason: 'Set buyer price + seller cost to unlock acceptance, fee, and closing predictions.', confidence: 80 };
  }
  // High intent to sell, no deal moving → make the offer using the detected strategy.
  if (sells.value != null && sells.value >= 60 && (underContract.value == null || underContract.value < 50)) {
    return {
      action: 'present_offer',
      reason: `Seller likely to sell (${sells.value}%). Lead with ${strategy?.strategy || 'cash'} — ${strategy?.ranked?.[0]?.reason || 'best-fit play'}.`,
      confidence: 78,
    };
  }
  // Under contract, decent close odds → push the file to close.
  if (closes.value != null && closes.value >= 55) {
    return { action: 'drive_to_close', reason: `Strong close odds (${closes.value}%) — clear title + confirm buyer to lock it.`, confidence: 75 };
  }
  // Default — keep nurturing.
  return { action: 'nurture_followup', reason: 'Keep the seller warm; signals not yet strong enough to push.', confidence: 55 };
}

/**
 * Rule 3 — if outcome history is supplied (recent closed/failed deals of the same
 * strategy), nudge overall confidence: a track record of closing this play raises
 * confidence; repeated fallout lowers it. Absent history = no change.
 * @param {number} baseConf
 * @param {Array<{outcome:string, strategy?:string}>} outcomes
 * @param {string} strategy
 */
function applyOutcomeLearning(baseConf, outcomes, strategy) {
  if (!Array.isArray(outcomes) || outcomes.length === 0) return { conf: baseConf, note: null };
  const same = outcomes.filter(o => !strategy || !o.strategy || o.strategy === strategy);
  const pool = same.length ? same : outcomes;
  const closed = pool.filter(o => /clos|won|assigned|funded/i.test(o.outcome || '')).length;
  const failed = pool.filter(o => /fell|fail|dead|lost|cancel/i.test(o.outcome || '')).length;
  const n = closed + failed;
  if (n === 0) return { conf: baseConf, note: null };
  const winRate = closed / n;                       // 0..1
  const delta = Math.round((winRate - 0.5) * 16);   // ±8 max
  return {
    conf: Math.max(0, Math.min(100, baseConf + delta)),
    note: `outcome learning: ${closed}/${n} closed on ${strategy || 'recent'} deals → ${delta >= 0 ? '+' : ''}${delta} conf`,
  };
}

/**
 * MAIN — predict everything for a lead (+ optional best deal + outcome history).
 * @param {object} lead     joined lead row
 * @param {object} [deal]   the lead's most-advanced deal (for pricing/timeline)
 * @param {object} [opts]   { outcomes?:Array } recent deal_outcome_learning rows
 * @returns {object} unified prediction (see file header)
 */
function predict(lead, deal = null, opts = {}) {
  if (!lead || typeof lead !== 'object') {
    return {
      predictions: {}, best_next_action: { action: 'capture_lead', reason: 'No lead data.', confidence: 0 },
      overall_confidence: 0, escalate: true, evidence: [], rules_applied: ['rule1_no_fabrication'],
      generated_at: new Date().toISOString(),
    };
  }

  const strategy = detectStrategy(lead);               // best play + ranked fallbacks
  const fee = suggestAssignmentFee(deal || lead);      // null-safe; reads pricing fields

  const motivation    = predictMotivation(lead);
  const sells         = predictSells(lead, motivation);
  const accepts       = predictAcceptsOffer(lead, deal, motivation, fee);
  const underContract = predictUnderContract(sells, accepts);
  const closes        = predictCloses(underContract, lead, deal);
  const assignmentFee = predictAssignmentFee(fee);
  const closingDate   = predictClosingDate(deal);
  const falloutRisk   = predictFalloutRisk(closes, lead);

  // Overall confidence = mean of the confidences we actually computed (value != null).
  const computed = [motivation, sells, accepts, underContract, closes, assignmentFee, closingDate, falloutRisk]
    .filter(f => f.value != null);
  let overall = computed.length
    ? Math.round(computed.reduce((s, f) => s + f.confidence, 0) / computed.length)
    : 0;

  // Rule 3 — outcome learning nudge.
  const learned = applyOutcomeLearning(overall, opts.outcomes, strategy.strategy);
  overall = learned.conf;

  const escalate = overall < ESCALATE_BELOW;           // Rule 4

  // Rule 5 — expected value = P(closes) × suggested fee (when both exist).
  const expectedValue = (closes.value != null && fee?.suggested != null)
    ? Math.round((closes.value / 100) * fee.suggested)
    : null;

  const next = bestNextAction({ sells, accepts, underContract, closes, fee, strategy, escalate });

  // Flat evidence stream (Rule 2 + Rule 6 audit).
  const evidence = [
    `strategy: ${strategy.strategy} (${strategy.confidence}%) — ${strategy.ranked?.[0]?.reason || ''}`,
    ...motivation.evidence.map(e => `motivation: ${e}`),
    ...sells.evidence.map(e => `sells: ${e}`),
    ...accepts.evidence.map(e => `accepts: ${e}`),
    ...assignmentFee.evidence.map(e => `fee: ${e}`),
    ...(learned.note ? [learned.note] : []),
    ...(expectedValue != null ? [`expected value = P(close) ${closes.value}% × fee $${fee.suggested.toLocaleString()} = $${expectedValue.toLocaleString()}`] : []),
  ].filter(Boolean);

  return {
    lead_id: lead.id || null,
    deal_id: deal?.id || null,
    strategy: { primary: strategy.strategy, confidence: strategy.confidence, ranked: strategy.ranked },
    predictions: {
      motivation,
      sells,
      accepts_offer: accepts,
      under_contract: underContract,
      closes,
      assignment_fee: assignmentFee,
      closing_date: closingDate,
      fallout_risk: falloutRisk,
    },
    expected_value: expectedValue,
    best_next_action: next,
    overall_confidence: overall,
    escalate,
    evidence,
    rules_applied: [
      'rule1_no_fabrication', 'rule2_confidence_evidence', 'rule3_outcome_learning',
      'rule4_escalation', 'rule5_prioritize_ev', 'rule6_auditable', 'rule7_realtime',
    ],
    generated_at: new Date().toISOString(),
  };
}

module.exports = { predict, ESCALATE_BELOW };
