// ─── Asset-type domains: LandAcquisitionAgent, LandDevelopmentAgent, MultifamilyAgent,
//     CommercialAgent, SelfStorageAgent ─────────────────────────────────────────
// No parcel, zoning, flood, rent-roll or commercial data provider is connected, so
// these agents work from the operator's worksheets and state exactly what must be
// verified with the county, planning department, FEMA, or the seller's records.

const { defineAgent } = require('../agentKit');
const { claim, STATUS } = require('../provenance');
const core = require('../calc/core');
const H = require('./_shared');

const decl = (id, name, domain, capabilities, outputs, extra = {}) => ({
  id, name, domain, version: '1.0.0', capabilities, required_inputs: ['deal_understanding'], outputs,
  tools: ['deal_graph.read', 'calc.noi', 'calc.cap_rate'], knowledge_sources: ['operator worksheets', 'deal understanding'],
  permissions: 'RECOMMEND', risk_level: 'medium', handoff_agents: [], jurisdiction_aware: true, last_knowledge_update: H.KNOWLEDGE_DATE, ...extra,
});
const U = (v, basis) => claim(v, STATUS.USER_PROVIDED, { source: 'operator worksheet', basis });
const miss = (item, why, how) => ({ item, why_it_matters: why, how_to_get: how });

const LAND_FACTORS = [
  ['acreage', 'Size drives price per acre and density.', 'County assessor / plat map.'],
  ['zoning', 'Zoning decides allowed uses and density.', 'City/county zoning map; confirm with the planning department.'],
  ['road_access', 'Legal and physical access is required to build or finance.', 'Survey and title report (recorded access easement).'],
  ['utilities', 'Water, sewer/septic and power availability swing development cost.', 'Utility providers; septic perc test.'],
  ['flood_zone', 'Flood zones restrict building and raise insurance.', 'FEMA Flood Map Service Center for the parcel.'],
  ['topography', 'Slope and grading affect buildable area and cost.', 'Topographic survey or GIS contours.'],
  ['wetlands_environmental', 'Wetlands or contamination can make land unbuildable.', 'Wetlands inventory, Phase I environmental report.'],
  ['easements_restrictions', 'Easements and deed restrictions limit use.', 'Title commitment exceptions.'],
];

const landAcquisition = defineAgent({
  declaration: decl('land_acquisition', 'Land Acquisition Agent', 'land', ['land_due_diligence', 'price_per_acre', 'buildability_flags'], ['land_assessment'], { handoff_agents: ['land_development'] }),
  async analyze(ctx) {
    const land = H.worksheet(ctx.understanding, 'land') || {};
    const findings = [], missing = [], risks = [];
    for (const [k, why, how] of LAND_FACTORS) {
      if (land[k] === undefined || land[k] === null || land[k] === '') missing.push(miss(k, why, how));
      else findings.push(H.finding(k.replace(/_/g, ' '), U(land[k])));
    }
    const acreage = H.pos(land.acreage);
    const priceC = [H.c(ctx.understanding, 'transaction.contract_price'), H.c(ctx.understanding, 'transaction.asking_price')].find(c => c.status !== STATUS.UNKNOWN);
    const calcs = [];
    if (acreage && priceC) calcs.push({ name: 'price_per_acre', inputs: { price: priceC.value, acreage }, formula: 'price per acre = price ÷ acreage', output: { price_per_acre: core.round2(priceC.value / acreage) }, assumptions: [] });
    const comps = Array.isArray(land.comparable_sales) ? land.comparable_sales.filter(c => H.pos(c.price) && H.pos(c.acreage)) : [];
    if (comps.length) {
      const ppa = comps.map(c => c.price / c.acreage).sort((a, b) => a - b);
      calcs.push({ name: 'land_comparables_price_per_acre', inputs: { comparables: comps.length }, formula: 'median of comparable price ÷ acreage', output: { median_price_per_acre: core.round2(ppa[Math.floor(ppa.length / 2)]), low: core.round2(ppa[0]), high: core.round2(ppa[ppa.length - 1]) }, assumptions: ['Comparable land sales as entered by you'] });
    } else missing.push(miss('comparable_sales', 'Land value comes from recent sales of similar parcels.', 'County recorder sales or a land broker; add them to the land worksheet with price and acreage.'));
    if (land.road_access === false || /no|land.?locked/i.test(String(land.road_access))) risks.push({ risk: 'No recorded road access: the parcel may be landlocked.', severity: 'critical', category: 'legal', mitigation: 'Require a recorded access easement before closing.' });
    if (/^(a|ae|v|ve)/i.test(String(land.flood_zone || ''))) risks.push({ risk: `Flood zone ${land.flood_zone}: special flood hazard area.`, severity: 'high', category: 'construction', mitigation: 'Price in elevation requirements and flood insurance.' });
    if (land.wetlands_environmental && !/none|no/i.test(String(land.wetlands_environmental))) risks.push({ risk: `Environmental note: ${land.wetlands_environmental}`, severity: 'high', category: 'legal', mitigation: 'Order a wetlands delineation / Phase I report.' });
    return {
      status: findings.length ? 'complete' : 'insufficient_data',
      summary: `${findings.length}/${LAND_FACTORS.length} land factors on file; ${risks.length} red flag(s).${calcs[0]?.output?.price_per_acre ? ` Price ${H.money(calcs[0].output.price_per_acre)}/acre.` : ''}`,
      findings, calculations: calcs, risks, missing,
      confidence: { score: Math.round(70 * findings.length / LAND_FACTORS.length), reasoning: 'All land facts are operator-entered and unverified against county, FEMA or survey records.' },
      attorney_review: risks.length > 0, handoffs: ['land_development'],
      data: { factors_known: findings.length, red_flags: risks.length },
    };
  },
});

