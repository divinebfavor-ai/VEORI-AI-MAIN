/**
 * Creative-finance calculator — the math behind non-cash acquisition strategies
 * (Subject-To, Seller Finance, Lease-Option). Kept in its own file so it's pure,
 * testable, and never touches the cash/wholesale path (that stays in
 * repairEstimator.calculateScenarios). ADDITIVE: profitCalc only calls these when
 * the request asks for a creative `strategy`; a cash request never reaches here.
 *
 * Every function is pure, never throws, and returns null fields when an input is
 * missing rather than fabricating a number — the UI prompts for what's missing.
 */

const round = n => (n == null || Number.isNaN(n) ? null : Math.round(n));

/**
 * Amortized monthly principal + interest.
 * @param {number} principal financed balance
 * @param {number} annualRatePct e.g. 6 for 6%
 * @param {number} termYears
 * @returns {number|null}
 */
function monthlyPI(principal, annualRatePct, termYears) {
  if (!principal || principal <= 0 || !termYears || termYears <= 0) return null;
  const r = (Number(annualRatePct) || 0) / 100 / 12;
  const n = termYears * 12;
  if (r <= 0) return round(principal / n);
  return round((principal * r) / (1 - Math.pow(1 + r, -n)));
}

/**
 * SUBJECT-TO: take over the existing loan. Your "investment" is the cash to the
 * seller + arrears you reinstate; the bulk of the price stays in the existing loan.
 */
function subjectTo({ arv = 0, mortgage_balance = 0, arrears_amount = 0,
                     est_monthly_payment = 0, interest_rate = null,
                     cash_to_seller = null, rehab = 0 }) {
  const equity = arv > 0 ? Math.max(0, arv - mortgage_balance) : null;
  // Default seller payout = 30% of equity if the operator didn't set one.
  const toSeller = cash_to_seller != null
    ? Number(cash_to_seller)
    : (equity != null ? Math.round(equity * 0.30) : null);
  const cashInDeal = (toSeller || 0) + (Number(arrears_amount) || 0) + (Number(rehab) || 0);
  return {
    strategy: 'subject_to',
    arv: arv || null,
    existing_loan_balance: mortgage_balance || null,
    est_equity: round(equity),
    arrears_to_reinstate: Number(arrears_amount) || 0,
    cash_to_seller: round(toSeller),
    est_monthly_payment: Number(est_monthly_payment) || null,
    interest_rate: interest_rate != null ? Number(interest_rate) : null,
    cash_in_deal: round(cashInDeal),     // total cash you bring
    note: 'You take over the existing payments; cash-in-deal is seller payout + arrears + any rehab.',
  };
}

/**
 * SELLER FINANCE: owner carries the note. Higher headline price is possible
 * because the terms are financed.
 */
function sellerFinance({ arv = 0, price = null, down_percent = 10, down_payment = null,
                         rate = 6, term_years = 30, balloon_years = null, rehab = 0 }) {
  const purchase = price != null ? Number(price) : (arv > 0 ? Math.round(arv * 0.90) : null);
  const down = down_payment != null
    ? Number(down_payment)
    : (purchase != null ? Math.round(purchase * ((Number(down_percent) || 0) / 100)) : null);
  const financed = (purchase != null && down != null) ? purchase - down : null;
  const monthly = financed != null ? monthlyPI(financed, rate, term_years) : null;
  let balloon_balance = null;
  if (financed != null && balloon_years && monthly) {
    // Remaining balance after balloon_years of payments.
    const r = (Number(rate) || 0) / 100 / 12;
    const paid = balloon_years * 12;
    balloon_balance = r > 0
      ? round(financed * Math.pow(1 + r, paid) - monthly * ((Math.pow(1 + r, paid) - 1) / r))
      : round(financed - monthly * paid);
  }
  return {
    strategy: 'seller_finance',
    arv: arv || null,
    purchase_price: round(purchase),
    down_payment: round(down),
    down_percent: Number(down_percent) || null,
    interest_rate: Number(rate) || 0,
    term_years: Number(term_years) || null,
    financed_amount: round(financed),
    monthly_payment: monthly,
    balloon_years: balloon_years || null,
    balloon_balance,
    cash_in_deal: round((down || 0) + (Number(rehab) || 0)),
    note: 'Owner carries the note: down + monthly P&I; optional balloon balance shown.',
  };
}

