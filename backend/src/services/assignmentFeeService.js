/**
 * Assignment Fee Service - the AI per-deal fee SUGGESTER.
 *
 * The operator's directive: an assignment fee must NOT have a fixed number or a
 * fixed band (it is NOT "5k–25k"). It varies per deal by how the deal is being
 * done - the spread available, seller motivation, and deal economics. Veori should
 * be the best negotiator and bring out the best from each deal.
 *
 * So this service does NOT hardcode a dollar figure. It DERIVES a suggested fee from
 * the deal's own spread and shapes it by signal (spread size, seller motivation). It
 * returns the suggestion PLUS the basis (the inputs + a reason) so the operator can
 * see WHY and decide. Pure, synchronous, null-safe - never throws, never calls out.
 *
 * It is a SUGGESTER, not an enforcer: it writes nothing. The route layer decides
 * whether to surface it or persist it (assignment_fee_suggested / assignment_fee_basis).
 */

const { dealAskPrice } = require('./buyerDispoService');

/**
 * The price the seller side costs us - what we're under contract to pay the seller.
 * Prefer the agreed price, else the offer, else null (unknown).
 */
function sellerCost(deal) {
  if (deal?.seller_agreed_price) return Number(deal.seller_agreed_price);
  if (deal?.offer_price)        return Number(deal.offer_price);
  return null;
}

/**
 * A 0..1 motivation factor. Higher motivation (distressed / fast-need seller) lets
 * us hold MORE of the spread as fee (the seller's pain is solved by speed, not price
 * shaving), so we lean the share UP. Lower / unknown motivation leans it toward the
 * middle. Reads optional signals that may or may not be present on the joined deal;
 * absent signals collapse to the neutral default - never throws.
 */
function motivationFactor(deal) {
  // deal_velocity_score (0..100) is the closest existing motivation proxy on a deal.
  const v = Number(deal?.deal_velocity_score);
  if (Number.isFinite(v) && v > 0) return Math.max(0, Math.min(1, v / 100));
  return 0.5; // neutral - no signal
}

/**
 * Suggest a per-deal assignment fee from the spread. No fixed band.
 *
 * Spread = buyer-side ask − seller-side cost. We propose a SHARE of that spread as
 * the fee, where the share floats with the spread size and seller motivation:
 *   - thin spread  → take a larger share (otherwise the deal isn't worth doing)
 *   - fat spread   → take a smaller share (leave room so the buyer still wins)
 *   - high motivation → nudge the share up (speed is the value we're selling)
 * The result is bounded only by the spread itself (fee can never exceed spread),
 * never by an arbitrary dollar ceiling.
 *
 * @param {object} deal  a deals row (ideally joined); needs pricing fields
 * @returns {{ suggested:number|null, floor:number|null, ceiling:number|null, basis:object }}
 */
function suggestAssignmentFee(deal) {
  const ask  = dealAskPrice(deal);
  const cost = sellerCost(deal);

  // Without both sides we cannot derive a spread - return a null suggestion with a
  // reason, so the UI shows "need buyer price + seller cost" instead of a fake number.
  if (ask == null || cost == null) {
    return {
      suggested: null,
      floor:     null,
      ceiling:   null,
      basis: {
        spread:      null,
        ask,
        seller_cost: cost,
        arv:         deal?.arv != null ? Number(deal.arv) : null,
        mao:         deal?.mao != null ? Number(deal.mao) : null,
        reason:      'Insufficient pricing - set a buyer price and seller/offer price to derive the spread.',
      },
    };
  }

  const spread = Math.max(0, ask - cost);
  if (spread <= 0) {
    return {
      suggested: 0,
      floor:     0,
      ceiling:   0,
      basis: {
        spread:      0,
        ask,
        seller_cost: cost,
        arv:         deal?.arv != null ? Number(deal.arv) : null,
        mao:         deal?.mao != null ? Number(deal.mao) : null,
        reason:      'No spread between buyer ask and seller cost - no fee room without renegotiating.',
      },
    };
  }

  // Base share scales DOWN as the spread grows (thin deals must keep more; fat deals
  // leave more for the buyer). A simple smooth curve: 60% at tiny spreads tapering
  // toward ~30% as spreads get large. Tuned, not fixed-dollar.
  let share;
  if      (spread <= 10000)  share = 0.60;
  else if (spread <= 25000)  share = 0.50;
  else if (spread <= 50000)  share = 0.42;
  else if (spread <= 100000) share = 0.36;
  else                       share = 0.30;

  // Motivation nudge: ±10% of the share, centered on neutral (0.5).
  const motivation = motivationFactor(deal);
  share = share * (1 + (motivation - 0.5) * 0.2);
  share = Math.max(0.15, Math.min(0.75, share)); // sane guardrails on the SHARE, not the $

  const suggested = Math.round((spread * share) / 50) * 50; // round to nearest $50
  const floor     = Math.round((spread * Math.max(0.15, share - 0.12)) / 50) * 50;
  const ceiling   = Math.min(spread, Math.round((spread * Math.min(0.85, share + 0.12)) / 50) * 50);

  return {
    suggested,
    floor,
    ceiling,
    basis: {
      spread,
      ask,
      seller_cost: cost,
      arv:         deal?.arv != null ? Number(deal.arv) : null,
      mao:         deal?.mao != null ? Number(deal.mao) : null,
      share:       Number(share.toFixed(3)),
      motivation:  Number(motivation.toFixed(2)),
      reason:      `Suggested ${Math.round(share * 100)}% of a $${spread.toLocaleString()} spread `
                 + `(motivation ${Math.round(motivation * 100)}%). Range $${floor.toLocaleString()}–$${ceiling.toLocaleString()}.`,
    },
  };
}

module.exports = { suggestAssignmentFee, sellerCost };
