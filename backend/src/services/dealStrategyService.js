/**
 * Deal Strategy Engine - evaluates every feasible exit path for a deal instead of
 * assuming one, and recommends the strongest with stated assumptions and risks.
 *
 * DETERMINISTIC: pure math over the deal/lead financials (ARV, repairs, price,
 * mortgage balance, equity, urgency) plus state wholesaling rules (stateCompliance).
 * No LLM call - the numbers are auditable and testable. Doctrine alignment
 * (masterOperatorService VALUATION): MAO = ARV x 70% - repairs, fee lives inside
 * the spread; never force a strategy the numbers don't support.
 *
 * Strategies compared: cash assignment, double close, novation, subject-to,
 * seller finance, lease option. Each returns { strategy, feasible, score 0-100,
 * rationale, assumptions[], risks[] }; the recommendation is the highest-scoring
 * feasible path. Surfaced via GET /api/deals/:id/strategies and reusable by agents.
 */

const { getStateCompliance } = require('../data/stateCompliance');

const pctOf = (a, b) => (b > 0 ? a / b : null);

function money(v) { return `$${Math.round(v).toLocaleString()}`; }

/**
 * @param {object} f  financials:
 *   arv, repairs, price (agreed/offer/asking - best known acquisition price),
 *   mortgageBalance, monthlyPayment, behindOnPayments (bool), urgent (bool),
 *   state (2-letter)
 * @returns {{ strategies: object[], recommended: object|null, inputs: object }}
 */
