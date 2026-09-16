// ─── AI command log writer ───────────────────────────────────────────────────
// One writer for ai_command_log. The table's columns are:
//   log_id, user_id, deal_id, lead_id, action_type (NOT NULL), model, summary,
//   input_tokens, output_tokens, status, error_message, created_at
// Every previous caller wrote message_sent / outcome / operator_id / contact_id /
// contact_name, none of which exist, so every insert failed and the table held
// zero rows. Callers now go through here. A failed write is logged, never thrown:
// the action it describes already happened and must not be undone by logging.

const supabase = require('../config/supabase');

const SUMMARY_MAX = 1000;

/**
 * @param {object} p
 * @param {string} p.actionType          short machine verb, e.g. 'buyer_blast_auto'
 * @param {string} [p.userId]            operator the action belongs to
 * @param {string} [p.dealId]
 * @param {string} [p.leadId]            only a real leads.id (FK)
 * @param {string} [p.summary]           human-readable description
 * @param {string} [p.status='success']  e.g. success | failed | skipped | queued | sent
 * @param {string} [p.errorMessage]
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function logAiCommand({ actionType, userId = null, dealId = null, leadId = null, summary = null, status = 'success', errorMessage = null }) {
  if (!supabase || !actionType) return { ok: false, error: 'missing actionType' };
  try {
    const { error } = await supabase.from('ai_command_log').insert({
      user_id: userId || null,
      deal_id: dealId || null,
      lead_id: leadId || null,
      action_type: actionType,
      summary: summary != null ? String(summary).slice(0, SUMMARY_MAX) : null,
      status,
      error_message: errorMessage != null ? String(errorMessage).slice(0, SUMMARY_MAX) : null,
    });
    if (error) {
      console.error(`[AiCommandLog] write failed (${actionType}):`, error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e) {
    console.error(`[AiCommandLog] write failed (${actionType}):`, e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { logAiCommand };
