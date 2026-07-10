// ─────────────────────────────────────────────────────────────────────────────
// followupSweep - the pipeline-wide "no lead dropped on the floor" detector.
//
// WHY THIS EXISTS: followUpAgent.computeDue() answers "is THIS one lead due?" for a
// single canonical record the orchestrator already loaded. It does NOT scan the
// fleet. This module is the zero-missed-follow-up SWEEP: it enumerates every ACTIVE
// lead a tenant owns and runs the EXISTING detector across all of them, so the
// operation can see - in one call - every follow-up that is due or overdue right now.
//
// ALL CADENCES, NOT JUST CALLS: the detector keys off lastContactAt, and leadMemory
// derives that from conversation_memory + conversations + deal_activity +
// lead.last_contacted_at (leadMemory.js:126-131). So a text, an email, or any logged
// activity counts as a touch - a lead is only "overdue" when NO channel has touched
// it within its cadence. This is the "not just calls" requirement made real: we reuse
// the multi-channel lastContactAt the memory layer already computes; we do not
// re-define contact as "last call".
//
// INHERIT, DON'T REINVENT (spine rule 1):
//   - Ownership + canonical assembly: getLeadCanonical (already tenant-guarded).
//   - Due/overdue math + cadence + opt-out: followUpAgent.computeDue (the one detector).
//   - Active-exclusion set: cooService.ACTIVE_EXCLUDE (closed/dead/dnc/under_contract),
//     so this sweep and the COO briefing agree on what "active" means.
//
// READ-ONLY + TENANT-FENCED (fail-closed): one leads query, .eq('user_id', userId);
// each canonical fetch is itself ownership-guarded. It sends nothing and writes
// nothing - it emits a defect list the Follow-Up agent / orchestrator then acts on
// (each send still clears the compliance gate). A missing table degrades to empty.
// ─────────────────────────────────────────────────────────────────────────────

const supabase = require('../config/supabase');
const { getLeadCanonical } = require('./leadMemory');
const { computeDue } = require('./followUpAgent');
const { ACTIVE_EXCLUDE } = require('../services/cooService');

// Ceiling on how many leads ONE sweep call will assemble+score. This is a runaway
// guardrail, not a page size: the fetch below pages the DB in PAGE_SIZE chunks until
// it has up to maxLeads active rows, so a tenant with tens of thousands of active
// leads is fully enumerated in one call (bounded by this ceiling) instead of silently
// truncated at 500. Callers wanting the whole fleet pass a higher opts.maxLeads.
const DEFAULT_MAX_LEADS = 50000;

// DB page size for the active-lead enumeration. Supabase/PostgREST caps a single
// response, so we walk .range() windows of this size until we have maxLeads or the
// table is exhausted. Kept modest so each round-trip is cheap and memory stays flat.
const PAGE_SIZE = 1000;

// How many canonical assemblies run at once. The old sweep awaited getLeadCanonical
// strictly one-at-a-time (N sequential round-trips = minutes at scale). We instead
// run a bounded window of assemblies concurrently: ~CONCURRENCY-x less wall-clock
// while never opening an unbounded number of DB connections. Tunable via env for a
// per-deploy ceiling; the bound is the whole point (do NOT remove it).
const CONCURRENCY = Number(process.env.FOLLOWUP_SWEEP_CONCURRENCY) || 25;

// Severity from how far past cadence a lead is. overdue (missed a full extra cycle)
// is the logged DEFECT; merely due is a warning; never-contacted is high (a brand
// new lead nobody has touched is exactly the "dropped on the floor" case).
function severityFor(due) {
  if (due.optedOut) return null;                 // opt-out ends cadence - not a defect
  if (due.lastContactAt == null) return 'high';  // never contacted → must not sit
  if (due.overdue) return 'high';                // missed a full extra cycle → defect
  if (due.due) return 'medium';                  // due now, not yet a full miss
  return null;                                   // on-cadence
}

function tableMissing(err) {
  return err?.code === 'PGRST205' || (err?.message || '').includes('does not exist');
}

/**
 * Fetch the ACTIVE lead ids for a tenant (tenant-fenced). Active = status not in
 * ACTIVE_EXCLUDE. Returns [] on a missing table (fail-soft), never another tenant's
 * rows (the .eq('user_id') fence is mandatory).
 *
 * @param {string} userId
 * @param {number} limit
 * @returns {Promise<Array<{id:string,status:string|null,last_contacted_at:string|null}>>}
 */
async function activeLeadRows(userId, limit) {
  const out = [];
  // Walk fixed .range() windows until we have `limit` rows or the table is exhausted.
  // Every page carries the SAME tenant fence + exclude filter + ordering, so paging
  // never loosens isolation and never re-orders the worst-first-by-staleness result.
  for (let offset = 0; offset < limit; offset += PAGE_SIZE) {
    const pageEnd = Math.min(offset + PAGE_SIZE, limit) - 1; // .range() is inclusive

    // Exclude the closed/dead states in the query itself so we never even assemble a
    // canonical record for a lead that is out of cadence by definition.
    let q = supabase
      .from('leads')
      .select('id, status, last_contacted_at')
      .eq('user_id', userId);

    if (Array.isArray(ACTIVE_EXCLUDE) && ACTIVE_EXCLUDE.length) {
      // PostgREST list syntax: not.in.(a,b,c)
      q = q.not('status', 'in', `(${ACTIVE_EXCLUDE.join(',')})`);
    }
    q = q
      .order('last_contacted_at', { ascending: true, nullsFirst: true })
      .range(offset, pageEnd);

    const { data, error } = await q;
    if (error) {
      if (tableMissing(error)) return out; // fail-soft: return what we have (empty on first page)
      throw error;
    }
    const page = data || [];
    out.push(...page);
    // Short page (fewer rows than we asked for) means the table is exhausted - stop.
    if (page.length < (pageEnd - offset + 1)) break;
  }
  return out;
}