function evaluateStrategies(f = {}) {
  const arv      = Number(f.arv) || 0;
  const repairs  = Number(f.repairs) || 0;
  const price    = Number(f.price) || 0;
  const mortgage = Number(f.mortgageBalance) || 0;
  const urgent   = !!f.urgent;
  const behind   = !!f.behindOnPayments;
  const comp     = getStateCompliance(f.state);

  const mao    = arv > 0 ? Math.round(arv * 0.70 - repairs) : null;
  const spread = (mao != null && price > 0) ? mao - price : null;
  const equity = arv > 0 ? arv - mortgage : null;
  const equityPct = equity != null ? pctOf(equity, arv) : null;
  const lightRehab = arv > 0 ? repairs <= arv * 0.10 : false;

  const S = [];

  // ── Cash assignment ────────────────────────────────────────────────────────
  {
    const feasible = spread != null && spread > 0 && comp.assignment_legal !== false;
    let score = 0;
    if (feasible) {
      score = Math.min(95, 40 + Math.round((spread / Math.max(arv, 1)) * 400)); // spread depth drives it
      if (urgent) score += 5;                                                    // speed is the product
    }
    S.push({
      strategy: 'cash_assignment', feasible, score: Math.max(0, Math.min(100, score)),
      rationale: spread == null ? 'Missing ARV or price - cannot compute spread.'
        : spread <= 0 ? `Price ${money(price)} exceeds MAO ${money(mao)} - no assignable spread.`
        : comp.assignment_legal === false ? `${comp.state_name || f.state} restricts assignment - use double close.`
        : `Spread of ${money(spread)} under MAO ${money(mao)} supports a standard assignment.`,
      assumptions: [`ARV ${money(arv)} accurate`, `repairs ${money(repairs)} accurate`, 'end-buyer demand at MAO'],
      risks: comp.disclosure_required ? [`${comp.state_name || f.state} requires wholesale disclosure`] : [],
    });
  }

  // ── Double close ───────────────────────────────────────────────────────────
  {
    const closingCost = price > 0 ? Math.max(2000, price * 0.015) : 0;
    const netSpread = spread != null ? spread - closingCost : null;
    const feasible = netSpread != null && netSpread > 0;
    let score = feasible ? Math.min(90, 30 + Math.round((netSpread / Math.max(arv, 1)) * 400)) : 0;
    if (feasible && comp.assignment_legal === false) score += 25; // the play when assignment is restricted
    S.push({
      strategy: 'double_close', feasible, score: Math.max(0, Math.min(100, score)),
      rationale: !feasible ? 'Spread does not survive the second closing cost.'
        : comp.assignment_legal === false ? `Assignment restricted in ${comp.state_name || f.state} - double close is the compliant exit (net ${money(netSpread)}).`
        : `Viable (net ${money(netSpread)} after ~${money(closingCost)} extra closing) - use when fee privacy matters.`,
      assumptions: ['transactional funding or cash available for the A-B leg'],
      risks: ['second set of closing costs', 'both legs must fund the same day'],
    });
  }

  // ── Novation ───────────────────────────────────────────────────────────────
  {
    // Needs true retail upside with only light work: resell near ARV, pay commissions.
    const retailNet = arv > 0 ? arv * 0.94 - repairs : null; // ~6% agent+concessions
    const novationSpread = retailNet != null && price > 0 ? retailNet - price : null;
    const feasible = novationSpread != null && novationSpread > 0 && lightRehab;
    const score = feasible ? Math.min(85, 25 + Math.round((novationSpread / Math.max(arv, 1)) * 300)) : 0;
    S.push({
      strategy: 'novation', feasible, score,
      rationale: !lightRehab ? 'Repairs too heavy for a retail-facing novation.'
        : novationSpread == null ? 'Missing numbers for retail math.'
        : novationSpread <= 0 ? 'No spread left after retail commissions and light reno.'
        : `Retail resale nets ~${money(novationSpread)} over the seller's price with only light work.`,
      assumptions: ['strong retail market (buyers paying near list)', 'seller agrees to the novation structure transparently'],
      risks: ['resale risk if the retail market softens', 'longer timeline than assignment'],
    });
  }

  // ── Subject-to ─────────────────────────────────────────────────────────────
  {
    // Shines when the mortgage eats the spread (low equity) - take over payments.
    const feasible = mortgage > 0 && (equityPct == null || equityPct < 0.25);
    const score = feasible ? (behind ? 80 : 65) : 0;
    S.push({
      strategy: 'subject_to', feasible, score,
      rationale: mortgage <= 0 ? 'No underlying mortgage - nothing to take subject-to.'
        : !feasible ? 'Healthy equity - a cash structure captures it more cleanly.'
        : `Low equity (${equityPct != null ? Math.round(equityPct * 100) + '%' : 'unknown'}) - taking over the ${money(mortgage)} loan beats a cash discount the seller can't give.${behind ? ' Arrears cure is the lever.' : ''}`,
      assumptions: ['existing financing rate worth keeping', 'insurance + servicing set up correctly, fully disclosed'],
      risks: ['due-on-sale clause (rarely called on performing loans, never guarantee)', 'seller credit stays attached until payoff'],
    });
  }

  // ── Seller finance ─────────────────────────────────────────────────────────
  {
    const feasible = mortgage === 0 && arv > 0 && !urgent;
    const score = feasible ? 60 : 0;
    S.push({
      strategy: 'seller_finance', feasible, score,
      rationale: mortgage > 0 ? 'Existing mortgage complicates seller carryback (wrap territory - human review).'
        : urgent ? 'Seller needs cash now - terms play does not fit the timeline.'
        : feasible ? 'Free-and-clear seller with no urgency - terms can beat a cash discount for both sides.' : 'Missing numbers.',
      assumptions: ['seller open to payments over time', 'compliant note terms (attorney-drafted)'],
      risks: ['SAFE Act / Dodd-Frank compliance on owner-occupied', 'long-tail default management'],
    });
  }

  // ── Lease option ───────────────────────────────────────────────────────────
  {
    const thin = spread != null && spread <= 0;
    const feasible = thin && !urgent && mortgage >= 0;
    const score = feasible ? 40 : 0;
    S.push({
      strategy: 'lease_option', feasible, score,
      rationale: feasible ? 'No wholesale spread and no urgency - control now, equity later via the option.'
        : 'Stronger paths available (or urgency rules out a slow play).',
      assumptions: ['seller comfortable staying on title during the option period'],
      risks: ['tenant-buyer non-performance', 'state-specific option regulations'],
    });
  }

  const feasiblePaths = S.filter(s => s.feasible).sort((a, b) => b.score - a.score);
  return {
    inputs: { arv, repairs, price, mao, spread, mortgage, equity, equityPct: equityPct != null ? Math.round(equityPct * 100) : null, state: f.state || null, urgent, behind },
    strategies: S.sort((a, b) => b.score - a.score),
    recommended: feasiblePaths[0] || null,
  };
}

// Convenience: build financials from a deal row + its lead row.
function financialsFromDeal(deal = {}, lead = {}) {
  return {
    arv: deal.arv || lead.estimated_arv || lead.estimated_value,
    repairs: deal.repair_estimate || lead.repair_estimate || 0,
    price: deal.seller_agreed_price || deal.offer_price || lead.agreed_price || lead.offer_price || lead.seller_counter,
    mortgageBalance: lead.mortgage_balance || 0,
    monthlyPayment: lead.monthly_payment || 0,
    behindOnPayments: !!lead.is_behind_on_payments,
    urgent: !!lead.is_behind_on_payments || String(lead.lead_temperature || '').toLowerCase() === 'hot',
    state: deal.property_state || lead.property_state,
  };
}

module.exports = { evaluateStrategies, financialsFromDeal };
