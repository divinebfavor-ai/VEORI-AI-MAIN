/**
 * Custom SMS Template Routes — operator-authored, guard-railed wholesale-RE copy.
 *
 *   GET    /api/sms-templates            — list this operator's saved templates
 *   POST   /api/sms-templates            — save a new template (moderated before store)
 *   PUT    /api/sms-templates/:id        — edit a template (re-moderated before store)
 *   DELETE /api/sms-templates/:id        — soft-delete (is_active = false)
 *   POST   /api/sms-templates/generate   — AI drafts a compliant template (no save)
 *   POST   /api/sms-templates/moderate   — check arbitrary text against the guardrail
 *
 * The guardrail (customSmsService.moderateTemplate) runs on every save/edit/generate
 * so only wholesale-real-estate copy can ever be stored. Every query is scoped to
 * req.user.id — an operator only ever sees/edits their OWN templates. Sending is NOT
 * done here; saved templates are consumed by the blast (smsFirstWorkflow) at send time,
 * where DNC / outreach-credit / TCPA gates still apply unchanged.
 */

const router   = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const supabase = require('../config/supabase');
const customSms = require('../services/customSmsService');

// GET /api/sms-templates — list active templates for this operator.
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('sms_templates')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (err) { next(err); }
});

// POST /api/sms-templates — save a new template (guardrail enforced).
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { name, body, lead_type, ai_generated } = req.body || {};
    if (!name || !body) {
      return res.status(400).json({ success: false, error: 'name and body are required' });
    }

    // Guardrail: only wholesale-RE copy can be stored. Reject off-topic/fraud.
    const verdict = await customSms.moderateTemplate(body);
    if (!verdict.allowed) {
      return res.status(422).json({ success: false, error: verdict.reason, moderation: 'rejected' });
    }

    const { data, error } = await supabase
      .from('sms_templates')
      .insert({
        user_id:           req.user.id,
        name:              String(name).slice(0, 120),
        body:              String(body).slice(0, 1600),
        lead_type:         lead_type || null,
        ai_generated:      !!ai_generated,
        moderation_status: 'approved',
        moderation_reason: verdict.reason || null,
      })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
});

// PUT /api/sms-templates/:id — edit a template (re-moderated on body change).
router.put('/:id', requireAuth, async (req, res, next) => {
  try {
    const { name, body, lead_type, is_active } = req.body || {};
    const patch = { updated_at: new Date().toISOString() };

    if (name      !== undefined) patch.name      = String(name).slice(0, 120);
    if (lead_type !== undefined) patch.lead_type = lead_type || null;
    if (is_active !== undefined) patch.is_active = !!is_active;

    if (body !== undefined) {
      const verdict = await customSms.moderateTemplate(body);
      if (!verdict.allowed) {
        return res.status(422).json({ success: false, error: verdict.reason, moderation: 'rejected' });
      }
      patch.body              = String(body).slice(0, 1600);
      patch.moderation_reason = verdict.reason || null;
    }

    const { data, error } = await supabase
      .from('sms_templates')
      .update(patch)
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)   // scope: only your own template
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'Template not found' });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// DELETE /api/sms-templates/:id — soft-delete (keep row for any campaign that referenced it).
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const { error } = await supabase
      .from('sms_templates')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST /api/sms-templates/generate — AI drafts a compliant template. Does NOT save.
// Body: { lead_type, angle }. Returns the draft + the guardrail verdict so the UI can
// show the operator a clean, editable suggestion before they choose to save it.
router.post('/generate', requireAuth, async (req, res, next) => {
  try {
    const { lead_type, angle } = req.body || {};

    // Use the operator's AI caller name so the draft signs off correctly.
    const { data: operator } = await supabase
      .from('users').select('ai_caller_name, full_name').eq('id', req.user.id).single();
    const operatorName = operator?.ai_caller_name || operator?.full_name || 'Alex';

    const result = await customSms.generateTemplate({
      leadType:     lead_type,
      angle:        angle,
      operatorName,
    });

    if (!result.body) {
      return res.status(502).json({ success: false, error: result.reason });
    }
    res.json({ success: true, data: { body: result.body, allowed: result.allowed, reason: result.reason } });
  } catch (err) { next(err); }
});

// POST /api/sms-templates/moderate — run arbitrary text through the guardrail.
// Lets the UI live-validate what an operator is typing before they hit save.
router.post('/moderate', requireAuth, async (req, res, next) => {
  try {
    const { body } = req.body || {};
    if (!body) return res.status(400).json({ success: false, error: 'body is required' });
    const verdict = await customSms.moderateTemplate(body);
    res.json({ success: true, data: verdict });
  } catch (err) { next(err); }
});

module.exports = router;
