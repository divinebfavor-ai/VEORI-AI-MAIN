// ─── Deal Understanding Engine ───────────────────────────────────────────────
// Builds the complete internal representation of a deal before any agent reasons
// about it: PROPERTY, PEOPLE, TRANSACTION, FINANCIAL and UNKNOWN. Every field is a
// provenance claim. The result is stored on deals.understanding and mirrored into
// the shared graph tables (properties, persons, transactions, comparables).
//
// Provenance of existing records (honest labelling):
//   - lead/deal numbers entered by import, API or AI over time have no tracked origin
//     -> UNVERIFIED ("lead record"), never VERIFIED
//   - operator edits made in the Deal Room -> USER_PROVIDED
//   - licensed provider AVMs -> ESTIMATED; provider public-record attributes -> UNVERIFIED
//   - call analysis (motivation score) -> INFERRED
//   - deal terms the operator set (offer, contract price, buyer price) -> USER_PROVIDED

const supabase = require('../config/supabase');
const { claim, unknown, derived, reconcile, STATUS } = require('./provenance');
const connectors = require('./connectors');
const audit = require('./audit');
const S = require('./calc/strategies');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Why each field matters and how to get it - used to explain every UNKNOWN.
const FIELD_CATALOG = {
  'property.sqft': ['Living area drives value per square foot, rehab cost and rent.', 'County assessor record, listing, or measure on site.'],
  'property.bedrooms': ['Bedroom count selects comparable sales and rent.', 'County record, listing, or walkthrough.'],
  'property.bathrooms': ['Bathroom count selects comparables and affects rehab scope.', 'County record, listing, or walkthrough.'],
  'property.year_built': ['Age flags lead paint, systems replacement and insurance cost.', 'County assessor record.'],
  'property.property_type': ['Property type decides which strategies and buyers apply.', 'County record or site visit.'],
  'property.condition': ['Condition sets the repair estimate, the largest swing in MAO.', 'Photos, walkthrough, or contractor inspection.'],
  'property.zoning': ['Zoning limits use, units and development options.', 'City/county zoning map or planning department.'],
  'property.parcel_id': ['The parcel number is needed to pull title, tax and lien records.', 'County assessor or recorder search by address.'],
  'property.occupancy': ['Tenant-occupied properties add lease, access and eviction constraints.', 'Ask the seller; verify with a site visit.'],
  'property.ownership.owner_names': ['The person signing must be the owner of record.', 'County recorder deed search or title report.'],
  'property.financing.loan_balance': ['Existing debt sets equity, the price floor and subject-to viability.', 'Mortgage statement from the seller or a payoff letter.'],
  'property.financing.interest_rate': ['The rate decides whether taking over the loan makes sense.', 'Mortgage statement from the seller.'],
  'property.financing.monthly_payment': ['Payment sets cash flow for subject-to and rental exits.', 'Mortgage statement from the seller.'],
  'property.financing.arrears': ['Arrears must be cured at or before closing.', 'Mortgage statement or reinstatement quote.'],
  'property.liens.summary': ['Liens and judgments must be paid or the title will not be clear.', 'Preliminary title report from a title company.'],
  'property.taxes.annual': ['Taxes are a fixed holding and rental cost.', 'County treasurer / tax collector record.'],
  'property.insurance.annual': ['Insurance is a fixed holding and rental cost.', 'Insurance quote for the property.'],
  'people.seller.name': ['Needed for contracts and to confirm the seller is the owner.', 'Ask the seller; confirm against the deed.'],
  'people.seller.timeline_days': ['The seller\'s timeline decides which structures can close in time.', 'Ask the seller directly.'],
  'people.seller.objectives': ['Knowing what the seller needs (price, speed, debt relief) shapes the offer.', 'Seller conversation notes.'],
  'transaction.asking_price': ['The gap between asking price and MAO decides whether to pursue.', 'Ask the seller for their number.'],
  'transaction.contract_price': ['The agreed price anchors every return calculation.', 'Signed purchase agreement.'],
  'transaction.buyer_price': ['The end buyer\'s price sets the assignment fee.', 'Buyer offer or assignment agreement.'],
  'transaction.closing_date': ['The closing date drives holding cost and deadlines.', 'Purchase agreement.'],
  'financial.arv': ['After-repair value is the base of MAO, flip profit and refinance proceeds.', 'At least 3 sold comparables within 0.5-1 mile and 6 months, or an appraisal.'],
  'financial.repairs': ['The repair budget is subtracted directly from what can be paid.', 'Contractor walkthrough and itemised bid.'],
  'financial.as_is_value': ['As-is value sets equity and lender LTV limits.', 'Sold comparables in similar condition, or an appraisal.'],
  'financial.market_rent': ['Rent decides rental, BRRRR and lease-option viability.', 'Rental comparables or a property manager\'s rent opinion.'],
};

