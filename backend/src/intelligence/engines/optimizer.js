// ─── Deal Optimizer ─────────────────────────────────────────────────────────
// Searches the feasible transaction space for a deal and ranks structures by the
// objective the OPERATOR selects. The optimizer never chooses the objective; a
// request without one is rejected. Every structure is computed by the calculation
// engine; infeasible ones are returned with the constraint that ruled them out.

const S = require('../calc/strategies');
const { round2, CalcError, num } = require('../calc/core');

const OBJECTIVES = {
  maximize_profit: { label: 'Maximize profit', key: 'profit', dir: -1 },
  minimize_cash_required: { label: 'Minimize cash required', key: 'cash_required', dir: 1 },
  minimize_risk: { label: 'Minimize risk', key: 'risk_score', dir: 1 },
  maximize_cash_flow: { label: 'Maximize monthly cash flow', key: 'monthly_cash_flow', dir: -1 },
  minimize_time_to_close: { label: 'Minimize time to close', key: 'days_to_close', dir: 1 },
};

const opt = (v, f, o) => (v === undefined || v === null || v === '' ? null : num(v, f, o));

// Price points to test between the seller's floor and the operator's ceiling.
function priceGrid(min, max, steps = 5) {
  if (min == null && max == null) return [];
  if (min == null) return [max];
  if (max == null || max <= min) return [min];
  return Array.from({ length: steps }, (_, i) => round2(min + ((max - min) * i) / (steps - 1)));
}

/**
 * @param {object} p
 * @param {string} p.objective                  one of OBJECTIVES (required)
 * @param {object} p.deal                       { arv, repairs, as_is_value, monthly_rent, existing_loan_balance, existing_monthly_payment }
 * @param {object} p.seller                     { min_price, min_cash_at_close, needs_debt_relief:boolean, max_close_days }
 * @param {object} p.operator                   { max_price, available_cash, min_profit, max_close_days, risk_tolerance:'low'|'medium'|'high' }
 * @param {object} [p.terms]                    lender/structure terms supplied by the operator
 * @param {object} [p.costs]                    { buy_closing_pct, sell_cost_pct, monthly_holding, holding_months, monthly_taxes, monthly_insurance, vacancy_pct, assignment_close_days, cash_close_days, financed_close_days }
 */
