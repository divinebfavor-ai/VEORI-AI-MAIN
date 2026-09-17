// ─── Scenario Engine ────────────────────────────────────────────────────────
// Runs a deal's strategy under named scenarios. Each scenario is a set of explicit
// shocks applied to the operator's base inputs, then recomputed by the calculation
// engine. The default shocks are assumptions shown with every result and can be
// replaced per request. Results are "Under this scenario...", never predictions.

const S = require('../calc/strategies');
const { round2, CalcError } = require('../calc/core');

// Shock fields: arv_pct / sale_price_pct, rehab_pct, hold_months_add, rate_add_pts,
// points_add_pts, rent_pct, vacancy_add_pts, exit_extra_months, exit_price_pct.
const DEFAULT_SCENARIOS = {
  base: { label: 'Base case', shocks: {} },
  upside: { label: 'Upside case', shocks: { arv_pct: 5, rehab_pct: -5, hold_months_add: -1, rent_pct: 5 } },
  downside: { label: 'Downside case', shocks: { arv_pct: -10, rehab_pct: 15, hold_months_add: 2, rent_pct: -10, vacancy_add_pts: 3 } },
  stress: { label: 'Stress case', shocks: { arv_pct: -20, rehab_pct: 30, hold_months_add: 6, rate_add_pts: 2, rent_pct: -15, vacancy_add_pts: 7 } },
  exit_failure: { label: 'Exit failure case', shocks: { exit_extra_months: 12, exit_price_pct: -15 } },
  financing_change: { label: 'Financing change case', shocks: { rate_add_pts: 3, points_add_pts: 1 } },
  market_change: { label: 'Market change case', shocks: { arv_pct: -15, rent_pct: -8, hold_months_add: 3 } },
  construction_overrun: { label: 'Construction overrun case', shocks: { rehab_pct: 40, hold_months_add: 3 } },
  extended_hold: { label: 'Extended hold case', shocks: { hold_months_add: 12 } },
  price_decline: { label: 'Price decline case', shocks: { arv_pct: -25 } },
};

const pct = (v, p) => (p ? v * (1 + p / 100) : v);

function describeShocks(sh) {
  const parts = [];
  if (sh.arv_pct) parts.push(`ARV/sale price ${sh.arv_pct > 0 ? '+' : ''}${sh.arv_pct}%`);
  if (sh.rehab_pct) parts.push(`rehab ${sh.rehab_pct > 0 ? '+' : ''}${sh.rehab_pct}%`);
  if (sh.hold_months_add) parts.push(`holding ${sh.hold_months_add > 0 ? '+' : ''}${sh.hold_months_add} month(s)`);
  if (sh.rate_add_pts) parts.push(`interest rate +${sh.rate_add_pts} pts`);
  if (sh.points_add_pts) parts.push(`loan points +${sh.points_add_pts} pts`);
  if (sh.rent_pct) parts.push(`rent ${sh.rent_pct > 0 ? '+' : ''}${sh.rent_pct}%`);
  if (sh.vacancy_add_pts) parts.push(`vacancy +${sh.vacancy_add_pts} pts`);
  if (sh.exit_extra_months) parts.push(`planned sale fails: sold ${sh.exit_extra_months} months later at ${sh.exit_price_pct || 0}% of planned price change`);
  return parts.length ? parts : ['No changes from your inputs'];
}

function flipScenario(base, sh) {
  const hold = Math.max(0, Number(base.holding_months) + (sh.hold_months_add || 0) + (sh.exit_extra_months || 0));
  const salePrice = pct(pct(Number(base.sale_price), sh.arv_pct), sh.exit_price_pct);
  const input = {
    ...base,
    sale_price: salePrice,
    rehab: pct(Number(base.rehab), sh.rehab_pct),
    holding_months: hold,
    loan_rate_pct: base.loan_rate_pct != null ? Number(base.loan_rate_pct) + (sh.rate_add_pts || 0) : (sh.rate_add_pts ? sh.rate_add_pts : base.loan_rate_pct),
    loan_points_pct: base.loan_points_pct != null ? Number(base.loan_points_pct) + (sh.points_add_pts || 0) : base.loan_points_pct,
  };
  const c = S.fixFlip(input);
  const o = c.output;
  return {
    calculation: c,
    metrics: {
      timeline_months: hold, capital_required: o.cash_invested, revenue: round2(salePrice),
      expenses: round2(o.total_cost - input.purchase_price), debt: Number(input.loan_amount || 0),
      profit_loss: o.profit, roi_pct: o.roi_pct, exit_value: round2(salePrice),
      equity_at_exit: round2(salePrice - Number(input.loan_amount || 0)),
    },
  };
}

function holdScenario(base, sh) {
  const input = {
    ...base,
    monthly_rent: pct(Number(base.monthly_rent), sh.rent_pct),
    vacancy_pct: Math.min(100, Number(base.vacancy_pct) + (sh.vacancy_add_pts || 0)),
    loan_rate_pct: Number(base.loan_rate_pct) + (sh.rate_add_pts || 0),
  };
  const c = S.buyHold(input);
  const o = c.output;
  const value = base.property_value != null ? pct(Number(base.property_value), sh.arv_pct) : null;
  return {
    calculation: c,
    metrics: {
      timeline_months: base.hold_years ? Number(base.hold_years) * 12 : null, capital_required: o.cash_invested,
      revenue: round2(o.effective_monthly_income * 12), expenses: round2(o.monthly_operating_expenses * 12), debt: o.loan_amount,
      profit_loss: o.annual_cash_flow, annual_noi: o.annual_noi, cash_on_cash_pct: o.cash_on_cash_pct, dscr: o.dscr,
      exit_value: value == null ? null : round2(value), equity_at_exit: value == null ? null : round2(value - o.loan_amount),
    },
  };
}