const LEAD_SOURCE = 'lead record';
const DEAL_SOURCE = 'deal record';

function n(v) { const x = Number(v); return v === null || v === undefined || v === '' || !Number.isFinite(x) ? null : x; }
function nonEmpty(v) { return v === null || v === undefined || (typeof v === 'string' && !v.trim()) ? null : v; }

function setPath(obj, path, value) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) { o[parts[i]] = o[parts[i]] || {}; o = o[parts[i]]; }
  o[parts[parts.length - 1]] = value;
}
function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }

// Walk the representation and list every UNKNOWN claim with why/how.
function collectUnknowns(rep) {
  const out = [];
  const walk = (node, prefix) => {
    if (!node || typeof node !== 'object') return;
    if (Object.prototype.hasOwnProperty.call(node, 'status') && Object.prototype.hasOwnProperty.call(node, 'value')) {
      if (node.status === STATUS.UNKNOWN) {
        const [why, how] = FIELD_CATALOG[prefix] || ['Not yet obtained.', 'Ask the seller or pull the public record.'];
        out.push({ field: prefix, why_it_matters: why, how_to_get: how, note: node.note || null });
      }
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      if (['overrides', 'unknowns', 'conflicts', 'data_gaps', 'meta', 'comparables', 'worksheets'].includes(k) && !prefix) continue;
      walk(v, prefix ? `${prefix}.${k}` : k);
    }
  };
  walk(rep, '');
  return out;
}

async function loadRecords(userId, dealId) {
  if (!UUID_RE.test(String(dealId))) return null;
  const { data: deal, error } = await supabase.from('deals').select('*').eq('id', dealId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!deal) return null;
  const q = (p) => Promise.resolve(p).then(r => (r.error ? null : r.data), () => null);
  const [lead, buyer, owner, lastCall, contracts, titleLogs, followUps, comps] = await Promise.all([
    deal.lead_id ? q(supabase.from('leads').select('*').eq('id', deal.lead_id).eq('user_id', userId).maybeSingle()) : null,
    deal.buyer_id ? q(supabase.from('buyers').select('id, name, phone, email, buyer_type, cash_only, proof_of_funds, max_price').eq('id', deal.buyer_id).eq('user_id', userId).maybeSingle()) : null,
    q(supabase.from('users').select('company_name, full_name').eq('id', userId).maybeSingle()),
    deal.lead_id ? q(supabase.from('calls').select('ai_summary, motivation_score, seller_personality, key_signals, objections, outcome, created_at').eq('lead_id', deal.lead_id).eq('user_id', userId).not('ai_summary', 'is', null).order('created_at', { ascending: false }).limit(1)) : null,
    q(supabase.from('contracts').select('id, contract_type, signing_status, sent_at, fully_signed_at').eq('deal_id', dealId).eq('user_id', userId).order('created_at', { ascending: false }).limit(10)),
    q(supabase.from('title_logs').select('id, status, created_at').eq('deal_id', dealId).eq('user_id', userId).order('created_at', { ascending: false }).limit(5)),
    q(supabase.from('follow_ups').select('id, status, next_follow_up_at, follow_up_type').eq('deal_id', dealId).eq('user_id', userId).eq('status', 'scheduled').limit(10)),
    q(supabase.from('comparables').select('*').eq('deal_id', dealId).eq('user_id', userId).order('retrieved_at', { ascending: false }).limit(50)),
  ]);
  return { deal, lead, buyer, owner, lastCall: Array.isArray(lastCall) ? lastCall[0] || null : null, contracts: contracts || [], titleLogs: titleLogs || [], followUps: followUps || [], comps: comps || [] };
}