const landDevelopment = defineAgent({
  declaration: decl('land_development', 'Land Development Agent', 'land', ['highest_best_use', 'residual_land_value', 'entitlement_path'], ['development_assessment']),
  async analyze(ctx) {
    const land = H.worksheet(ctx.understanding, 'land') || {};
    const plan = land.development || {};
    const units = H.pos(plan.units), salePerUnit = H.pos(plan.sale_price_per_unit), costPerUnit = H.pos(plan.hard_cost_per_unit), soft = H.pos(plan.soft_cost_pct), profitPct = H.pos(plan.developer_profit_pct), infra = H.pos(plan.infrastructure_cost);
    const missing = [];
    for (const [k, v] of Object.entries({ units, sale_price_per_unit: salePerUnit, hard_cost_per_unit: costPerUnit, soft_cost_pct: soft, developer_profit_pct: profitPct, infrastructure_cost: infra })) {
      if (v == null) missing.push(miss(`development.${k}`, 'Needed for the residual land value.', 'Enter your development plan in the land worksheet (from zoning density, builder bids and market sales).'));
    }
    if (!land.zoning) missing.push(miss('zoning', 'Allowed density must be confirmed before any unit count is meaningful.', 'Planning department zoning verification letter.'));
    if (missing.length) return { status: 'insufficient_data', summary: 'I cannot estimate highest and best use or residual land value without a development plan (units, prices, costs) and verified zoning.', missing, confidence: { score: 0, reasoning: 'Development inputs unknown.' } };
    const gdv = units * salePerUnit;
    const hard = units * costPerUnit;
    const softCost = hard * soft / 100;
    const profit = gdv * profitPct / 100;
    const residual = gdv - hard - softCost - infra - profit;
    const price = H.c(ctx.understanding, 'transaction.contract_price').value ?? H.c(ctx.understanding, 'transaction.asking_price').value;
    return {
      summary: `Residual land value ${H.money(residual)} for ${units} units${price != null ? ` vs price ${H.money(price)} (${residual >= price ? 'supports' : 'does not support'} the price)` : ''}.`,
      findings: [H.finding('Residual land value', claim(core.round2(residual), STATUS.CALCULATED, { basis: 'development plan you provided' }))],
      calculations: [{ name: 'residual_land_value', inputs: { units, sale_price_per_unit: salePerUnit, hard_cost_per_unit: costPerUnit, soft_cost_pct: soft, infrastructure_cost: infra, developer_profit_pct: profitPct }, formula: 'residual = units × sale price − units × hard cost − soft cost % of hard − infrastructure − developer profit % of sales', output: { gross_development_value: core.round2(gdv), hard_costs: core.round2(hard), soft_costs: core.round2(softCost), developer_profit: core.round2(profit), residual_land_value: core.round2(residual) }, assumptions: ['Ignores financing carry and absorption time; entitlement approval not assumed'] }],
      risks: [{ risk: 'Entitlements (rezoning, subdivision, permits) are not approved; timelines and outcomes are uncertain.', severity: 'high', category: 'legal', mitigation: 'Pre-application meeting with the planning department; contract with a feasibility period.' }],
      confidence: { score: 40, reasoning: 'Plan figures are yours and unverified; zoning density not confirmed by the planning department.' },
      attorney_review: true, data: { residual_land_value: core.round2(residual), gross_development_value: core.round2(gdv) },
    };
  },
});

