// ─── Break-even engine ────────────────────────────────────────────────────────
// For each strategy, the exact value of one input where the economics stop working
// (profit = target, cash flow = 0, DSCR = minimum), holding every other input fixed.
// Solved numerically against the same strategy formulas the Deal Room displays, so
// the break-even always agrees with the headline numbers.

const { calc, round2, round4, solveMonotonic, CalcError } = require('./core');
const S = require('./strategies');

function point(label, field, value, meaning, unit = 'usd') {
  return { label, field, value: value == null ? null : (unit === 'usd' ? round2(value) : round4(value)), unit, meaning,
    reachable: value != null };
}

// Fix & flip: max purchase, min sale, max rehab, max months, max rate, break-even ARV.
function fixFlipBreakEven(input, { target_profit = 0 } = {}) {
  const base = S.fixFlip(input); // validates
  const profitWith = (patch) => S.fixFlip({ ...input, ...patch }).output.profit;
  const t = Number(target_profit) || 0;
  const sale = Number(input.sale_price);
  const points = [
    point('Maximum purchase price', 'purchase_price',
      solveMonotonic(x => profitWith({ purchase_price: x }), 0, Math.max(sale * 2, 1), t),
      `Above this purchase price, profit falls below $${t.toLocaleString()}`),
    point('Minimum sale price (break-even ARV)', 'sale_price',
      solveMonotonic(x => profitWith({ sale_price: x }), 0, Math.max(sale * 3, 1), t),
      `Below this sale price, profit falls below $${t.toLocaleString()}`),
    point('Maximum rehab budget', 'rehab',
      solveMonotonic(x => profitWith({ rehab: x }), 0, Math.max(sale * 2, 1), t),
      'Rehab overruns beyond this amount erase the target profit'),
    point('Maximum holding period (months)', 'holding_months',
      solveMonotonic(x => profitWith({ holding_months: x }), 0, 240, t),
      'Each extra month adds holding and interest cost; beyond this the target profit is gone', 'months'),
  ];
  if (Number(input.loan_amount) > 0) {
    points.push(point('Maximum loan interest rate', 'loan_rate_pct',
      solveMonotonic(x => profitWith({ loan_rate_pct: x }), 0, 100, t),
      'Above this rate, financing cost erases the target profit', 'pct'));
  }
  return calc('fix_flip_break_even', { ...base.inputs, target_profit: t },
    'for each input: solve fixFlip(input with that field = x).profit = target, all other inputs fixed',
    { current_profit: base.output.profit, break_even_points: points },
    ['One input varies at a time; "reachable: false" means no value in the search range hits the target']);
}

// Buy & hold: min rent, break-even occupancy, max rate, max purchase price (cash flow ≥ target).
function buyHoldBreakEven(input, { target_monthly_cash_flow = 0 } = {}) {
  const base = S.buyHold(input);
  const cf = (patch) => S.buyHold({ ...input, ...patch }).output.monthly_cash_flow;
  const t = Number(target_monthly_cash_flow) || 0;
  const rent = Number(input.monthly_rent);
  const price = Number(input.purchase_price);
  const vacancyBreakEven = solveMonotonic(x => cf({ vacancy_pct: x }), 0, 100, t);
  return calc('buy_hold_break_even', { ...base.inputs, target_monthly_cash_flow: t },
    'for each input: solve buyHold(input with that field = x).monthly_cash_flow = target',
    {
      current_monthly_cash_flow: base.output.monthly_cash_flow,
      break_even_points: [
        point('Minimum monthly rent', 'monthly_rent', solveMonotonic(x => cf({ monthly_rent: x }), 0, Math.max(rent * 5, 10000), t),
          'Below this rent, monthly cash flow falls below target'),
        point('Break-even occupancy', 'occupancy_pct', vacancyBreakEven == null ? null : 100 - vacancyBreakEven,
          'Occupancy below this percentage makes cash flow fall below target', 'pct'),
        point('Maximum interest rate', 'loan_rate_pct', solveMonotonic(x => cf({ loan_rate_pct: x }), 0, 30, t),
          'Above this rate, cash flow falls below target', 'pct'),
        point('Maximum purchase price', 'purchase_price', solveMonotonic(x => cf({ purchase_price: x }), 0, Math.max(price * 5, 1), t),
          'Above this price (same down payment %), cash flow falls below target'),
      ],
    },
    ['One input varies at a time; taxes and insurance held fixed even when price changes']);
}

// Wholesale: min buyer price for a target fee, max contract price, break-even ARV for MAO > 0.
function wholesaleBreakEven({ arv, repairs, flip_factor_pct, assignment_fee, closing_holding_buffer, contract_price = null, target_fee = 0 }) {
  const base = S.wholesaleMao({ arv, repairs, flip_factor_pct, assignment_fee, closing_holding_buffer });
  const inp = base.inputs;
  const maoWith = (patch) => S.wholesaleMao({ ...inp, ...patch }).output.mao;
  const points = [
    point('Break-even ARV (MAO reaches 0)', 'arv', solveMonotonic(x => maoWith({ arv: x }), 0, Math.max(inp.arv * 5, 1), 0),
      'Below this ARV the deal leaves nothing to offer after repairs, fee and buffer'),
    point('Maximum repairs (MAO reaches 0)', 'repairs', solveMonotonic(x => maoWith({ repairs: x }), 0, Math.max(inp.arv * 2, 1), 0),
      'Repairs above this leave no room for an offer'),
  ];
  if (contract_price != null) {
    const cp = Number(contract_price);
    if (!Number.isFinite(cp) || cp < 0) throw new CalcError('contract_price must be a positive number', 'contract_price');
    points.push(point('Minimum buyer price for target fee', 'buyer_price', cp + (Number(target_fee) || 0),
      `An end buyer must pay at least this for a $${(Number(target_fee) || 0).toLocaleString()} fee`));
    points.push(point('Maximum contract price for target fee', 'contract_price', base.output.end_buyer_max_price - (Number(target_fee) || 0),
      'Contracting above this leaves less than the target fee at the end buyer\'s maximum price'));
  }
  return calc('wholesale_break_even', { ...inp, contract_price, target_fee },
    'solve wholesaleMao(field = x).mao = 0; buyer price floor = contract price + target fee; contract ceiling = end buyer max − target fee',
    { current_mao: base.output.mao, end_buyer_max_price: base.output.end_buyer_max_price, break_even_points: points },
    base.assumptions);
}

module.exports = { fixFlipBreakEven, buyHoldBreakEven, wholesaleBreakEven };