// Pull provider data when a connector is available. Failures become data gaps, not errors.
async function fetchProviderData(address, zip) {
  const gaps = [];
  const out = { record: null, value: null, rent: null, market: null };
  if (!address) { gaps.push({ source: 'property data', reason: 'No full property address (street plus city/state) on the deal' }); return { out, gaps }; }
  const rc = connectors.providerFor('value_estimate');
  if (!rc) { gaps.push({ source: 'property data', reason: 'No property data provider is connected' }); return { out, gaps }; }
  const settle = async (label, fn) => {
    try { return await fn(); } catch (err) { gaps.push({ source: `${rc.name} ${label}`, reason: err.message, code: err.code || null }); return null; }
  };
  // One failure (e.g. inactive subscription) usually means all fail; stop early to avoid repeated billing errors.
  out.record = await settle('property record', () => rc.propertyRecord(address));
  if (gaps.some(g => ['SUBSCRIPTION_INACTIVE', 'AUTH_FAILED', 'NOT_CONFIGURED'].includes(g.code))) return { out, gaps };
  [out.value, out.rent, out.market] = await Promise.all([
    settle('value estimate', () => rc.valueEstimate(address)),
    settle('rent estimate', () => rc.rentEstimate(address)),
    zip ? settle('market statistics', () => rc.marketStatistics(zip)) : Promise.resolve(null),
  ]);
  return { out, gaps };
}

function fullAddress(d, lead) {
  const street = d.property_address || lead?.property_address;
  const city = d.property_city || lead?.property_city;
  const state = d.property_state || lead?.property_state;
  const zip = d.property_zip || lead?.property_zip;
  if (!street || !(city || state)) return null;
  return [street, city, state, zip].filter(Boolean).join(', ');
}