// Income-property statement: annual lines from the operating_statement worksheet.
function operating(ctx) {
  const os = H.worksheet(ctx.understanding, 'operating_statement') || {};
  const income = Array.isArray(os.income) ? os.income : [];
  const expenses = Array.isArray(os.expenses) ? os.expenses : [];
  const gross = income.reduce((s, x) => s + (H.pos(x.annual_amount) || 0), 0);
  const opex = expenses.reduce((s, x) => s + (H.pos(x.annual_amount) || 0), 0);
  return { os, income, expenses, gross, opex, vacancy: H.pos(os.vacancy_pct), capRate: H.pos(os.market_cap_rate_pct), capSource: os.cap_rate_source || null };
}

function incomeAnalysis(ctx, label) {
  const o = operating(ctx);
  const missing = [];
  if (!o.income.length) missing.push(miss('operating_statement.income', 'Income is the base of NOI and value.', 'Trailing-12 income statement or rent roll from the seller.'));
  if (!o.expenses.length) missing.push(miss('operating_statement.expenses', 'NOI can\'t be computed without expenses.', 'Seller\'s trailing-12 expense statement; verify taxes and insurance independently.'));
  if (o.vacancy == null) missing.push(miss('operating_statement.vacancy_pct', 'Economic vacancy reduces collected income.', 'Rent roll and bank deposits.'));
  if (missing.length) return { missing };
  const n = core.noi({ gross_annual_income: o.gross, vacancy_pct: o.vacancy, annual_operating_expenses: o.opex });
  const calcs = [n];
  let value = null;
  if (o.capRate != null) { value = core.valueFromCapRate({ noi: n.output.noi, cap_rate_pct: o.capRate }); calcs.push(value); }
  const price = H.c(ctx.understanding, 'transaction.contract_price').value ?? H.c(ctx.understanding, 'transaction.asking_price').value;
  let goingIn = null;
  if (price) { goingIn = core.capRate({ noi: n.output.noi, value: price }); calcs.push(goingIn); }
  const expenseRatio = o.gross > 0 ? core.round2((o.opex / o.gross) * 100) : null;
  const risks = [];
  if (expenseRatio != null && expenseRatio < 30) risks.push({ risk: `Expense ratio ${expenseRatio}% looks low for ${label}; seller statements often omit management, reserves or repairs.`, severity: 'medium', category: 'financial', mitigation: 'Rebuild expenses from invoices, tax bills and an insurance quote.' });
  if (o.capRate != null && !o.capSource) risks.push({ risk: 'Market cap rate entered without a source.', severity: 'medium', category: 'valuation', mitigation: 'Record the source (broker survey, recent sales) in the worksheet.' });
  return { o, n, value, goingIn, calcs, expenseRatio, risks, price };
}

function incomeAgent(id, name, domain, extraAnalysis) {
  return defineAgent({
    declaration: decl(id, name, domain, ['noi', 'cap_rate', 'income_value', 'expense_ratio'], [`${id}_analysis`]),
    async analyze(ctx) {
      const a = incomeAnalysis(ctx, name.replace(' Agent', '').toLowerCase());
      if (a.missing) return { status: 'insufficient_data', summary: `I cannot underwrite this ${name.replace(' Agent', '').toLowerCase()} property without an operating statement (income, expenses, vacancy).`, missing: a.missing, confidence: { score: 0, reasoning: 'No operating statement.' } };
      const extra = extraAnalysis ? extraAnalysis(ctx, a) : { findings: [], risks: [], calculations: [], data: {} };
      return {
        summary: `NOI ${H.money(a.n.output.noi)}; expense ratio ${a.expenseRatio ?? '—'}%${a.goingIn ? `; going-in cap rate ${a.goingIn.output.cap_rate_pct}%` : ''}${a.value ? `; value at ${a.o.capRate}% cap ${H.money(a.value.output.value)}` : ''}.`,
        findings: [H.finding('NOI', U(a.n.output.noi, 'operating statement you provided')), ...extra.findings],
        calculations: [...a.calcs, ...extra.calculations], risks: [...a.risks, ...extra.risks],
        missing: a.o.capRate == null ? [miss('operating_statement.market_cap_rate_pct', 'Income value needs a market cap rate.', 'Broker cap rate survey or recent comparable sales.')] : [],
        confidence: { score: 50, reasoning: 'Seller-provided operating figures, not audited; verify with bank statements and tax returns.' },
        data: { noi: a.n.output.noi, expense_ratio_pct: a.expenseRatio, going_in_cap_rate_pct: a.goingIn?.output?.cap_rate_pct ?? null, income_value: a.value?.output?.value ?? null, ...extra.data },
      };
    },
  });
}

