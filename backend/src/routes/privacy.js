// ─── Compliance Item 4: GDPR / CCPA Data Privacy ─────────────────────────────
// Gives each user the legal "right to access" (export) and "right to erasure"
// (delete request) over their own data.
//
//   GET  /api/privacy/export          → full JSON export of the user's data
//   POST /api/privacy/delete-request  → logs an erasure request (does NOT delete)
//   GET  /api/privacy/requests        → the user's past privacy requests
//
// IMPORTANT: deletion is recorded as a REQUEST only. The actual row deletion is
// run manually by the operator — the app never hard-deletes user data itself.

const express  = require('express');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const audit    = require('../services/auditLog');

const router = express.Router();
router.use(requireAuth);

// Safe user columns — NEVER export password_hash, two_fa_secret, or raw billing IDs.
const SAFE_USER_COLS = [
  'id', 'email', 'full_name', 'company_name', 'phone', 'plan',
  'calls_used', 'calls_limit', 'ai_messages_used', 'ai_messages_limit',
  'subscription_status', 'subscription_plan', 'subscription_expires_at',
  'trial_ends_at', 'created_at', 'updated_at',
  'ai_caller_name', 'ai_voice_id', 'ai_personality_tone',
  'business_phone', 'email_from_name', 'email_reply_to',
  'country_code', 'region', 'city', 'timezone', 'signup_source',
  'two_fa_enabled', 'two_fa_method',
  'sms_number', 'sms_number_type', 'sms_consent_agreed', 'sms_consent_agreed_at',
  'referral_code', 'last_seen_at',
].join(', ');

function clientMeta(req) {
  return {
    ip:         req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || null,
    user_agent: req.headers['user-agent'] || null,
  };
}

// ─── GET /api/privacy/export — right to access ───────────────────────────────
router.get('/export', async (req, res, next) => {
  try {
    const uid = req.user.id;

    const [profile, leads, calls, sms, deals, auditLogs] = await Promise.all([
      supabase.from('users').select(SAFE_USER_COLS).eq('id', uid).single(),
      supabase.from('leads').select('*').eq('user_id', uid),
      supabase.from('calls').select('*').eq('user_id', uid),
      supabase.from('sms_messages').select('*').eq('user_id', uid),
      supabase.from('deals').select('*').eq('user_id', uid),
      supabase.from('audit_logs').select('action, resource, created_at, ip_address').eq('user_id', uid).order('created_at', { ascending: false }).limit(500),
    ]);

    const payload = {
      export_generated_at: new Date().toISOString(),
      account:   profile.data || null,
      leads:     leads.data   || [],
      calls:     calls.data   || [],
      sms_messages: sms.data  || [],
      deals:     deals.data   || [],
      activity_log: auditLogs.data || [],
      counts: {
        leads:        leads.data?.length  || 0,
        calls:        calls.data?.length  || 0,
        sms_messages: sms.data?.length    || 0,
        deals:        deals.data?.length  || 0,
      },
    };

    // Log the export request
    await supabase.from('data_requests').insert({
      user_id: uid,
      type:    'export',
      status:  'completed',
      metadata: { ...clientMeta(req), counts: payload.counts },
      resolved_at: new Date().toISOString(),
    }).catch(() => {});

    audit.log({ userId: uid, action: audit.ACTIONS.SETTINGS_CHANGED, req, metadata: { change: 'data_export' } });

    res.setHeader('Content-Disposition', `attachment; filename="veori-data-export-${uid}.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.json(payload);
  } catch (err) { next(err); }
});

// ─── POST /api/privacy/delete-request — right to erasure (request only) ──────
router.post('/delete-request', async (req, res, next) => {
  try {
    const uid = req.user.id;
    const { reason } = req.body;

    // Guard against duplicate open requests
    const { data: existing } = await supabase.from('data_requests')
      .select('id').eq('user_id', uid).eq('type', 'delete').eq('status', 'pending').limit(1);
    if (existing && existing.length) {
      return res.status(409).json({ success: false, error: 'You already have a pending deletion request. We will process it shortly.' });
    }

    const { data, error } = await supabase.from('data_requests').insert({
      user_id: uid,
      type:    'delete',
      status:  'pending',
      reason:  reason || null,
      metadata: clientMeta(req),
    }).select().single();
    if (error) throw error;

    audit.log({ userId: uid, action: audit.ACTIONS.SETTINGS_CHANGED, req, metadata: { change: 'data_delete_request', request_id: data.id } });

    res.status(201).json({
      success: true,
      message: 'Your data deletion request has been received. We will process it within 30 days as required by law. You will be notified once complete.',
      request: data,
    });
  } catch (err) { next(err); }
});

// ─── GET /api/privacy/requests — list the user's own privacy requests ────────
router.get('/requests', async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('data_requests')
      .select('*').eq('user_id', req.user.id).order('requested_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (err) { next(err); }
});

module.exports = router;