function compose(records, provider, overrides = {}) {
  const { deal: d, lead: l, buyer: b, owner, lastCall, contracts, titleLogs, followUps, comps } = records;
  const L = (v, extra = {}) => claim(nonEmpty(v), STATUS.UNVERIFIED, { source: LEAD_SOURCE, source_tier: 'secondary', ...extra });
  const D = (v, extra = {}) => claim(nonEmpty(v), STATUS.UNVERIFIED, { source: DEAL_SOURCE, source_tier: 'secondary', ...extra });
  const T = (v, extra = {}) => claim(nonEmpty(v), STATUS.USER_PROVIDED, { source: DEAL_SOURCE, source_tier: 'operator', ...extra });
  const rec = provider.record?.found ? provider.record.facts : {};
  const pick = (a, bClaim) => reconcile(a, bClaim, { tolerance: 0.03 });
  const conflicts = [];
  const choose = (field, ...claims) => {
    let chosen = unknown();
    for (const c of claims.filter(Boolean)) {
      const r = pick(chosen, c);
      if (r.conflict) conflicts.push({ field, values: [r.conflict.a, r.conflict.b], reason: r.conflict.reason });
      chosen = r.chosen;
    }
    return chosen;
  };
  const research = l?.research_data && typeof l.research_data === 'object' ? l.research_data : null;
  const researchAt = l?.research_at || null;
  const R = (v, basis) => claim(n(v), STATUS.ESTIMATED, { source: 'RentCast (cached on lead)', source_tier: 'licensed_provider', as_of: researchAt, basis });

  const rep = {
    property: {
      address: choose('property.address', D(d.property_address), L(l?.property_address)),
      city: choose('property.city', D(d.property_city), L(l?.property_city)),
      state: choose('property.state', D(d.property_state), L(l?.property_state)),
      zip: choose('property.zip', D(d.property_zip), L(l?.property_zip)),
      county: choose('property.county', L(l?.county), rec.county),
      parcel_id: choose('property.parcel_id', L(l?.parcel_id), rec.parcel_id),
      property_type: choose('property.property_type', L(l?.property_type), rec.property_type),
      units: choose('property.units', rec.units),
      sqft: choose('property.sqft', rec.sqft),
      lot_sqft: choose('property.lot_sqft', rec.lot_sqft),
      bedrooms: choose('property.bedrooms', rec.bedrooms),
      bathrooms: choose('property.bathrooms', rec.bathrooms),
      year_built: choose('property.year_built', rec.year_built),
      condition: unknown(),
      zoning: choose('property.zoning', rec.zoning),
      occupancy: choose('property.occupancy',
        l?.is_vacant === true ? L('vacant') : l?.owner_occupied === true ? L('owner_occupied') : l?.is_absentee_owner === true ? L('absentee_owner') : null,
        rec.owner_occupied?.value === true ? claim('owner_occupied', rec.owner_occupied.status, rec.owner_occupied) : rec.owner_occupied?.value === false ? claim('not_owner_occupied', rec.owner_occupied.status, rec.owner_occupied) : null),
      ownership: {
        owner_names: choose('property.ownership.owner_names', rec.owner_names),
        owner_type: choose('property.ownership.owner_type', rec.owner_type),
        years_owned: choose('property.ownership.years_owned', L(n(l?.years_owned))),
        deed_type: choose('property.ownership.deed_type', L(l?.deed_type)),
        last_sale_price: choose('property.ownership.last_sale_price', rec.last_sale_price),
        last_sale_date: choose('property.ownership.last_sale_date', rec.last_sale_date),
      },
      financing: {
        loan_balance: L(n(l?.mortgage_balance)),
        interest_rate: L(n(l?.interest_rate)),
        monthly_payment: L(n(l?.est_monthly_payment)),
        arrears: L(n(l?.arrears_amount)),
        loan_type: L(l?.loan_type),
      },
      liens: {
        summary: unknown('No title report on file'),
        lis_pendens: l?.has_lis_pendens === true ? L(true) : unknown(),
        tax_owed: L(n(l?.tax_owed)),
        years_tax_delinquent: L(n(l?.years_delinquent)),
      },
      taxes: { annual: choose('property.taxes.annual', rec.annual_property_tax), assessed_value: choose('property.taxes.assessed_value', rec.assessed_value) },
      insurance: { annual: unknown() },
      distress: {
        probate: l?.probate_case === true ? L(true) : unknown(),
        foreclosure_stage: L(l?.foreclosure_stage),
        vacant: typeof l?.is_vacant === 'boolean' ? L(l.is_vacant) : unknown(),
        absentee_owner: typeof l?.is_absentee_owner === 'boolean' ? L(l.is_absentee_owner) : unknown(),
        signals: L(Array.isArray(l?.distress_signals) && l.distress_signals.length ? l.distress_signals : null),
        primary_tag: L(l?.primary_tag),
      },
      market: {
        median_list_price: provider.market?.found ? provider.market.metrics.median_list_price : unknown(),
        median_days_on_market: provider.market?.found ? provider.market.metrics.median_days_on_market : unknown(),
        median_rent: provider.market?.found ? provider.market.metrics.median_rent : unknown(),
      },
    },
    people: {
      seller: {
        name: choose('people.seller.name', T(d.seller_name), L([l?.first_name, l?.last_name].filter(Boolean).join(' ') || null)),
        phone_on_file: claim(!!(d.seller_phone || l?.phone), STATUS.USER_PROVIDED, { source: DEAL_SOURCE }),
        email_on_file: claim(!!(d.seller_email || l?.email), STATUS.USER_PROVIDED, { source: DEAL_SOURCE }),
        motivation_score: lastCall?.motivation_score != null
          ? claim(n(lastCall.motivation_score), STATUS.INFERRED, { source: 'AI call analysis', source_tier: 'model', as_of: lastCall.created_at })
          : l?.motivation_score != null ? claim(n(l.motivation_score), STATUS.INFERRED, { source: 'lead scoring', source_tier: 'model' }) : unknown(),
        personality: claim(lastCall?.seller_personality || l?.seller_personality || null, STATUS.INFERRED, { source: 'AI call analysis', source_tier: 'model' }),
        timeline_days: L(n(l?.seller_timeline_days)),
        objectives: claim(l?.seller_timeline_note || null, STATUS.UNVERIFIED, { source: 'seller conversation notes' }),
        last_call_summary: claim(lastCall?.ai_summary || null, STATUS.INFERRED, { source: 'AI call summary', source_tier: 'model', as_of: lastCall?.created_at }),
        key_signals: claim(Array.isArray(lastCall?.key_signals) && lastCall.key_signals.length ? lastCall.key_signals : null, STATUS.INFERRED, { source: 'AI call analysis', source_tier: 'model' }),
        objections: claim(Array.isArray(lastCall?.objections) && lastCall.objections.length ? lastCall.objections : null, STATUS.INFERRED, { source: 'AI call analysis', source_tier: 'model' }),
        consent_to_text: claim(l ? l.consent === true : null, STATUS.USER_PROVIDED, { source: LEAD_SOURCE }),
      },
      buyer: b ? {
        id: claim(b.id, STATUS.USER_PROVIDED, { source: 'buyers' }), name: claim(b.name, STATUS.USER_PROVIDED, { source: 'buyers' }),
        cash_only: claim(b.cash_only, STATUS.USER_PROVIDED, { source: 'buyers' }), proof_of_funds: claim(b.proof_of_funds, STATUS.USER_PROVIDED, { source: 'buyers' }),
      } : { id: unknown('No buyer assigned') },
      operator: { company: claim(owner?.company_name || null, STATUS.USER_PROVIDED, { source: 'account profile' }) },
      title_company_assigned: claim(!!d.title_company_id, STATUS.USER_PROVIDED, { source: DEAL_SOURCE }),
    },
    transaction: {
      stage: T(d.status),
      structure: T(d.deal_type),
      asking_price: unknown(),
      offer_price: T(n(d.offer_price)),
      contract_price: T(n(d.seller_agreed_price)),
      buyer_price: T(n(d.buyer_price)),
      assignment_fee: T(n(d.assignment_fee)),
      closing_date: T(d.closing_date),
      contract_status: T(d.contract_status),
      emd: { amount: T(n(d.emd_amount)), status: T(d.emd_status) },
      contracts: claim(contracts.length ? contracts.map(c => ({ type: c.contract_type, status: c.signing_status, sent_at: c.sent_at, signed_at: c.fully_signed_at })) : null, STATUS.VERIFIED, { source: 'contracts table' }),
      title: claim(titleLogs.length ? titleLogs.map(t => ({ status: t.status, at: t.created_at })) : null, STATUS.VERIFIED, { source: 'title_logs table' }),
      scheduled_follow_ups: claim(followUps.length, STATUS.VERIFIED, { source: 'follow_ups table' }),
    },
    financial: {
      arv: choose('financial.arv', D(n(d.arv)), L(n(l?.estimated_arv)), research ? R(research.arv, `ARV from RentCast (${research.arv_source || 'unknown basis'})`) : null),
      as_is_value: choose('financial.as_is_value', D(n(d.estimated_value)), L(n(l?.estimated_value)),
        provider.value?.found ? provider.value.value : null, research ? R(research.as_is_value, 'RentCast AVM as-is value') : null),
      repairs: D(n(d.repair_estimate)),
      mao_on_record: D(n(d.mao)),
      market_rent: choose('financial.market_rent', D(n(d.estimated_rent)), provider.rent?.found ? provider.rent.rent : null, research ? R(research.rent_estimate, 'RentCast rent AVM') : null),
      equity_on_record: choose('financial.equity_on_record', D(n(d.estimated_equity)), L(n(l?.estimated_equity))),
    },
  };

  // Operator edits (USER_PROVIDED) layered on top; conflicts with stronger claims are kept visible.
  for (const [path, o] of Object.entries(overrides || {})) {
    const current = getPath(rep, path);
    if (!current || typeof current !== 'object' || !('status' in current)) continue;
    const userClaim = claim(o.value, STATUS.USER_PROVIDED, { source: 'operator (Deal Room)', source_tier: 'operator', as_of: o.set_at });
    const r = reconcile(current, userClaim, { tolerance: 0.03 });
    if (r.conflict) conflicts.push({ field: path, values: [r.conflict.a, r.conflict.b], reason: 'Operator value differs from recorded data' });
    setPath(rep, path, r.chosen.status === STATUS.UNKNOWN ? userClaim : r.chosen);
  }

  // Derived figures - calculation engine only.
  const value = rep.financial.as_is_value;
  const debt = rep.property.financing.loan_balance;
  if (value.value != null && debt.value != null) {
    rep.financial.equity = derived(value.value - debt.value, [value, debt], { basis: 'as-is value − loan balance' });
  } else {
    rep.financial.equity = unknown('Needs as-is value and loan balance');
  }
  const arv = rep.financial.arv, repairs = rep.financial.repairs;
  if (arv.value != null && repairs.value != null) {
    const m = S.wholesaleMao({ arv: arv.value, repairs: repairs.value });
    rep.financial.mao_calculated = { ...derived(m.output.mao, [arv, repairs], { basis: m.formula }), calculation: m };
  } else {
    rep.financial.mao_calculated = unknown('Needs ARV and repair estimate');
  }
  const cp = rep.transaction.contract_price, bp = rep.transaction.buyer_price;
  rep.financial.spread = cp.value != null && bp.value != null ? derived(bp.value - cp.value, [cp, bp], { basis: 'buyer price − contract price' }) : unknown('Needs contract price and buyer price');

  rep.comparables = [
    ...comps.map(c => ({ address: c.address, price: n(c.price), price_type: c.price_type, date: c.event_date, sqft: c.sqft, distance_miles: n(c.distance_miles), correlation: n(c.correlation), source: c.source, retrieved_at: c.retrieved_at })),
  ];
  if (provider.value?.found) {
    for (const c of provider.value.comparables) {
      if (!rep.comparables.some(x => x.address === c.address && x.source === c.source)) {
        rep.comparables.push({ address: c.address, price: c.price, price_type: c.price_type, date: c.removed_date || c.listed_date, sqft: c.sqft, distance_miles: c.distance_miles, correlation: c.correlation, source: c.source, retrieved_at: c.retrieved_at, listing_status: c.listing_status });
      }
    }
  }
  const soldComps = rep.comparables.filter(c => c.price_type === 'sold').length;
  rep.financial.comparable_evidence = claim({ sold: soldComps, listings: rep.comparables.length - soldComps }, STATUS.VERIFIED, { source: 'comparables on file' });

  rep.conflicts = conflicts;
  return rep;
}