const multifamily = incomeAgent('multifamily', 'Multifamily Agent', 'multifamily', (ctx) => {
  const rr = H.worksheet(ctx.understanding, 'rent_roll');
  const units = Array.isArray(rr) ? rr : Array.isArray(rr?.units) ? rr.units : [];
  if (!units.length) return { findings: [], calculations: [], data: {}, risks: [{ risk: 'No rent roll: occupancy, unit mix and loss-to-lease are unverified.', severity: 'high', category: 'financial', mitigation: 'Get a certified rent roll and estoppels.' }] };
  const occupied = units.filter(u => String(u.status || '').toLowerCase() !== 'vacant');
  const current = units.reduce((s, u) => s + (H.pos(u.rent) || 0), 0);
  const market = units.reduce((s, u) => s + (H.pos(u.market_rent) || 0), 0);
  const mix = units.reduce((m, u) => { const k = u.beds != null ? `${u.beds}br` : 'unknown'; m[k] = (m[k] || 0) + 1; return m; }, {});
  const lossToLease = market > 0 ? core.round2(market - current) : null;
  return {
    findings: [H.finding('Physical occupancy', U(core.round2((occupied.length / units.length) * 100), 'rent roll'))],
    calculations: [{ name: 'rent_roll_summary', inputs: { units: units.length }, formula: 'occupancy = occupied ÷ units; loss to lease = Σ market rent − Σ current rent (monthly)', output: { units: units.length, occupied: occupied.length, monthly_current_rent: core.round2(current), monthly_market_rent: market ? core.round2(market) : null, monthly_loss_to_lease: lossToLease, unit_mix: mix }, assumptions: ['Market rents as entered by you'] }],
    risks: [], data: { units: units.length, occupancy_pct: core.round2((occupied.length / units.length) * 100), monthly_loss_to_lease: lossToLease, value_add_rent_upside_annual: lossToLease != null ? core.round2(lossToLease * 12) : null },
  };
});

const commercial = incomeAgent('commercial', 'Commercial Agent', 'commercial', (ctx) => {
  const type = String(H.val(ctx.understanding, 'property.property_type') || '').toLowerCase();
  const specialist = /storage/.test(type) ? 'self_storage' : null;
  return {
    findings: [], calculations: [], risks: [{ risk: 'Commercial leases (terms, escalations, tenant credit, expense recoveries) drive value and are not analysed from the operating statement alone.', severity: 'medium', category: 'financial', mitigation: 'Abstract every lease and estoppel.' }],
    data: { property_type: type || null, specialist_agent: specialist },
  };
});

const selfStorage = incomeAgent('self_storage', 'Self Storage Agent', 'commercial', (ctx) => {
  const rr = H.worksheet(ctx.understanding, 'rent_roll');
  const units = Array.isArray(rr?.units) ? rr.units : Array.isArray(rr) ? rr : [];
  if (!units.length) return { findings: [], calculations: [], data: {}, risks: [{ risk: 'No unit-level rent roll: occupancy and street vs in-place rates unknown.', severity: 'high', category: 'financial', mitigation: 'Get the management software rent roll export.' }] };
  const sf = units.reduce((s, u) => s + (H.pos(u.sqft) || 0), 0);
  const occSf = units.filter(u => String(u.status || '').toLowerCase() !== 'vacant').reduce((s, u) => s + (H.pos(u.sqft) || 0), 0);
  const inPlace = units.reduce((s, u) => s + (H.pos(u.rent) || 0), 0);
  const street = units.reduce((s, u) => s + (H.pos(u.street_rate) || 0), 0);
  return {
    findings: [H.finding('Occupancy by square feet', U(sf ? core.round2((occSf / sf) * 100) : null, 'rent roll'))],
    calculations: [{ name: 'storage_rent_roll', inputs: { units: units.length }, formula: 'sq ft occupancy = occupied sq ft ÷ total sq ft; rate gap = Σ street rate − Σ in-place rent', output: { units: units.length, total_sqft: sf, occupied_sqft: occSf, monthly_in_place: core.round2(inPlace), monthly_street: street ? core.round2(street) : null, monthly_rate_gap: street ? core.round2(street - inPlace) : null }, assumptions: [] }],
    risks: [], data: { sqft_occupancy_pct: sf ? core.round2((occSf / sf) * 100) : null },
  };
});

module.exports = { landAcquisition, landDevelopment, multifamily, commercial, selfStorage, LAND_FACTORS };
