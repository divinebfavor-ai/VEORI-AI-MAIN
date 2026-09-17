// Shared helpers for intelligence agents: reading claims from the deal
// understanding, building findings/missing items, and confidence from evidence.

const { STATUS, STRENGTH, claim } = require('../provenance');
const { getPath, FIELD_CATALOG } = require('../dealGraph');

const KNOWLEDGE_DATE = '2026-09-17';

function c(rep, path) {
  const v = getPath(rep, path);
  return v && typeof v === 'object' && 'status' in v ? v : claim(null, STATUS.UNKNOWN);
}
function val(rep, path) { return c(rep, path).value; }
function known(rep, path) { return c(rep, path).status !== STATUS.UNKNOWN; }

const finding = (label, cl, extra = {}) => ({ label, claim: cl, ...extra });

function missingItem(path, override = {}) {
  const [why, how] = FIELD_CATALOG[path] || ['Needed for this analysis.', 'Ask the seller or pull the record.'];
  return { item: override.item || path, why_it_matters: override.why || why, how_to_get: override.how || how };
}

function missingFrom(rep, paths) {
  return paths.filter(p => !known(rep, p)).map(p => missingItem(p));
}

// Confidence from the evidence behind the inputs an agent relied on.
// Each input contributes by status strength; unknown inputs pull it down.
function evidenceConfidence(rep, paths, { base = 90 } = {}) {
  if (!paths.length) return { score: 0, reasoning: 'No inputs' };
  const statuses = paths.map(p => c(rep, p).status);
  const avg = statuses.reduce((s, st) => s + STRENGTH[st] / STRENGTH.VERIFIED, 0) / statuses.length;
  const unknownCount = statuses.filter(s => s === STATUS.UNKNOWN).length;
  const score = Math.round(base * avg);
  const counts = statuses.reduce((m, s) => { m[s] = (m[s] || 0) + 1; return m; }, {});
  return {
    score,
    reasoning: `Based on ${paths.length} inputs: ${Object.entries(counts).map(([s, k]) => `${k} ${s.toLowerCase()}`).join(', ')}.${unknownCount ? ` ${unknownCount} unknown input(s) lower confidence.` : ''}`,
  };
}

const money = (n) => (n == null || !Number.isFinite(Number(n)) ? 'unknown' : `$${Math.round(Number(n)).toLocaleString('en-US')}`);

function sourcesOf(rep, paths) {
  const seen = new Map();
  for (const p of paths) {
    const cl = c(rep, p);
    if (cl.source && cl.status !== STATUS.UNKNOWN) seen.set(cl.source, { name: cl.source, tier: cl.source_tier, as_of: cl.as_of });
  }
  return [...seen.values()];
}

// Pick the strongest known claim among paths (for "best available" inputs).
function strongest(rep, paths) {
  return paths.map(p => ({ path: p, claim: c(rep, p) }))
    .filter(x => x.claim.status !== STATUS.UNKNOWN)
    .sort((a, b) => STRENGTH[b.claim.status] - STRENGTH[a.claim.status])[0] || null;
}

// Numeric input: explicit ctx.inputs override (USER_PROVIDED) or the representation.
function input(ctx, key, path) {
  const v = ctx.inputs ? ctx.inputs[key] : undefined;
  if (v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v))) {
    return claim(Number(v), STATUS.USER_PROVIDED, { source: 'operator input (this request)', source_tier: 'operator' });
  }
  return path ? c(ctx.understanding, path) : claim(null, STATUS.UNKNOWN);
}

module.exports = { KNOWLEDGE_DATE, c, val, known, finding, missingItem, missingFrom, evidenceConfidence, money, sourcesOf, strongest, input, STATUS };