async function persistGraph(userId, records, rep, provider) {
  const { deal, lead } = records;
  const now = new Date().toISOString();
  let propertyId = deal.property_id || null;
  const propRow = {
    user_id: userId, lead_id: deal.lead_id || null,
    address: rep.property.address.value, city: rep.property.city.value, state: rep.property.state.value, zip: rep.property.zip.value,
    county: rep.property.county.value, parcel_id: rep.property.parcel_id.value, property_type: rep.property.property_type.value,
    zoning: rep.property.zoning.value, units: n(rep.property.units.value), sqft: n(rep.property.sqft.value), lot_sqft: n(rep.property.lot_sqft.value),
    bedrooms: n(rep.property.bedrooms.value), bathrooms: n(rep.property.bathrooms.value), year_built: n(rep.property.year_built.value),
    occupancy: rep.property.occupancy.value, facts: rep.property, updated_at: now,
  };
  if (propertyId) {
    await supabase.from('properties').update(propRow).eq('id', propertyId).eq('user_id', userId);
  } else if (deal.lead_id) {
    const { data } = await supabase.from('properties').upsert(propRow, { onConflict: 'user_id,lead_id' }).select('id').single();
    propertyId = data?.id || null;
  } else {
    const { data } = await supabase.from('properties').insert(propRow).select('id').single();
    propertyId = data?.id || null;
  }
  await supabase.from('transactions').upsert({
    user_id: userId, deal_id: deal.id, stage: deal.status, structure_type: deal.deal_type || null,
    status: ['closed', 'lost'].includes(deal.status) ? deal.status : 'open', terms: rep.transaction, updated_at: now,
  }, { onConflict: 'deal_id' });
  if (propertyId && provider.value?.found && provider.value.comparables.length) {
    const rows = provider.value.comparables.filter(c => c.address).map(c => ({
      user_id: userId, deal_id: deal.id, property_id: propertyId, address: c.address, price: c.price, price_type: 'listed',
      event_date: (c.removed_date || c.listed_date || '').slice(0, 10) || null, sqft: c.sqft, bedrooms: c.bedrooms, bathrooms: c.bathrooms,
      year_built: c.year_built, distance_miles: c.distance_miles, correlation: c.correlation, source: c.source, source_record_id: c.source_record_id, retrieved_at: c.retrieved_at,
    }));
    if (rows.length) await supabase.from('comparables').upsert(rows, { onConflict: 'user_id,property_id,source,address' });
  }
  // Seller person record (one per deal).
  const sellerName = rep.people.seller.name.value;
  if (sellerName) {
    const { data: existing } = await supabase.from('persons').select('id').eq('user_id', userId).eq('deal_id', deal.id).eq('role', 'seller').maybeSingle();
    const person = { user_id: userId, deal_id: deal.id, lead_id: lead?.id || null, role: 'seller', full_name: sellerName, phone: deal.seller_phone || lead?.phone || null, email: deal.seller_email || lead?.email || null, updated_at: now };
    if (existing) await supabase.from('persons').update(person).eq('id', existing.id).eq('user_id', userId);
    else await supabase.from('persons').insert(person);
  }
  return propertyId;
}

