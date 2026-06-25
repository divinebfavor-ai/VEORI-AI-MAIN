// ─────────────────────────────────────────────────────────────────────────────
// emailReplyStop — Tier 2c: stop a lead's cold-email drip the moment they reply.
//
// WHY: The loudest 2026 cold-email complaint is "the tool kept hammering a guy
// who already replied." It's the fastest way to a spam complaint (and looks
// amateur to an experienced seller). The instant a lead emails back, their
// automated drip must stop — a human is now in the loop. Reply > the sequence.
//
// HOW: Resend has no "replied" event (replies hit the real mailbox, not the API),
// so reply signal comes IN via an inbound-parse forward to POST /api/email/inbound.
// This service does the actual stop: find the lead by the inbound from-address for
// that operator, flip their ACTIVE email sequences to 'cancelled'. Same status the
// engine already uses (enrollLeadInSequence cancels prior actives), so the cron
// processReadySequences (status='active' only) simply stops picking them up — no
// new state machine, no change to the send path.
//
// SAFETY / ZERO-REGRESSION:
//   • Only ever flips status active → cancelled on the sequences table. Never
//     deletes, never touches leads/email_log/the send path. A no-match is a no-op.
//   • Fail-open: any Supabase/parse error is swallowed and returns a soft result,
//     so an inbound webhook can never crash or retry-storm.
//   • Scopes to email sequence_types only (email_drip + the named drips that send
//     email) so an inbound email never cancels an SMS/RVM/call sequence.
// ─────────────────────────────────────────────────────────────────────────────

const supabase = require('../config/supabase');

// Sequence types that send cold email and should halt when the lead replies by
// email. Intentionally explicit (not "all sequences") so an email reply never
// silently kills an unrelated SMS or voicemail cadence.
const EMAIL_SEQUENCE_TYPES = ['email_drip', 'not_interested', 'offer_considering'];

// Normalize an inbound from-header to a bare lowercase address.
//   "Jane Doe <jane@x.com>"  →  "jane@x.com"
//   " JANE@X.com "           →  "jane@x.com"
function normalizeEmail(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const angled = s.match(/<([^>]+)>/);
  const addr = (angled ? angled[1] : s).trim().toLowerCase();
  return addr.includes('@') ? addr : null;
}

// Find the lead this reply belongs to. We match on email; if userId is known we
// scope to that operator's leads first (a buyer/seller email can exist under
// multiple operators). Returns the single best lead row or null.
async function findLeadByEmail(email, userId = null) {
  if (!supabase || !email) return null;
  try {
    let q = supabase.from('leads').select('id, user_id, email').ilike('email', email).limit(1);
    if (userId) q = q.eq('user_id', userId);
    const { data, error } = await q.maybeSingle();
    if (error || !data) {
      // Fallback: no operator scope (forwarder didn't tell us the user).
      if (userId) return findLeadByEmail(email, null);
      return null;
    }
    return data;
  } catch (_e) {
    return null;
  }
}

// Cancel every ACTIVE email sequence for a lead. Returns the count stopped.
async function cancelActiveEmailSequences(leadId) {
  if (!supabase || !leadId) return 0;
  try {
    const { data, error } = await supabase
      .from('sequences')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('lead_id', leadId)
      .eq('status', 'active')
      .in('sequence_type', EMAIL_SEQUENCE_TYPES)
      .select('id');
    if (error) return 0;
    return (data || []).length;
  } catch (_e) {
    return 0;
  }
}

// Top-level entry the inbound route calls. Resolves the lead from the reply's
// from-address, stops their drip, and returns a small result. Never throws.
//   @param {string} fromRaw  the inbound "From" header / sender address
//   @param {string} [userId] operator id, if the forwarder supplied it
async function handleInboundReply({ fromRaw, userId = null } = {}) {
  const email = normalizeEmail(fromRaw);
  if (!email) return { stopped: 0, matched: false, reason: 'no_email' };

  const lead = await findLeadByEmail(email, userId);
  if (!lead) return { stopped: 0, matched: false, reason: 'no_lead' };

  const stopped = await cancelActiveEmailSequences(lead.id);
  if (stopped > 0) {
    console.log(`[emailReplyStop] ${email} replied → cancelled ${stopped} email sequence(s) for lead ${lead.id}`);
  }
  return { stopped, matched: true, leadId: lead.id };
}

module.exports = {
  handleInboundReply,
  cancelActiveEmailSequences,
  findLeadByEmail,
  normalizeEmail,
  EMAIL_SEQUENCE_TYPES,
};
