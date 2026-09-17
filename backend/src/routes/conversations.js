const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const { scheduleVapiCall } = require('../services/queueService');
const { sendReply } = require('../services/smsService');

const router = express.Router();
router.use(requireAuth);

// SECURITY: this router used to look contacts up by id alone and send through the
// retired Vapi SMS API, and /schedule-call queued a dial for ANY lead id - the worker
// then called that lead from its owner's account. Every handler now proves the lead
// (and deal, when given) belongs to the caller's workspace, and sends through the
// same compliant paths as the rest of the app (DNC, credits, quiet hours at dial time).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MESSAGE = 1600;
const MAX_SCHEDULE_DAYS = 90;

async function ownedLead(userId, leadId) {
  if (!UUID_RE.test(String(leadId || ''))) return null;
  const { data, error } = await supabase.from('leads').select('id, phone, first_name')
    .eq('id', leadId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

async function ownedDeal(userId, dealId) {
  if (!UUID_RE.test(String(dealId || ''))) return null;
  const { data, error } = await supabase.from('deals').select('id, lead_id')
    .eq('id', dealId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

// POST /api/conversations/send-sms - text a seller lead in this workspace
router.post('/send-sms', async (req, res, next) => {
  try {
    const { contact_id, contact_type = 'seller', message } = req.body || {};
    if (contact_type !== 'seller') {
      return res.status(400).json({ success: false, error: 'Only seller leads can be texted here. Use a buyer blast for buyers.' });
    }
    const text = typeof message === 'string' ? message.trim() : '';
    if (!text) return res.status(400).json({ success: false, error: 'message is required' });
    if (text.length > MAX_MESSAGE) return res.status(400).json({ success: false, error: `message must be ${MAX_MESSAGE} characters or fewer` });

    const lead = await ownedLead(req.user.id, contact_id);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    if (!lead.phone) return res.status(400).json({ success: false, error: 'This lead has no phone number' });

    const messageId = await sendReply(lead.phone, text, req.user.id, lead.id);
    if (!messageId) {
      return res.status(409).json({ success: false, error: 'The text was not sent (the number may be on your do-not-contact list, or you are out of outreach credits).' });
    }
    res.json({ success: true, message_id: messageId });
  } catch (err) { next(err); }
});

// POST /api/conversations/handle-reply - retired. Seller replies arrive from the
// carrier webhook (/api/sms/webhook); letting a client post a "reply" allowed
// forged inbound messages to drive AI extraction and scheduled dials.
router.post('/handle-reply', (_req, res) => {
  res.status(410).json({ success: false, error: 'Replies are recorded automatically when the seller texts back.' });
});

// POST /api/conversations/schedule-call - AI callback to a lead at a set time
router.post('/schedule-call', async (req, res, next) => {
  try {
    const { contact_id, deal_id, run_at, reason } = req.body || {};
    const when = new Date(run_at);
    if (!run_at || Number.isNaN(when.getTime())) return res.status(400).json({ success: false, error: 'run_at must be a date and time' });
    if (when.getTime() <= Date.now()) return res.status(400).json({ success: false, error: 'run_at must be in the future' });
    if (when.getTime() > Date.now() + MAX_SCHEDULE_DAYS * 86400000) {
      return res.status(400).json({ success: false, error: `run_at must be within ${MAX_SCHEDULE_DAYS} days` });
    }

    const lead = await ownedLead(req.user.id, contact_id);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    let deal = null;
    if (deal_id != null && deal_id !== '') {
      deal = await ownedDeal(req.user.id, deal_id);
      if (!deal) return res.status(404).json({ success: false, error: 'Deal not found' });
    }

    const followUpId = uuidv4();
    const runAtIso = when.toISOString();
    const { error } = await supabase.from('follow_ups').insert({
      id:                followUpId,
      user_id:           req.user.id,
      lead_id:           lead.id,
      deal_id:           deal?.id || null,
      contact_id:        lead.id,
      contact_type:      'seller',
      follow_up_type:    'call',
      next_follow_up_at: runAtIso,
      reason:            typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 500) : 'Operator scheduled an AI callback.',
      status:            'scheduled',
    });
    if (error) throw error;

    // Do-not-call and calling hours are checked again when the call is placed.
    const jobId = await scheduleVapiCall({ followUpId, dealId: deal?.id || null, leadId: lead.id, runAt: runAtIso, script: null });
    if (jobId) await supabase.from('follow_ups').update({ bullmq_job_id: String(jobId) }).eq('id', followUpId).eq('user_id', req.user.id);

    res.json({ success: true, followup_id: followUpId, scheduled_at: runAtIso });
  } catch (err) { next(err); }
});

// GET /api/conversations/:deal_id - messages for a deal in this workspace
router.get('/:deal_id', async (req, res, next) => {
  try {
    const deal = await ownedDeal(req.user.id, req.params.deal_id);
    if (!deal) return res.status(404).json({ success: false, error: 'Deal not found' });

    const { data, error } = await supabase.from('conversations')
      .select('*')
      .eq('deal_id', deal.id)
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json({ success: true, messages: data || [] });
  } catch (err) { next(err); }
});

module.exports = router;