/**
 * Build (or rebuild) the deal understanding.
 * @returns {Promise<object|null>} understanding, or null if the deal isn't this tenant's
 */
async function build(userId, dealId, { refreshProviders = true, actorUserId = null, runId = null } = {}) {
  const records = await loadRecords(userId, dealId);
  if (!records) return null;
  const previous = records.deal.understanding && typeof records.deal.understanding === 'object' ? records.deal.understanding : {};
  const overrides = previous.overrides || {};
  const address = fullAddress(records.deal, records.lead);
  const zip = records.deal.property_zip || records.lead?.property_zip || null;

  let provider = { record: null, value: null, rent: null, market: null };
  let gaps = [];
  if (refreshProviders) {
    ({ out: provider, gaps } = await fetchProviderData(address, zip));
  } else if (previous.meta?.provider_snapshot) {
    provider = previous.meta.provider_snapshot;
  }

  const rep = compose(records, provider, overrides);
  rep.overrides = overrides;
  rep.worksheets = previous.worksheets || {};
  rep.data_gaps = gaps;
  rep.unknowns = collectUnknowns(rep);
  rep.meta = {
    deal_id: records.deal.id, built_at: new Date().toISOString(), version: 1,
    counts: { unknown: rep.unknowns.length, conflicts: rep.conflicts.length },
    provider_snapshot: provider,
  };
  const propertyId = await persistGraph(userId, records, rep, provider);
  const { error } = await supabase.from('deals').update({ understanding: rep, understanding_updated_at: rep.meta.built_at, ...(propertyId && !records.deal.property_id ? { property_id: propertyId } : {}) })
    .eq('id', dealId).eq('user_id', userId);
  if (error) throw error;
  await audit.record({ userId, dealId, runId, actorUserId, agentId: 'deal_understanding_engine', actionType: 'deal.understanding.built',
    inputs: { refresh_providers: refreshProviders, address_present: !!address }, outputs: { unknowns: rep.unknowns.length, conflicts: rep.conflicts.length, data_gaps: gaps } });
  return rep;
}

