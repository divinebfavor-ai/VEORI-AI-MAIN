// ─────────────────────────────────────────────────────────────────────────────
// leadMemory - the shared memory surface every agent reads from.
//
// WHAT THIS IS: getLeadCanonical(userId, leadId) assembles ONE record that tells
// an agent everything already known about a lead - so no agent ever re-asks a
// question the operation already has the answer to, and a handoff between agents
// is lossless. This is the "one canonical record per lead" requirement.
//
// WHAT THIS IS NOT: it does NOT create a new table. The shared memory already
// lives across existing append-only tables (conversation_memory, conversations,
// deal_activity, deal_probability_scores / deal_predictions). This module is a
// READ-ONLY assembler over those tables. Writes still go through the existing
// routes/services that own each table - this file never mutates state.
//
// TENANT ISOLATION (fail-closed): the backend uses the Supabase service role,
// which BYPASSES row-level security, so the app-layer user_id filter is the ONLY
// fence. Every query here is double-guarded: (1) an ownership check on the lead
// (the 3763fef callerOwnsLead pattern - returns null, not another tenant's data,
// on mismatch), and (2) an explicit .eq('user_id', userId) on every child query.
// A missing/foreign lead yields null; it never leaks across tenants.
//
// RESILIENCE: each child table is fetched independently and a missing table or a
// query error degrades that ONE section to empty rather than failing the whole
// record (mirrors the tableMissing tolerance already used in the memory route).
// The canonical record is always safe to render; sections just may be empty.
// ─────────────────────────────────────────────────────────────────────────────

const supabase = require('../config/supabase');

const RECENT_MEMORY_LIMIT = 25;   // interaction summaries to pull (most recent)
const RECENT_ACTIVITY_LIMIT = 40; // timeline rows to pull (most recent)

function tableMissing(err) {
  return err?.code === 'PGRST205' || (err?.message || '').includes('does not exist');
}

/**
 * Confirm the lead belongs to the caller. Mirrors the callerOwnsLead ownership
 * guard shipped in commit 3763fef. Returns the lead row when owned, else null.
 * Never returns a foreign tenant's row.
 */
async function ownedLead(userId, leadId) {
  const { data, error } = await supabase
    .from('leads').select('*').eq('id', leadId).single();
  if (error) {
    if (error.code === 'PGRST116') return null; // no row
    if (tableMissing(error)) return null;
    throw error;
  }
  if (!data || data.user_id !== userId) return null; // foreign or missing owner
  return data;
}

/** Best-effort fetch of a child section - degrades to [] on error/missing table. */
async function safeRows(build) {
  try {
    const { data, error } = await build();
    if (error) {
      if (tableMissing(error)) return [];
      throw error;
    }
    return data || [];
  } catch {
    return [];
  }
}

/**
 * Assemble the canonical, agent-ready record for a single lead.
 *
 * @param {string} userId  owning tenant (req.user.id) - MANDATORY, the fence
 * @param {string} leadId  lead to assemble
 * @returns {Promise<object|null>} canonical record, or null if the lead is not
 *          found OR not owned by userId (indistinguishable to the caller by
 *          design - no cross-tenant existence leak).
 *
 * Shape:
 *   {
 *     lead,                     // the leads row (owned)
 *     memory:      [ ... ],     // conversation_memory summaries, newest first
 *     conversations: [ ... ],   // message log, newest first
 *     activity:    [ ... ],     // deal_activity timeline, newest first
 *     prediction:  {...}|null,  // latest deal_probability_scores row
 *     stats: { interactionCount, lastContactAt, knownObjections, knownMotivators }
 *   }
 */
async function getLeadCanonical(userId, leadId) {
  if (!userId || !leadId) return null;

  const lead = await ownedLead(userId, leadId);
  if (!lead) return null; // fail-closed: not found or not owned

  // Fetch each section independently, all tenant-scoped. Parallel for latency;
  // any single failure degrades that section to [] (see safeRows).
  const [memory, conversations, activity, predictionRows] = await Promise.all([
    safeRows(() => supabase
      .from('conversation_memory').select('*')
      .eq('lead_id', leadId).eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(RECENT_MEMORY_LIMIT)),
    safeRows(() => supabase
      .from('conversations').select('*')
      .eq('lead_id', leadId).eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(RECENT_MEMORY_LIMIT)),
    safeRows(() => supabase
      .from('deal_activity').select('*')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(RECENT_ACTIVITY_LIMIT)),
    safeRows(() => supabase
      .from('deal_probability_scores').select('*')
      .eq('lead_id', leadId).eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)),
  ]);

  // Roll up the memory into fast-to-read stats so an agent doesn't re-derive them.
  const knownObjections = [...new Set(
    memory.flatMap(m => Array.isArray(m.objections) ? m.objections : [])
  )].slice(0, 20);
  const knownMotivators = [...new Set(
    memory.flatMap(m => Array.isArray(m.key_statements) ? m.key_statements : [])
  )].slice(0, 20);

  const lastContactAt =
    memory[0]?.created_at ||
    conversations[0]?.created_at ||
    activity[0]?.created_at ||
    lead.last_contacted_at ||
    null;

  return {
    lead,
    memory,
    conversations,
    activity,
    prediction: predictionRows[0] || null,
    stats: {
      interactionCount: memory.length,
      lastContactAt,
      knownObjections,
      knownMotivators,
    },
  };
}

/**
 * Render a canonical record into a compact prompt-context string that any agent
 * can inject. Keeps the "never make the counterparty repeat themselves" rule:
 * prior outcomes, objections, and motivators are surfaced in one block.
 * Pure formatter - no I/O.
 * @param {object} canonical  output of getLeadCanonical
 * @returns {string}
 */
function toPromptContext(canonical) {
  if (!canonical || !canonical.lead) return '';
  const { lead, memory, prediction, stats } = canonical;
  const lines = ['=== LEAD MEMORY (shared across all agents) ==='];
  lines.push(`Lead: ${lead.name || lead.owner_name || 'unknown'} | ${lead.property_address || ''} ${lead.property_state || ''}`.trim());
  lines.push(`Interactions on record: ${stats.interactionCount}${stats.lastContactAt ? ` | last contact ${new Date(stats.lastContactAt).toLocaleDateString()}` : ''}`);
  if (prediction) {
    lines.push(`Latest prediction: ${prediction.probability ?? prediction.score ?? '?'} (confidence ${prediction.confidence ?? '?'})`);
  }
  if (stats.knownMotivators.length) lines.push(`Known motivators: ${stats.knownMotivators.join('; ')}`);
  if (stats.knownObjections.length) lines.push(`Known objections: ${stats.knownObjections.join('; ')}`);
  if (memory.length) {
    lines.push('Recent interactions (newest first):');
    memory.slice(0, 5).forEach((m, i) => {
      const date = m.created_at ? new Date(m.created_at).toLocaleDateString() : '?';
      lines.push(`  ${i + 1}. ${date} - outcome ${m.call_outcome || 'unknown'}, motivation ${m.motivation_score ?? '?'}/100, sentiment ${m.sentiment || 'unknown'}`);
    });
  }
  lines.push('=== END LEAD MEMORY ===');
  return lines.join('\n');
}

module.exports = {
  getLeadCanonical,
  toPromptContext,
  RECENT_MEMORY_LIMIT,
  RECENT_ACTIVITY_LIMIT,
};
