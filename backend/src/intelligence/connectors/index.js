// ─── Data connector framework ────────────────────────────────────────────────
// One place that knows which data sources exist, whether each is connected, and
// what it can provide. Agents ask for a capability ("value_estimate"), never a
// vendor, so adding a provider doesn't change agent code.
//
// Only providers with a verified API integration are implemented. Others the
// platform intends to support are listed as not built, with the reason, so the
// UI and agents can say "not available" instead of pretending.

const rentcast = require('./rentcast');

const IMPLEMENTED = [rentcast];

const NOT_BUILT = [
  { id: 'batchdata', name: 'BatchData', capabilities: ['property_record', 'owner_contact', 'skip_trace'], reason: 'Property-search integration not built yet; skip trace uses BATCH_SKIP_TRACE_API_KEY separately.' },
  { id: 'propstream', name: 'PropStream', capabilities: ['property_record', 'distress_lists'], reason: 'No public API integration in this codebase.' },
  { id: 'mls', name: 'MLS market feeds', capabilities: ['sold_comparables', 'listings'], reason: 'Requires an MLS/IDX data agreement; no feed is connected.' },
  { id: 'regrid', name: 'Regrid', capabilities: ['parcel', 'zoning'], reason: 'Not built.' },
  { id: 'reonomy', name: 'Reonomy', capabilities: ['commercial_property'], reason: 'Not built.' },
  { id: 'trepp', name: 'Trepp', capabilities: ['cmbs_loan_maturity'], reason: 'Not built; requires a Trepp data license.' },
];

function status() {
  return [
    ...IMPLEMENTED.map(c => ({ id: c.id, name: c.name, provider_type: c.provider_type, capabilities: c.capabilities, connected: c.isConfigured(), built: true, env: c.env, terms: c.terms })),
    ...NOT_BUILT.map(c => ({ ...c, connected: false, built: false })),
  ];
}

// First connected provider offering the capability, or null.
function providerFor(capability) {
  return IMPLEMENTED.find(c => c.capabilities.includes(capability) && c.isConfigured()) || null;
}

function available(capability) { return !!providerFor(capability); }

module.exports = { status, providerFor, available, rentcast };