function optimize({ objective, deal = {}, seller = {}, operator = {}, terms = {}, costs = {} }) {
  if (!OBJECTIVES[objective]) throw new CalcError(`objective is required: one of ${Object.keys(OBJECTIVES).join(', ')}`, 'objective');
  const d = {
    arv: opt(deal.arv, 'deal.arv', { min: 0 }), repairs: opt(deal.repairs, 'deal.repairs', { min: 0 }),
    rent: opt(deal.monthly_rent, 'deal.monthly_rent', { min: 0 }),
    loan_balance: opt(deal.existing_loan_balance, 'deal.existing_loan_balance', { min: 0 }),
    loan_payment: opt(deal.existing_monthly_payment, 'deal.existing_monthly_payment', { min: 0 }),
    value: opt(deal.as_is_value, 'deal.as_is_value', { min: 0 }),
  };
  const sel = { min_price: opt(seller.min_price, 'seller.min_price', { min: 0 }), min_cash: opt(seller.min_cash_at_close, 'seller.min_cash_at_close', { min: 0 }), needs_debt_relief: seller.needs_debt_relief === true, max_close_days: opt(seller.max_close_days, 'seller.max_close_days', { min: 1 }) };
  const op = { max_price: opt(operator.max_price, 'operator.max_price', { min: 0 }), cash: opt(operator.available_cash, 'operator.available_cash', { min: 0 }), min_profit: opt(operator.min_profit, 'operator.min_profit', { min: 0 }) ?? 0, max_close_days: opt(operator.max_close_days, 'operator.max_close_days', { min: 1 }), risk_tolerance: ['low', 'medium', 'high'].includes(operator.risk_tolerance) ? operator.risk_tolerance : 'medium' };
  const c = {
    buy_closing_pct: opt(costs.buy_closing_pct, 'costs.buy_closing_pct', { min: 0, max: 100 }), sell_cost_pct: opt(costs.sell_cost_pct, 'costs.sell_cost_pct', { min: 0, max: 100 }),
    monthly_holding: opt(costs.monthly_holding, 'costs.monthly_holding', { min: 0 }), holding_months: opt(costs.holding_months, 'costs.holding_months', { min: 0 }),
    monthly_taxes: opt(costs.monthly_taxes, 'costs.monthly_taxes', { min: 0 }), monthly_insurance: opt(costs.monthly_insurance, 'costs.monthly_insurance', { min: 0 }),
    vacancy_pct: opt(costs.vacancy_pct, 'costs.vacancy_pct', { min: 0, max: 100 }),
    days: { assignment: opt(costs.assignment_close_days, 'costs.assignment_close_days', { min: 1 }), cash: opt(costs.cash_close_days, 'costs.cash_close_days', { min: 1 }), financed: opt(costs.financed_close_days, 'costs.financed_close_days', { min: 1 }) },
  };
  const maxDays = [sel.max_close_days, op.max_close_days].filter(x => x != null);
  const closeLimit = maxDays.length ? Math.min(...maxDays) : null;
  const prices = priceGrid(sel.min_price, op.max_price);
  const assumptions = [];
  if (!prices.length) assumptions.push('No seller minimum or operator maximum price supplied - price is not searched.');
  if (c.sell_cost_pct == null) assumptions.push('Selling cost % not supplied: 0% used in flip structures');
  if (c.monthly_holding == null) assumptions.push('Monthly holding cost not supplied: $0 used');
  if (Object.values(c.days).some(v => v == null)) assumptions.push('Days to close not supplied for some structures - time objective and close-date constraints skip those structures');

  const candidates = [];
  const infeasible = [];
  const reject = (structure, price, reason) => infeasible.push({ structure, price, reason });
  const riskOf = { wholesale_assignment: 1, cash_flip: 3, hard_money_flip: 4, subject_to: 5, seller_finance: 3, buy_hold_financed: 3 };
  const tolerance = { low: 2, medium: 4, high: 5 }[op.risk_tolerance];
  assumptions.push('Risk levels are a fixed structural ranking (1 lowest - 5 highest): wholesale assignment 1; cash flip, seller finance and financed rental 3; hard money flip 4; subject-to 5. Tolerance: low allows up to 2, medium up to 4, high up to 5.');

  const check = (structure, price, m, days) => {
    if (sel.min_price != null && price < sel.min_price) return reject(structure, price, `Below seller minimum ${sel.min_price}`);
    if (op.max_price != null && price > op.max_price) return reject(structure, price, `Above your maximum ${op.max_price}`);
    if (op.cash != null && m.cash_required > op.cash) return reject(structure, price, `Needs $${Math.round(m.cash_required).toLocaleString('en-US')} cash; you have $${Math.round(op.cash).toLocaleString('en-US')}`);
    if (m.profit != null && m.profit < op.min_profit) return reject(structure, price, `Profit $${Math.round(m.profit).toLocaleString('en-US')} below your minimum $${Math.round(op.min_profit).toLocaleString('en-US')}`);
    if (sel.min_cash != null && m.seller_cash_at_close != null && m.seller_cash_at_close < sel.min_cash) return reject(structure, price, `Seller gets $${Math.round(m.seller_cash_at_close).toLocaleString('en-US')} at close; needs $${Math.round(sel.min_cash).toLocaleString('en-US')}`);
    if (sel.needs_debt_relief && m.relieves_seller_debt === false) return reject(structure, price, 'Seller needs to be released from the existing loan; this structure leaves the loan in their name');
    if (closeLimit != null && days != null && days > closeLimit) return reject(structure, price, `Takes ${days} days to close; limit is ${closeLimit}`);
    if (riskOf[structure] > tolerance) return reject(structure, price, `Risk level ${riskOf[structure]}/5 exceeds your ${op.risk_tolerance} risk tolerance`);
    candidates.push({ structure, price, days_to_close: days, risk_score: riskOf[structure], ...m });
  };

  for (const price of prices) {
    // Wholesale assignment
    if (d.arv != null && d.repairs != null) {
      const w = S.wholesaleMao({ arv: d.arv, repairs: d.repairs, flip_factor_pct: terms.flip_factor_pct, assignment_fee: 0, closing_holding_buffer: 0 });
      const fee = round2(w.output.end_buyer_max_price - price);
      check('wholesale_assignment', price, { profit: fee, cash_required: opt(terms.emd, 'terms.emd', { min: 0 }) ?? 0, monthly_cash_flow: 0, seller_cash_at_close: price - (d.loan_balance || 0), relieves_seller_debt: true, calculation: w }, c.days.assignment);
    } else if (price === prices[0]) reject('wholesale_assignment', null, 'Needs ARV and repairs');

    // Cash fix & flip
    if (d.arv != null && d.repairs != null) {
      const f = S.fixFlip({ purchase_price: price, sale_price: d.arv, rehab: d.repairs, holding_months: c.holding_months ?? 0, monthly_holding: c.monthly_holding ?? 0, buy_closing_pct: c.buy_closing_pct ?? 0, sell_cost_pct: c.sell_cost_pct ?? 0 });
      check('cash_flip', price, { profit: f.output.profit, cash_required: f.output.cash_invested, monthly_cash_flow: 0, seller_cash_at_close: price - (d.loan_balance || 0), relieves_seller_debt: true, calculation: f }, c.days.cash);
      if (terms.hard_money?.rate_pct != null && terms.hard_money?.ltc_pct != null) {
        const loan = round2((price + d.repairs) * Number(terms.hard_money.ltc_pct) / 100);
        const hm = S.fixFlip({ purchase_price: price, sale_price: d.arv, rehab: d.repairs, holding_months: c.holding_months ?? 0, monthly_holding: c.monthly_holding ?? 0, buy_closing_pct: c.buy_closing_pct ?? 0, sell_cost_pct: c.sell_cost_pct ?? 0, loan_amount: loan, loan_rate_pct: terms.hard_money.rate_pct, loan_points_pct: terms.hard_money.points_pct ?? 0 });
        check('hard_money_flip', price, { profit: hm.output.profit, cash_required: Math.max(0, hm.output.cash_invested), monthly_cash_flow: 0, seller_cash_at_close: price - (d.loan_balance || 0), relieves_seller_debt: true, calculation: hm }, c.days.financed);
      }
    }

    // Subject-to
    if (d.loan_balance != null && d.loan_payment != null && (d.value ?? d.arv) != null) {
      const st = S.subjectTo({ purchase_price: price, existing_loan_balance: d.loan_balance, existing_monthly_piti: d.loan_payment, market_value: d.value ?? d.arv, monthly_rent: d.rent ?? 0 });
      check('subject_to', price, { profit: round2((d.value ?? d.arv) - price), cash_required: st.output.cash_needed_at_close, monthly_cash_flow: d.rent != null ? st.output.monthly_spread : null, seller_cash_at_close: st.output.cash_to_seller, relieves_seller_debt: false, calculation: st, note: 'Profit shown is equity captured at purchase, not cash' }, c.days.assignment);
    }

    // Seller finance
    if (terms.seller_finance?.rate_pct != null && terms.seller_finance?.down_payment_pct != null) {
      const t = terms.seller_finance;
      const sf = S.sellerFinance({ purchase_price: price, down_payment: round2(price * Number(t.down_payment_pct) / 100), rate_pct: t.rate_pct, amortization_months: t.amortization_months ?? 360, balloon_month: t.balloon_month ?? t.amortization_months ?? 360 });
      const monthlyCf = d.rent != null ? round2(d.rent * (1 - (c.vacancy_pct ?? 0) / 100) - sf.output.monthly_payment - (c.monthly_taxes ?? 0) - (c.monthly_insurance ?? 0)) : null;
      check('seller_finance', price, { profit: (d.value ?? d.arv) != null ? round2((d.value ?? d.arv) - price) : null, cash_required: round2(price * Number(t.down_payment_pct) / 100), monthly_cash_flow: monthlyCf, seller_cash_at_close: round2(price * Number(t.down_payment_pct) / 100) - (d.loan_balance || 0), relieves_seller_debt: (d.loan_balance || 0) === 0, calculation: sf, note: 'Profit shown is equity at purchase' }, c.days.assignment);
    }

    // Buy & hold with a conventional/DSCR loan
    if (d.rent != null && terms.rental_loan?.rate_pct != null && terms.rental_loan?.down_payment_pct != null && c.monthly_taxes != null && c.monthly_insurance != null && c.vacancy_pct != null) {
      const bh = S.buyHold({ purchase_price: price, down_payment_pct: terms.rental_loan.down_payment_pct, loan_rate_pct: terms.rental_loan.rate_pct, loan_term_months: terms.rental_loan.term_months ?? 360, initial_rehab: d.repairs ?? 0, monthly_rent: d.rent, vacancy_pct: c.vacancy_pct, monthly_taxes: c.monthly_taxes, monthly_insurance: c.monthly_insurance, management_pct: terms.rental_loan.management_pct, maintenance_pct: terms.rental_loan.maintenance_pct, capex_pct: terms.rental_loan.capex_pct });
      check('buy_hold_financed', price, { profit: bh.output.annual_cash_flow, cash_required: bh.output.cash_invested, monthly_cash_flow: bh.output.monthly_cash_flow, seller_cash_at_close: price - (d.loan_balance || 0), relieves_seller_debt: true, calculation: bh, note: 'Profit shown is annual cash flow' }, c.days.financed);
    }
  }

  const o = OBJECTIVES[objective];
  const ranked = candidates
    .filter(x => x[o.key] != null)
    .sort((a, b) => o.dir * (a[o.key] - b[o.key]) || b.profit - a.profit);
  const unscored = candidates.filter(x => x[o.key] == null).map(x => ({ structure: x.structure, price: x.price, reason: `No ${o.key.replace(/_/g, ' ')} figure for this structure with the inputs given` }));
  // Best per structure, so the list shows distinct options first.
  const bestPerStructure = [];
  const seen = new Set();
  for (const r of ranked) if (!seen.has(r.structure)) { seen.add(r.structure); bestPerStructure.push(r); }
  return {
    objective, objective_label: o.label, selected_by: 'operator',
    best: bestPerStructure[0] || null,
    options: bestPerStructure.map(({ calculation, ...rest }) => ({ ...rest, calculation })),
    all_feasible_count: candidates.length, infeasible: infeasible.slice(0, 60), unscored,
    assumptions, prices_searched: prices,
    note: 'Legal permissibility is not evaluated here: creative structures need attorney and title review before offering.',
  };
}

module.exports = { optimize, OBJECTIVES, priceGrid };