/**
 * LEASE-OPTION: control now via a lease, buy at a set price later.
 */
function leaseOption({ arv = 0, option_price = null, option_fee = null,
                       lease_monthly = null, option_months = 24,
                       market_rent = null }) {
  const optPrice = option_price != null ? Number(option_price) : (arv > 0 ? Math.round(arv * 0.95) : null);
  const optFee = option_fee != null ? Number(option_fee) : (optPrice != null ? Math.round(optPrice * 0.03) : null);
  const lease = lease_monthly != null ? Number(lease_monthly) : (market_rent != null ? Number(market_rent) : null);
  return {
    strategy: 'lease_option',
    arv: arv || null,
    option_price: round(optPrice),       // future purchase price
    option_fee: round(optFee),           // up-front non-refundable
    lease_monthly: round(lease),
    option_months: Number(option_months) || 24,
    cash_in_deal: round(optFee),
    note: 'Option fee is your cash in; lease covers carry; option price locks the future buy.',
  };
}

/**
 * NOVATION: you contract the property at one price, then re-paper (novate) the deal
 * and resell at a near-retail price — profit is the SPREAD between your locked
 * acquisition price and the resale, minus light reno, agent commission, and closing.
 * Best for fixed-up-but-overpriced / agent-listed / FSBO sellers who want near
 * retail and won't take a wholesale lowball. Pure, never throws, null when missing.
 */
function novation({ arv = 0, list_price = null, repairs = 0, agent_pct = 6,
                    target_resale = null, closing_pct = 2 }) {
  // Resale = explicit target, else ARV (retail), else nothing to compute against.
  const resale = target_resale != null ? Number(target_resale) : (arv > 0 ? Number(arv) : null);
  // Your acquisition = the price you lock with the seller (their list/ask).
  const acquisition = list_price != null ? Number(list_price) : null;
  const reno = Number(repairs) || 0;
  const agentPct = Number(agent_pct);
  const closingPct = Number(closing_pct);
  // Costs scale off the resale (commission + closing are paid at the retail sale).
  const agentCost = resale != null ? round(resale * ((Number.isNaN(agentPct) ? 6 : agentPct) / 100)) : null;
  const closingCost = resale != null ? round(resale * ((Number.isNaN(closingPct) ? 2 : closingPct) / 100)) : null;
  let netSpread = null;
  if (resale != null && acquisition != null) {
    netSpread = round(resale - acquisition - reno - (agentCost || 0) - (closingCost || 0));
  }
  return {
    strategy: 'novation',
    arv: arv || null,
    resale_price: round(resale),          // near-retail price you re-sell at
    acquisition_price: round(acquisition), // price you lock with the seller
    reno_estimate: reno || null,           // light, cosmetic work to list-ready
    agent_commission: agentCost,
    closing_costs: closingCost,
    net_spread: netSpread,                 // your profit after the resale costs
    note: 'Lock the contract, re-paper (novate), resell near retail; profit is the spread after light reno + agent + closing.',
  };
}

/**
 * Dispatch by strategy. Returns null for cash/unknown so the caller keeps the
 * existing cash response untouched.
 */
function calculateCreative(strategy, inputs = {}) {
  switch (String(strategy || '').toLowerCase()) {
    case 'subject_to':     return subjectTo(inputs);
    case 'seller_finance': return sellerFinance(inputs);
    case 'lease_option':   return leaseOption(inputs);
    case 'novation':       return novation(inputs);
    default:               return null; // cash / unknown → no creative block
  }
}

module.exports = { calculateCreative, subjectTo, sellerFinance, leaseOption, novation, monthlyPI };
