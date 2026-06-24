// ─── Buyer Score System (Feature 14) ────────────────────────────────────────
// Scores a cash buyer 0-100 on how reliable they are to actually close, so the
// dispo engine pitches the best deals to the strongest buyers first. Pure,
// deterministic, no DB/network — caller passes the buyer row (and optional
// closed-deal history). Mirrors the seller_trust_scores pattern but for the buy
// side.
//
// Signals (additive, capped at 100):
//   - Verified proof of funds            +25
//   - Signed non-circumvention agreement +15
//   - Defined buy box (states + types)   +15
//   - Repair tolerance set (not "any")   +10
//   - Closed deals with this operator    up to +25 (5 per close, cap 5)
//   - Recent activity (active flag)      +10
// Penalties:
//   - No phone AND no email              −20 (unreachable)
//   - Flagged as a tire-kicker           −15

function calculateBuyerScore(buyer = {}, opts = {}) {
  const { closedDeals = 0 } = opts;
  const signals = [];
  let score = 0;

  if (buyer.proof_of_funds_verified || buyer.pof_verified) {
    score += 25; signals.push('verified_proof_of_funds');
  } else if (buyer.proof_of_funds) {
    score += 10; signals.push('proof_of_funds_on_file');
  }

  if (buyer.nca_signed || buyer.non_circumvention_signed) {
    score += 15; signals.push('nca_signed');
  }

  const hasStates = Array.isArray(buyer.buy_box_states) && buyer.buy_box_states.length > 0;
  const hasTypes  = Array.isArray(buyer.buy_box_types)  && buyer.buy_box_types.length > 0;
  if (hasStates && hasTypes) { score += 15; signals.push('defined_buy_box'); }
  else if (hasStates || hasTypes) { score += 7; signals.push('partial_buy_box'); }

  if (buyer.repair_tolerance && buyer.repair_tolerance !== 'any') {
    score += 10; signals.push('repair_tolerance_set');
  }

  const closes = Math.max(0, Math.min(5, Number(closedDeals) || 0));
  if (closes > 0) { score += closes * 5; signals.push(`closed_${closes}_deals`); }

  if (buyer.is_active) { score += 10; signals.push('active'); }

  if (!buyer.phone && !buyer.email) { score -= 20; signals.push('unreachable'); }
  if (buyer.is_tire_kicker || buyer.flagged) { score -= 15; signals.push('flagged_tire_kicker'); }

  score = Math.max(0, Math.min(100, score));

  const tier = score >= 75 ? 'A' : score >= 50 ? 'B' : score >= 25 ? 'C' : 'D';

  return { score, tier, signals };
}

module.exports = { calculateBuyerScore };
