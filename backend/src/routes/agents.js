/**
 * /api/agents - the read-only entry point into the 8-agent intelligence layer.
 *
 * WHAT THIS IS: the single HTTP surface that lets the operator ASK the agent layer
 * to think - run a coordinated per-deal pass, or the fleet-wide zero-missed-followup
 * sweep - and get back a STRUCTURED PLAN. It does NOT send SMS/email, place calls,
 * or write deal state. The orchestrator plans; existing (already-gated) routes own
 * side effects. Every proposed action in the plan is pre-gated compliance-first and
 * comes back marked executable:true/false so the caller/UI can act through the real
 * send path - the gate is not bypassed here.
 *
 * FLAG-FENCED: the whole agent layer is behind AGENTS_ENABLED. When the flag is off
 * (the default), every endpoint here answers 503 with a clear reason and touches
 * nothing - zero blast radius on the live platform. Mounting this route while the
 * flag is off is therefore safe; the code stays inert until you set AGENTS_ENABLED=true.
 *
 * TENANT-FENCED: requireAuth + req.user.id is the mandatory fence, mirroring every
 * other route. userId is threaded into the orchestrator/sweep, which re-guard
 * ownership on each canonical assembly - a foreign lead yields null, never another
 * tenant's data.
 *
 * NEW FILE - mounts beside /api/coo. Does not modify any existing route or service.
 */

const express = require('express');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const orchestrator = require('../agents/orchestrator');
const followupSweep = require('../agents/followupSweep');

const router = express.Router();
router.use(requireAuth);

// Single guard: if the master flag is off, no agent endpoint does anything. 503 (not
// 404) so the caller can tell "feature exists but is disabled" from "no such route".
router.use((req, res, next) => {
  if (!orchestrator.AGENTS_ENABLED) {
    return res.status(503).json({
      success: false,
      disabled: true,
      error: 'Agent layer is disabled (AGENTS_ENABLED is not true).',
    });
  }
  next();
});

/** Best-effort single-row lead fetch for gate phone/state context. Tenant-fenced. */
async function safeLead(uid, leadId) {
  try {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('user_id', uid)
      .eq('id', leadId)
      .single();
    if (error) return null;
    return data || null;
  } catch {
    return null;
  }
}

/**
 * POST /api/agents/deal/:leadId - run one coordinated per-deal pass (Acquisition →
 * Underwriting → Disposition + Follow-Up/Title status), reconcile the number, and
 * gate every proposed action compliance-first. Returns the structured plan. PLANS
 * ONLY - never sends. buyers[] (optional) drives the buyer-match ranking.
 */
router.post('/deal/:leadId', async (req, res, next) => {
  try {
    const uid = req.user.id;
    const leadId = req.params.leadId;
    if (!leadId) {
      return res.status(400).json({ success: false, error: 'leadId is required' });
    }

    // Lead row (best-effort) gives the compliance gate real phone/state context.
    const lead = await safeLead(uid, leadId);
    const buyers = Array.isArray(req.body?.buyers) ? req.body.buyers : undefined;

    const plan = await orchestrator.runDealPass({ userId: uid, leadId, lead, buyers });

    // orchestrator returns { ok:false, reason } for not-found/not-owned; surface as 404.
    if (plan && plan.ok === false && !plan.disabled) {
      return res.status(404).json({ success: false, error: plan.reason || 'deal pass failed', data: plan });
    }
    res.json({ success: true, data: plan });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/agents/sweep - the fleet-wide zero-missed-follow-up sweep across the
 * operator's ACTIVE pipeline. Read-only + tenant-fenced; enumerates active leads,
 * runs the deterministic due/overdue detector across EVERY channel's lastContactAt,
 * and returns the defect list worst-first. Sends nothing.
 *
 * Optional ?maxLeads=N caps how many active leads this call assembles (clamped to a
 * hard ceiling so one request can never fan out unbounded).
 */
router.get('/sweep', async (req, res, next) => {
  try {
    const uid = req.user.id;

    // Clamp caller-supplied maxLeads into [1, DEFAULT_MAX_LEADS]; ignore junk input.
    const HARD_CEILING = followupSweep.DEFAULT_MAX_LEADS;
    const requested = Number(req.query.maxLeads);
    const maxLeads = Number.isFinite(requested)
      ? Math.max(1, Math.min(requested, HARD_CEILING))
      : HARD_CEILING;

    const result = await followupSweep.sweep(uid, { maxLeads });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
