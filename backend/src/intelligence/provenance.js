// ─── Provenance: every fact carries where it came from ──────────────────────
// A Claim is { value, status, source, source_tier, jurisdiction, as_of, confidence, basis, note }.
// Status is one of seven epistemic states. Code must never upgrade a status
// (ESTIMATED can't become VERIFIED by being passed along), so helpers only ever
// keep or downgrade it.

const STATUS = Object.freeze({
  VERIFIED: 'VERIFIED',             // confirmed by an authoritative external source
  USER_PROVIDED: 'USER_PROVIDED',   // the operator supplied it
  CALCULATED: 'CALCULATED',         // derived by the calculation engine, inputs shown
  ESTIMATED: 'ESTIMATED',           // reasoned estimate, assumptions shown
  INFERRED: 'INFERRED',             // derived from several evidence points
  UNVERIFIED: 'UNVERIFIED',         // reported but not confirmed
  UNKNOWN: 'UNKNOWN',               // not obtained
});

// Higher = stronger. Used to pick the weakest link when combining inputs.
const STRENGTH = { VERIFIED: 6, USER_PROVIDED: 5, CALCULATED: 4, ESTIMATED: 3, INFERRED: 2, UNVERIFIED: 1, UNKNOWN: 0 };

// Source priority when two sources disagree (rule 3).
const SOURCE_TIER = { government: 5, regulatory: 4, licensed_provider: 3, primary_document: 2, operator: 2, secondary: 1, model: 0 };

function isStatus(s) { return Object.prototype.hasOwnProperty.call(STATUS, s); }

function claim(value, status, { source = null, source_tier = null, jurisdiction = null, as_of = null, confidence = null, basis = null, note = null } = {}) {
  if (!isStatus(status)) throw new Error(`Unknown provenance status: ${status}`);
  const empty = value === undefined || value === null || value === '' || (typeof value === 'number' && !Number.isFinite(value));
  const finalStatus = empty ? STATUS.UNKNOWN : status;
  let conf = confidence == null ? null : Math.max(0, Math.min(100, Math.round(Number(confidence))));
  if (finalStatus === STATUS.UNKNOWN) conf = 0;
  return {
    value: empty ? null : value,
    status: finalStatus,
    source: source || null,
    source_tier: source_tier || null,
    jurisdiction: jurisdiction || null,
    as_of: as_of ? new Date(as_of).toISOString() : null,
    confidence: conf,
    basis: basis || null,
    note: note || null,
  };
}

const unknown = (why = null) => claim(null, STATUS.UNKNOWN, { note: why });

// A calculated result is only as strong as its weakest input.
function derived(value, inputs, { source = 'calculation_engine', basis = null } = {}) {
  const list = (inputs || []).filter(Boolean);
  if (list.some(c => c.status === STATUS.UNKNOWN)) return unknown('An input to this calculation is unknown');
  const weakest = list.reduce((w, c) => (STRENGTH[c.status] < STRENGTH[w.status] ? c : w), { status: STATUS.CALCULATED });
  const status = STRENGTH[weakest.status] < STRENGTH.CALCULATED ? weakest.status : STATUS.CALCULATED;
  const confs = list.map(c => c.confidence).filter(c => c != null);
  return claim(value, status, { source, basis, confidence: confs.length ? Math.min(...confs) : null });
}

// Staleness: a claim older than maxAgeDays is flagged, never silently trusted.
function freshness(c, maxAgeDays) {
  if (!c || !c.as_of) return { fresh: false, reason: 'No timestamp: freshness cannot be established - treat as potentially stale' };
  const ageDays = (Date.now() - new Date(c.as_of).getTime()) / 86400000;
  return ageDays <= maxAgeDays
    ? { fresh: true, age_days: Math.round(ageDays) }
    : { fresh: false, age_days: Math.round(ageDays), reason: `Older than ${maxAgeDays} days` };
}

// Pick between two claims about the same fact by the epistemic priority order:
// accuracy (status) > source quality > freshness. Returns { chosen, conflict }.
function reconcile(a, b, { tolerance = 0 } = {}) {
  if (!a || a.status === STATUS.UNKNOWN) return { chosen: b, conflict: null };
  if (!b || b.status === STATUS.UNKNOWN) return { chosen: a, conflict: null };
  const differ = typeof a.value === 'number' && typeof b.value === 'number'
    ? Math.abs(a.value - b.value) > tolerance * Math.max(Math.abs(a.value), Math.abs(b.value))
    : JSON.stringify(a.value) !== JSON.stringify(b.value);
  const rank = (c) => [STRENGTH[c.status], SOURCE_TIER[c.source_tier] ?? 0, c.as_of ? new Date(c.as_of).getTime() : 0];
  const ra = rank(a), rb = rank(b);
  let chosen = a;
  for (let i = 0; i < ra.length; i++) { if (ra[i] !== rb[i]) { chosen = ra[i] > rb[i] ? a : b; break; } }
  return { chosen, conflict: differ ? { a, b, reason: 'Sources disagree on this value' } : null };
}

module.exports = { STATUS, STRENGTH, SOURCE_TIER, isStatus, claim, unknown, derived, freshness, reconcile };