function wholesaleScenario(base, sh) {
  const arv = pct(Number(base.arv), sh.arv_pct);
  const repairs = pct(Number(base.repairs), sh.rehab_pct);
  const c = S.wholesaleMao({ arv, repairs, flip_factor_pct: base.flip_factor_pct, assignment_fee: base.assignment_fee, closing_holding_buffer: base.closing_holding_buffer });
  const contract = base.contract_price != null ? Number(base.contract_price) : null;
  const fee = contract == null ? null : round2(c.output.end_buyer_max_price - contract);
  return {
    calculation: c,
    metrics: {
      timeline_months: null, capital_required: base.emd != null ? Number(base.emd) : null, revenue: fee, expenses: null, debt: 0,
      profit_loss: fee, mao: c.output.mao, end_buyer_max_price: c.output.end_buyer_max_price, exit_value: c.output.end_buyer_max_price,
      contract_still_works: contract == null ? null : fee >= 0,
    },
  };
}

const RUNNERS = { fix_flip: flipScenario, buy_hold: holdScenario, wholesale: wholesaleScenario };

function scenarioRisks(strategy, m, base) {
  const r = [];
  if (m.profit_loss != null && m.profit_loss < 0) r.push(strategy === 'buy_hold' ? 'Negative annual cash flow - the property needs cash every month.' : 'Loss on the deal.');
  if (m.dscr != null && m.dscr < 1.2) r.push(`DSCR ${m.dscr} is below 1.20, the minimum many DSCR lenders require.`);
  if (m.contract_still_works === false) r.push('The contract price is above what an end buyer would pay; the assignment fee is gone.');
  if (strategy === 'fix_flip' && m.roi_pct != null && m.roi_pct < 10 && m.profit_loss >= 0) r.push('Return under 10% on cash invested for the risk taken.');
  if (strategy === 'fix_flip' && Number(base.loan_amount) > 0 && m.timeline_months > 12) r.push('Hold exceeds 12 months; many short-term loans mature in 6-12 months.');
  return r;
}

/**
 * @param {object} p
 * @param {'fix_flip'|'buy_hold'|'wholesale'} p.strategy
 * @param {object} p.base        strategy inputs (see calc/strategies)
 * @param {object} [p.scenarios] scenario key -> shocks override; unknown keys add custom scenarios
 */
function run({ strategy, base, scenarios = {} }) {
  const runner = RUNNERS[strategy];
  if (!runner) throw new CalcError('strategy must be fix_flip, buy_hold or wholesale', 'strategy');
  if (!base || typeof base !== 'object') throw new CalcError('base inputs are required', 'base');
  const defs = { ...DEFAULT_SCENARIOS };
  for (const [k, v] of Object.entries(scenarios || {})) {
    if (!/^[a-z_]{2,40}$/.test(k)) throw new CalcError(`Invalid scenario key ${k}`, 'scenarios');
    const shocks = v?.shocks || v || {};
    for (const [sk, sv] of Object.entries(shocks)) if (!Number.isFinite(Number(sv))) throw new CalcError(`${k}.${sk} must be a number`, 'scenarios');
    defs[k] = { label: v?.label || defs[k]?.label || k.replace(/_/g, ' '), shocks: Object.fromEntries(Object.entries(shocks).map(([a, b]) => [a, Number(b)])), custom: !DEFAULT_SCENARIOS[k] || !!v };
  }
  const baseResult = runner(base, {});
  const results = Object.entries(defs).map(([key, def]) => {
    const r = runner(base, def.shocks);
    const m = r.metrics;
    const delta = m.profit_loss != null && baseResult.metrics.profit_loss != null ? round2(m.profit_loss - baseResult.metrics.profit_loss) : null;
    return {
      key, label: def.label, assumptions: describeShocks(def.shocks), shocks: def.shocks, overridden: !!def.custom,
      metrics: m, change_vs_base: delta,
      narrative: `Under this scenario (${describeShocks(def.shocks).join('; ')}), ${strategy === 'buy_hold' ? 'annual cash flow' : strategy === 'wholesale' ? 'the assignment fee' : 'profit'} would be ${m.profit_loss == null ? 'unknown (needs a contract price)' : `$${Math.round(m.profit_loss).toLocaleString('en-US')}`}${delta ? ` (${delta > 0 ? '+' : ''}$${Math.round(delta).toLocaleString('en-US')} vs base)` : ''}.`,
      risks: scenarioRisks(strategy, m, base),
      calculation: r.calculation,
    };
  });
  const losing = results.filter(r => r.metrics.profit_loss != null && r.metrics.profit_loss < 0).map(r => r.label);
  return {
    strategy, base_inputs: base, scenarios: results,
    summary: losing.length ? `The deal loses money under: ${losing.join(', ')}.` : 'The deal stays profitable under every modeled scenario.',
    disclaimer: 'Scenarios apply stated changes to your inputs. They show what would happen under those assumptions, not what will happen.',
  };
}

module.exports = { run, DEFAULT_SCENARIOS, describeShocks };
