const REPAIR_ITEMS = {
  roof: {
    label: 'Roof',
    options: [
      { id: 'minor',       label: 'Minor repairs',      min: 2000,  max: 5000  },
      { id: 'partial',     label: 'Partial replacement', min: 5000,  max: 12000 },
      { id: 'full',        label: 'Full replacement',    min: 10000, max: 22000 },
    ],
  },
  hvac: {
    label: 'HVAC',
    options: [
      { id: 'service',     label: 'Service/tune-up',    min: 500,   max: 500   },
      { id: 'repair',      label: 'Repair',             min: 1000,  max: 3000  },
      { id: 'full',        label: 'Full replacement',   min: 5000,  max: 12000 },
    ],
  },
  plumbing: {
    label: 'Plumbing',
    options: [
      { id: 'minor',       label: 'Minor repairs',      min: 500,   max: 2000  },
      { id: 'major',       label: 'Major repairs',      min: 3000,  max: 8000  },
      { id: 'repipe',      label: 'Full repipe',        min: 8000,  max: 20000 },
    ],
  },
  electrical: {
    label: 'Electrical',
    options: [
      { id: 'panel',       label: 'Panel upgrade',      min: 2000,  max: 5000  },
      { id: 'rewire',      label: 'Full rewire',        min: 8000,  max: 20000 },
    ],
  },
  foundation: {
    label: 'Foundation',
    options: [
      { id: 'minor',       label: 'Minor repairs',      min: 3000,  max: 8000  },
      { id: 'major',       label: 'Major repairs',      min: 15000, max: 50000 },
    ],
  },
  kitchen: {
    label: 'Kitchen',
    options: [
      { id: 'cosmetic',    label: 'Cosmetic update',    min: 3000,  max: 8000  },
      { id: 'semi',        label: 'Semi renovation',    min: 8000,  max: 20000 },
      { id: 'full',        label: 'Full gut',           min: 20000, max: 50000 },
    ],
  },
  bathrooms: {
    label: 'Bathrooms (each)',
    options: [
      { id: 'cosmetic',    label: 'Cosmetic update',    min: 2000,  max: 5000  },
      { id: 'full',        label: 'Full renovation',    min: 8000,  max: 20000 },
    ],
  },
  flooring: {
    label: 'Flooring',
    options: [
      { id: 'carpet',      label: 'Carpet',             min: 2000,  max: 5000  },
      { id: 'hardwood',    label: 'Hardwood',           min: 5000,  max: 15000 },
      { id: 'full',        label: 'Full replacement',   min: 8000,  max: 20000 },
    ],
  },
  paint_int: { label: 'Paint (Interior)', options: [{ id: 'full', label: 'Full interior', min: 2000, max: 6000 }] },
  paint_ext: { label: 'Paint (Exterior)', options: [{ id: 'full', label: 'Full exterior', min: 2000, max: 8000 }] },
  landscaping: { label: 'Landscaping', options: [{ id: 'basic', label: 'Basic cleanup', min: 1000, max: 5000 }] },
  windows: { label: 'Windows (each)', options: [{ id: 'each', label: 'Per window', min: 300, max: 800 }] },
  garage_door: { label: 'Garage Door', options: [{ id: 'replace', label: 'Replacement', min: 800, max: 2000 }] },
  driveway: { label: 'Driveway', options: [{ id: 'repave', label: 'Repave', min: 2000, max: 8000 }] },
};

function calculateRepairEstimate(items) {
  // items = [{ category: 'roof', option: 'full', quantity: 1 }, ...]
  let low = 0;
  let high = 0;
  const breakdown = [];

  for (const item of items) {
    const category = REPAIR_ITEMS[item.category];
    if (!category) continue;
    const option = category.options.find(o => o.id === item.option);
    if (!option) continue;
    const qty = item.quantity || 1;
    low  += option.min * qty;
    high += option.max * qty;
    breakdown.push({
      category: item.category,
      label: category.label,
      option: option.label,
      quantity: qty,
      low: option.min * qty,
      high: option.max * qty,
    });
  }

  const midpoint = Math.round((low + high) / 2);
  return { low, high, midpoint, breakdown };
}

