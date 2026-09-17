// ─── Deal Timeline Simulator ────────────────────────────────────────────────
// Lays the deal's phases on a calendar from explicit durations and shows what a
// delay costs. Durations and monthly carrying costs are operator inputs; any
// default is listed in assumptions. "If closing moves 30 days, holding cost
// increases by $X" is computed from the stated monthly carrying cost only.

const { round2, CalcError, num } = require('../calc/core');

const PHASES = {
  wholesale: ['contract', 'due_diligence', 'find_buyer', 'title', 'closing'],
  fix_flip: ['contract', 'due_diligence', 'financing', 'title', 'closing', 'rehab', 'listing_and_sale'],
  buy_hold: ['contract', 'due_diligence', 'financing', 'title', 'closing', 'rehab', 'lease_up'],
  brrrr: ['contract', 'due_diligence', 'financing', 'title', 'closing', 'rehab', 'lease_up', 'refinance_seasoning', 'refinance'],
};

const DEFAULT_DAYS = { contract: 3, due_diligence: 10, find_buyer: 14, financing: 21, title: 21, closing: 3, rehab: 60, listing_and_sale: 60, lease_up: 30, refinance_seasoning: 180, refinance: 30 };
// Phases during which the owner is carrying the property (costs accrue).
const CARRYING = new Set(['rehab', 'listing_and_sale', 'lease_up', 'refinance_seasoning', 'refinance']);

function simulate({ strategy, start_date = null, durations = {}, monthly_carrying_cost = null, delays = {}, delay_tests = [30, 60, 90] }) {
  const phases = PHASES[strategy];
  if (!phases) throw new CalcError(`strategy must be one of ${Object.keys(PHASES).join(', ')}`, 'strategy');
  const assumptions = [];
  const start = start_date ? new Date(start_date) : new Date();
  if (Number.isNaN(start.getTime())) throw new CalcError('start_date must be a date', 'start_date');
  if (!start_date) assumptions.push('Starts today');
  const carrying = monthly_carrying_cost == null ? null : num(monthly_carrying_cost, 'monthly_carrying_cost', { min: 0 });
  const dailyCarry = carrying == null ? null : carrying * 12 / 365;

  let cursor = new Date(start);
  let carryingDays = 0;
  const schedule = phases.map(p => {
    const given = durations[p];
    const base = given == null ? DEFAULT_DAYS[p] : num(given, `durations.${p}`, { min: 0, max: 3650, integer: true });
    if (given == null) assumptions.push(`${p.replace(/_/g, ' ')}: default ${DEFAULT_DAYS[p]} days (not supplied)`);
    const delay = delays[p] == null ? 0 : num(delays[p], `delays.${p}`, { min: 0, max: 3650, integer: true });
    const days = base + delay;
    const from = new Date(cursor);
    cursor = new Date(cursor.getTime() + days * 86400000);
    if (CARRYING.has(p)) carryingDays += days;
    return { phase: p, days, delay_days: delay, starts: from.toISOString().slice(0, 10), ends: cursor.toISOString().slice(0, 10), carrying: CARRYING.has(p) };
  });

  const totalDays = Math.round((cursor - start) / 86400000);
  const delayImpact = carrying == null ? null : delay_tests.map(d => ({ delay_days: d, added_holding_cost: round2(dailyCarry * d), statement: `If the timeline slips ${d} days during a carrying phase, holding cost increases by $${Math.round(dailyCarry * d).toLocaleString('en-US')}.` }));
  if (carrying == null) assumptions.push('Monthly carrying cost not supplied: delay cost cannot be calculated (enter taxes + insurance + utilities + loan interest per month).');
  return {
    strategy, schedule, total_days: totalDays, completion_date: cursor.toISOString().slice(0, 10),
    carrying_days: carryingDays,
    holding_cost_total: carrying == null ? null : round2(dailyCarry * carryingDays),
    delay_impact: delayImpact,
    formula: 'holding cost = monthly carrying cost × 12 ÷ 365 × carrying days',
    assumptions,
  };
}

module.exports = { simulate, PHASES, DEFAULT_DAYS };