async function get(userId, dealId) {
  if (!UUID_RE.test(String(dealId))) return null;
  const { data, error } = await supabase.from('deals').select('id, understanding, understanding_updated_at').eq('id', dealId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data || null;
}

// Operator edits: stored as USER_PROVIDED overrides, then the representation rebuilds.
const EDITABLE = new Set(Object.keys(FIELD_CATALOG).concat(['property.condition', 'transaction.asking_price', 'financial.repairs', 'financial.arv', 'financial.as_is_value', 'financial.market_rent', 'property.insurance.annual']));
async function setOverrides(userId, dealId, actorUserId, patch) {
  const current = await get(userId, dealId);
  if (!current) return null;
  const overrides = { ...(current.understanding?.overrides || {}) };
  const applied = {};
  for (const [path, value] of Object.entries(patch || {})) {
    if (!EDITABLE.has(path)) throw Object.assign(new Error(`${path} can't be edited`), { status: 400 });
    if (value === null) { delete overrides[path]; applied[path] = null; continue; }
    if (typeof value === 'string' && value.length > 1000) throw Object.assign(new Error(`${path} is too long`), { status: 400 });
    if (typeof value === 'number' && !Number.isFinite(value)) throw Object.assign(new Error(`${path} must be a number`), { status: 400 });
    overrides[path] = { value, set_by: actorUserId, set_at: new Date().toISOString() };
    applied[path] = value;
  }
  const { error } = await supabase.from('deals').update({ understanding: { ...(current.understanding || {}), overrides } }).eq('id', dealId).eq('user_id', userId);
  if (error) throw error;
  await audit.record({ userId, dealId, actorUserId, actionType: 'deal.understanding.operator_edit', inputs: applied, humanApproved: true });
  return build(userId, dealId, { refreshProviders: false, actorUserId });
}

// Structured operator worksheets (rent roll, rehab scope, ...). Stored as-is on the
// understanding, labelled USER_PROVIDED; each agent validates the fields it reads.
const WORKSHEETS = {
  rent_roll: 'Units with rent, status and lease end (multifamily, rental)',
  operating_statement: 'Annual income and expense lines (multifamily, commercial, self storage)',
  rehab_scope: 'Rehab line items: item, quantity, unit cost (rehab estimation)',
  construction_budget: 'Budget, spent to date, contractors, change orders, schedule (construction management)',
  land: 'Acreage, zoning, access, utilities, flood zone, easements, topography (land)',
  negotiation_notes: 'What the seller said about price, timeline, needs and constraints (negotiation)',
  jv_terms: 'Equity contributions, preferred return, promote, hold years (equity / JV)',
  loan_quotes: 'Lender quotes: type, rate, points, fees, LTV/LTC, term, min DSCR (financing)',
  due_diligence: 'Checklist item statuses (due diligence)',
};
async function setWorksheet(userId, dealId, actorUserId, name, data) {
  if (!WORKSHEETS[name]) throw Object.assign(new Error(`Unknown worksheet "${name}"`), { status: 400 });
  if (data !== null && (typeof data !== 'object')) throw Object.assign(new Error('Worksheet data must be an object or array'), { status: 400 });
  if (data !== null && JSON.stringify(data).length > 50000) throw Object.assign(new Error('Worksheet is too large'), { status: 413 });
  const current = await get(userId, dealId);
  if (!current) return { found: false };
  const worksheets = { ...(current.understanding?.worksheets || {}) };
  if (data === null) delete worksheets[name];
  else worksheets[name] = { data, status: STATUS.USER_PROVIDED, set_by: actorUserId, set_at: new Date().toISOString() };
  const { error } = await supabase.from('deals').update({ understanding: { ...(current.understanding || {}), worksheets } }).eq('id', dealId).eq('user_id', userId);
  if (error) throw error;
  await audit.record({ userId, dealId, actorUserId, actionType: `deal.worksheet.${data === null ? 'cleared' : 'saved'}`, inputs: { name, size: data === null ? 0 : JSON.stringify(data).length }, humanApproved: true });
  return { found: true, worksheet: worksheets[name] || null };
}

module.exports = { WORKSHEETS, setWorksheet, build, get, setOverrides, compose, collectUnknowns, FIELD_CATALOG, EDITABLE, getPath };