/**
 * Assemble+score ONE active lead row: ownership-guarded canonical fetch, then the
 * deterministic computeDue detector. Returns { canonical, due } or null when the lead
 * is not owned (defensive; the query already fenced on user_id). Pure - no shared
 * state - so it is safe to run many of these concurrently.
 */
async function scoreRow(userId, row, now) {
  const canonical = await getLeadCanonical(userId, row.id);
  if (!canonical) return null;
  return { row, canonical, due: computeDue(canonical, now) };
}

/**
 * Run an async mapper over items with a fixed concurrency ceiling. A tiny bounded
 * worker pool: `limit` workers each pull the next index until the list is drained.
 * Results preserve input order. No external dependency - keeps the module self-contained.
 */
async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await mapper(items[i], i);
    }
  };
  const pool = Array.from({ length: Math.min(limit, items.length) || 0 }, worker);
  await Promise.all(pool);
  return results;
}

/**
 * Run the zero-missed-follow-up sweep across a tenant's active pipeline.
 *
 * For each active lead: assemble its canonical record (so lastContactAt reflects
 * EVERY channel) and run the deterministic computeDue detector. Collect the ones
 * that are due/overdue/never-contacted as defects, sorted worst-first.
 *
 * @param {string} userId               REQUIRED tenant fence
 * @param {object} [opts]
 * @param {Date}   [opts.now=new Date()] evaluation time (injectable for tests)
 * @param {number} [opts.maxLeads=DEFAULT_MAX_LEADS]
 * @returns {Promise<{
 *   scanned:number,
 *   due:Array<object>,        // due-now-not-yet-overdue
 *   overdue:Array<object>,    // missed a full extra cycle OR never contacted → DEFECTS
 *   optedOut:number,          // count skipped because cadence ended
 *   defects:Array<object>,    // logged-defect shape for the overdue set (orchestrator-ready)
 *   summary:{hot:number,warm:number,cold:number}
 * }>}
 */
async function sweep(userId, opts = {}) {
  if (!userId) throw new Error('followupSweep.sweep: userId required');
  const now = opts.now instanceof Date ? opts.now : new Date();
  const maxLeads = Number.isFinite(opts.maxLeads) ? opts.maxLeads : DEFAULT_MAX_LEADS;

  const rows = await activeLeadRows(userId, maxLeads);

  const due = [];
  const overdue = [];
  const defects = [];
  let optedOut = 0;
  const summary = { hot: 0, warm: 0, cold: 0 };

  // Assemble+score every row through a BOUNDED concurrent pool (was strictly
  // sequential). scoreRow is pure and returns null for a not-owned lead. The heavy
  // I/O (canonical assembly) parallelizes here; the classification below stays a
  // single ordered pass so the buckets/counts are byte-identical to the old sweep.
  const scored = await mapWithConcurrency(rows, CONCURRENCY, (row) => scoreRow(userId, row, now));

  for (const s of scored) {
    if (!s) continue; // not owned - defensive skip
    const { row, canonical, due: d } = s;

    if (d.temperature && summary[d.temperature] != null) summary[d.temperature] += 1;

    if (d.optedOut) { optedOut += 1; continue; }

    const severity = severityFor(d);
    if (!severity) continue; // on cadence → nothing owed

    const name = canonical.lead?.name || canonical.lead?.owner_name ||
      [canonical.lead?.first_name, canonical.lead?.last_name].filter(Boolean).join(' ') || 'unknown';
    const entry = {
      leadId: row.id,
      name,
      temperature: d.temperature,
      lastContactAt: d.lastContactAt,
      hoursSince: d.hoursSince,
      cadenceHours: d.cadenceHours,
      nextDueAt: d.nextDueAt,
      neverContacted: d.lastContactAt == null,
      overdue: d.overdue || d.lastContactAt == null,
      beyondMaxCadence: d.beyondMaxCadence,
      severity,
    };

    if (entry.overdue) {
      overdue.push(entry);
      defects.push({
        type: 'missed_followup',
        leadId: row.id,
        severity,
        detail: entry.neverContacted
          ? `Lead never contacted (${d.temperature}); no touch on any channel yet.`
          : `Follow-up overdue (${d.temperature}): ${d.hoursSince}h since last touch on any channel, cadence ${d.cadenceHours}h.`,
      });
    } else {
      due.push(entry);
    }
  }

  // Worst first: never-contacted / most-overdue at the top of each list.
  const byUrgency = (a, b) => {
    if (a.neverContacted !== b.neverContacted) return a.neverContacted ? -1 : 1;
    return (b.hoursSince || 0) - (a.hoursSince || 0);
  };
  overdue.sort(byUrgency);
  due.sort(byUrgency);

  return {
    scanned: rows.length,
    due,
    overdue,
    optedOut,
    defects,
    summary,
  };
}

module.exports = {
  DEFAULT_MAX_LEADS,
  PAGE_SIZE,
  CONCURRENCY,
  severityFor,
  activeLeadRows,
  scoreRow,
  mapWithConcurrency,
  sweep,
};