// ─── E — Dynamic assignment-fee sizing ───────────────────────────────────────
//
// The legacy fee is a flat MAO × 0.15 — it ignores the actual deal. On a deal with
// a huge spread that under-charges badly; on a razor-thin deal it can overshoot and
// scare the buyer off. A 50-year wholesaler reads the SPREAD (the buyer's gross
// profit = ARV − purchase − repairs) and sizes the fee from what's actually there,
// always leaving the end-buyer enough ROI to still want the deal.
//
// Rules:
//   - Fee comes OUT of the spread, never on top of MAO.
//   - Leave the buyer a healthy cut: cap the fee at ~40% of the spread so the
//     buyer keeps the majority (their capital + risk earns the bigger share).
//   - Thin spread  -> take a modest fee (what's there), floor ~$5k if any room.
//   - Fat spread   -> stretch UP toward the $70k–$100k the user called out, but
//     never past the 40%-of-spread guardrail or the buyer walks.
//   - Hard ceiling $100k (a single-assignment fee beyond that invites pushback).
//
// @param {number} arv          after-repair value
// @param {number} purchase     what WE contract the property at (e.g. first_offer)
// @param {number} repairs      estimated rehab cost
// @returns {{ spread:number, fee:number, buyer_profit:number, buyer_roi:number, basis:string }}
function calculateDynamicFee(arv, purchase, repairs) {
  const spread = Math.round(arv - purchase - repairs);
  if (spread <= 8000) {
    // No real room — take a token fee only if there's anything, else leave it.
    const fee = spread > 0 ? Math.min(spread, 5000) : 0;
    return {
      spread, fee,
      buyer_profit: spread - fee,
      buyer_roi: (purchase + repairs) > 0 ? Math.round(((spread - fee) / (purchase + repairs)) * 100) : 0,
      basis: 'thin_spread',
    };
  }

  // Scale the cut with spread size: small deals ~25% of spread, big deals up to 40%.
  //   spread $8k–$50k   -> 25%
  //   spread $50k–$150k -> 33%
  //   spread $150k+     -> 40%
  let cutPct;
  if (spread < 50000)       cutPct = 0.25;
  else if (spread < 150000) cutPct = 0.33;
  else                      cutPct = 0.40;

  let fee = Math.round(spread * cutPct);
  fee = Math.max(fee, 5000);     // floor — if there's room, it's worth at least $5k
  fee = Math.min(fee, 100000);   // ceiling — single-assignment sanity cap

  const buyerProfit = spread - fee;
  return {
    spread, fee,
    buyer_profit: buyerProfit,
    buyer_roi: (purchase + repairs) > 0 ? Math.round((buyerProfit / (purchase + repairs)) * 100) : 0,
    basis: spread >= 150000 ? 'fat_spread' : spread >= 50000 ? 'solid_spread' : 'modest_spread',
  };
}

function calculateScenarios(arv, repairMidpoint) {
  const conservative = {
    label: 'Conservative',
    arv: Math.round(arv * 0.90),
    repairs: Math.round(repairMidpoint * 1.20),
  };
  const moderate = {
    label: 'Moderate',
    arv,
    repairs: repairMidpoint,
  };
  const aggressive = {
    label: 'Aggressive',
    arv: Math.round(arv * 1.05),
    repairs: Math.round(repairMidpoint * 0.90),
  };

  for (const s of [conservative, moderate, aggressive]) {
    s.mao = Math.round(s.arv * 0.70 - s.repairs);
    s.first_offer = Math.round(s.mao * 0.85);
    s.assignment_fee_at_mao = 0;
    s.assignment_fee_at_first_offer = Math.round(s.mao * 0.15); // legacy fixed (kept for back-compat)
    s.buyer_profit_at_mao = Math.round(s.arv - s.mao - s.repairs);
    s.buyer_roi_at_mao = s.mao > 0 ? Math.round((s.buyer_profit_at_mao / (s.mao + s.repairs)) * 100) : 0;

    // E — dynamic fee: size the assignment from the REAL spread at first_offer (our
    // target buy) rather than a flat 15% of MAO. This is the number the negotiator
    // should actually reach for. Additive — legacy fields above are untouched.
    s.dynamic_fee = calculateDynamicFee(s.arv, s.first_offer, s.repairs);
  }

  return { conservative, moderate, aggressive };
}

function estimateFromDescription(description) {
  const desc = description?.toLowerCase() || '';
  let estimate = 0;

  if (/move.?in ready|great condition|updated|renovated/.test(desc))  estimate = 0;
  else if (/cosmetic|paint|carpet|cleaning|minor/.test(desc))          estimate = 10000;
  else if (/kitchen|bathroom|update|dated/.test(desc))                 estimate = 25000;
  else if (/roof/.test(desc))                                           estimate += 15000;
  else if (/hvac|heating|cooling/.test(desc))                          estimate += 8000;
  else if (/foundation/.test(desc))                                    estimate += 30000;
  else if (/gut|rehab|tear.?down|major/.test(desc))                    estimate = 65000;

  if (/vacant|abandoned|neglected/.test(desc)) estimate += 15000;

  return estimate;
}

module.exports = { REPAIR_ITEMS, calculateRepairEstimate, calculateScenarios, calculateDynamicFee, estimateFromDescription };
