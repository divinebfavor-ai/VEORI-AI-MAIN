/**
 * Audit Logging Service
 * Tracks every important action across Veori for security + compliance
 */

const supabase = require('../config/supabase');

const ACTIONS = {
  // Auth
  LOGIN:             'auth.login',
  LOGIN_FAILED:      'auth.login_failed',
  LOGOUT:            'auth.logout',
  REGISTER:          'auth.register',
  PASSWORD_RESET:    'auth.password_reset',
  TWO_FA_ENABLED:    'auth.2fa_enabled',
  TWO_FA_DISABLED:   'auth.2fa_disabled',
  TWO_FA_FAILED:     'auth.2fa_failed',

  // Billing
  SUBSCRIBE:         'billing.subscribe',
  CANCEL:            'billing.cancel',
  PAYMENT_SUCCESS:   'billing.payment_success',
  PAYMENT_FAILED:    'billing.payment_failed',

  // Calls
  CALL_INITIATED:    'calls.initiated',
  CALL_ENDED:        'calls.ended',

  // Leads
  LEAD_CREATED:      'leads.created',
  LEAD_DELETED:      'leads.deleted',
  LEAD_IMPORTED:     'leads.imported',

  // Admin
  ADMIN_ACCESS:      'admin.access',
  ADMIN_USER_VIEW:   'admin.user_viewed',

  // Settings
  SETTINGS_CHANGED:  'settings.changed',
  API_KEY_VIEWED:    'settings.api_key_viewed',

  // Security
  SUSPICIOUS:        'security.suspicious',
  RATE_LIMITED:      'security.rate_limited',
};

async function log({ userId = null, action, resource = null, metadata = {}, req = null }) {
  try {
    const entry = {
      user_id:    userId,
      action,
      resource,
      metadata,
      ip_address: req ? (req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || null) : null,
      user_agent: req ? (req.headers['user-agent'] || null) : null,
      created_at: new Date().toISOString(),
    };

    await supabase.from('audit_logs').insert(entry);
  } catch (err) {
    // Never crash the app due to audit log failure
    console.warn('[Audit] Failed to log:', action, err.message);
  }
}

module.exports = { log, ACTIONS };
