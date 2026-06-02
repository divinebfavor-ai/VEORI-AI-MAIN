const express    = require('express');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const crypto     = require('crypto');
const speakeasy  = require('speakeasy');
const QRCode     = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const supabase   = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const { sendEmail }   = require('../services/emailService');
const audit      = require('../services/auditLog');
const axios      = require('axios');

const router     = express.Router();
const JWT_SECRET = process.env.JWT_SECRET; // crashes at middleware/auth.js if missing
const APP_URL    = process.env.FRONTEND_URL || 'https://veori.net';
const APP_NAME   = 'Veori';

const geoip = require('geoip-lite');

// ─── Telnyx for 2FA SMS ───────────────────────────────────────────────────────
const TELNYX_KEY     = process.env.TELNYX_API_KEY;
const SMS_FROM       = process.env.TELNYX_SMS_NUMBER || '+19197945843';
const TELNYX_PROFILE = process.env.TELNYX_MESSAGING_PROFILE_ID;

function getGeoFromRequest(req) {
  try {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded ? forwarded.split(',')[0].trim() : req.socket?.remoteAddress || '';
    const cleanIp = ip.replace('::ffff:', '');
    const geo = geoip.lookup(cleanIp);
    if (!geo) return {};
    return {
      country_code: geo.country  || null,
      region:       geo.region   || null,
      city:         geo.city     || null,
      timezone:     geo.timezone || null,
    };
  } catch { return {}; }
}

function validatePasswordStrength(password) {
  if (!password || password.length < 12) return 'Password must be at least 12 characters';
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one number';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain at least one special character';
  return null;
}

// ─── OTP helpers ─────────────────────────────────────────────────────────────

function generateOTP() {
  // Cryptographically random 6-digit code
  return String(crypto.randomInt(100000, 999999));
}

function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

async function storeOTP(userId, code) {
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min
  // Invalidate any previous unused codes for this user
  await supabase.from('otp_codes')
    .update({ used: true })
    .eq('user_id', userId)
    .eq('purpose', '2fa')
    .eq('used', false);
  await supabase.from('otp_codes').insert({
    user_id:    userId,
    code_hash:  codeHash,
    purpose:    '2fa',
    expires_at: expiresAt,
  });
}

async function verifyOTP(userId, code) {
  const codeHash = hashCode(code);
  const { data } = await supabase.from('otp_codes')
    .select('id, expires_at, used')
    .eq('user_id', userId)
    .eq('code_hash', codeHash)
    .eq('purpose', '2fa')
    .eq('used', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!data) return false;
  if (new Date(data.expires_at) < new Date()) return false;

  await supabase.from('otp_codes').update({ used: true }).eq('id', data.id);
  return true;
}

async function sendSMSOTP(phone, code) {
  if (!TELNYX_KEY) throw new Error('SMS not configured');
  await axios.post('https://api.telnyx.com/v2/messages', {
    from: SMS_FROM,
    to:   phone,
    text: `Your Veori verification code is: ${code}\n\nExpires in 10 minutes. Do not share this code.`,
    messaging_profile_id: TELNYX_PROFILE,
  }, {
    headers: {
      Authorization:  `Bearer ${TELNYX_KEY}`,
      'Content-Type': 'application/json',
    },
    timeout: 10000,
  });
}

async function sendEmailOTP(email, name, code) {
  await sendEmail({
    to:      email,
    subject: `${code} — Your Veori verification code`,
    html: `
      <div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;background:#060E1A;color:#fff;border-radius:16px;overflow:hidden;padding:40px;">
        <div style="font-size:28px;font-weight:900;letter-spacing:-0.04em;margin-bottom:24px;">VEORI</div>
        <p style="font-size:15px;color:rgba(255,255,255,0.7);margin:0 0 24px;">Hey ${name?.split(' ')[0] || 'there'}, here is your login verification code:</p>
        <div style="background:rgba(0,195,122,0.10);border:1px solid rgba(0,195,122,0.30);border-radius:12px;padding:28px;text-align:center;margin-bottom:24px;">
          <div style="font-size:42px;font-weight:900;letter-spacing:0.25em;color:#00C37A;">${code}</div>
          <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:10px;">Expires in 10 minutes</div>
        </div>
        <p style="font-size:12px;color:rgba(255,255,255,0.3);margin:0;">If you did not attempt to log in, secure your account immediately at veori.net</p>
      </div>
    `,
  });
}

// ─── Temp token for 2FA pending login ────────────────────────────────────────
function issueTempToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, type: '2fa_pending' },
    JWT_SECRET,
    { expiresIn: '5m' }
  );
}

function verifyTempToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type !== '2fa_pending') return null;
    return decoded;
  } catch { return null; }
}

// ─── Register ─────────────────────────────────────────────────────────────────
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, full_name, company_name, phone } = req.body;
    if (!email || !password || !full_name) {
      return res.status(400).json({ success: false, error: 'email, password and full_name required' });
    }

    const pwError = validatePasswordStrength(password);
    if (pwError) return res.status(400).json({ success: false, error: pwError });

    const hash   = await bcrypt.hash(password, 12);
    const geo    = getGeoFromRequest(req);
    const source = req.body.source || req.headers['x-signup-source'] || null;

    const { data, error } = await supabase
      .from('users')
      .insert([{
        id: uuidv4(),
        email: email.toLowerCase(),
        password_hash: hash,
        full_name, company_name, phone,
        plan: 'hustle',
        ...geo,
        signup_source: source,
        last_seen_at:  new Date().toISOString(),
      }])
      .select('id, email, full_name, company_name, plan, calls_limit, calls_used')
      .single();

    if (error) {
      if (error.code === '23505') return res.status(409).json({ success: false, error: 'Email already registered' });
      throw error;
    }

    const token = jwt.sign({ id: data.id, email: data.email }, JWT_SECRET, { expiresIn: '7d' });

    audit.log({ userId: data.id, action: audit.ACTIONS.REGISTER, req,
      metadata: { email: data.email, source } });

    sendEmail({
      to: data.email,
      subject: 'Welcome to Veori - Your AI is Ready',
      html: `
        <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;background:#060E1A;color:#fff;border-radius:16px;overflow:hidden;">
          <div style="background:linear-gradient(135deg,#060E1A,#0A1526);padding:40px 40px 32px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.08);">
            <div style="font-size:32px;font-weight:900;letter-spacing:-0.04em;color:#fff;margin-bottom:6px;">VEORI</div>
            <div style="font-size:13px;color:#00C37A;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">AI Operating System for Real Estate</div>
          </div>
          <div style="padding:40px;">
            <h1 style="font-size:24px;font-weight:800;margin:0 0 16px;color:#fff;">Welcome, ${data.full_name?.split(' ')[0] || 'there'}.</h1>
            <p style="font-size:15px;color:rgba(255,255,255,0.65);line-height:1.7;margin:0 0 24px;">Your Veori account is live. You now have access to the full AI-powered real estate platform — including AI dialing, lead management, deal tracking, contract signing, and more.</p>
            <div style="background:rgba(0,195,122,0.08);border:1px solid rgba(0,195,122,0.20);border-radius:12px;padding:24px;margin-bottom:28px;">
              <div style="font-size:13px;font-weight:700;color:#00C37A;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:16px;">Get started in 3 steps</div>
              <div style="display:flex;flex-direction:column;gap:12px;">
                <div style="font-size:14px;color:rgba(255,255,255,0.80);">1. Add your first leads or run an AI zip code scan</div>
                <div style="font-size:14px;color:rgba(255,255,255,0.80);">2. Create a campaign and let Veori start calling</div>
                <div style="font-size:14px;color:rgba(255,255,255,0.80);">3. Watch your pipeline fill up on the dashboard</div>
              </div>
            </div>
            <a href="https://veori.net/dashboard" style="display:block;text-align:center;background:#00C37A;color:#060E1A;font-size:15px;font-weight:800;padding:16px;border-radius:10px;text-decoration:none;">Open Your Dashboard</a>
            <p style="font-size:12px;color:rgba(255,255,255,0.30);text-align:center;margin-top:24px;">Questions? Reply to this email or contact us at support@veori.ai</p>
          </div>
        </div>
      `,
    }).catch(e => console.warn('[Auth] Welcome email failed:', e.message));

    res.status(201).json({ success: true, token, user: data });
  } catch (err) { next(err); }
});

// ─── Login ────────────────────────────────────────────────────────────────────
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, error: 'email and password required' });

    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, full_name, company_name, phone, plan, calls_used, calls_limit, ai_messages_used, ai_messages_limit, subscription_status, subscription_plan, subscription_expires_at, monthly_dial_limit, trial_ends_at, email_from_name, email_reply_to, two_fa_enabled, two_fa_method, two_fa_secret, two_fa_phone, password_hash, created_at, referral_code, referred_by, payout_email, payout_method, sms_consent_agreed, sms_consent_agreed_at')
      .eq('email', email.toLowerCase())
      .single();

    if (error || !user) {
      audit.log({ action: audit.ACTIONS.LOGIN_FAILED, req, metadata: { email } });
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      audit.log({ userId: user.id, action: audit.ACTIONS.LOGIN_FAILED, req, metadata: { email } });
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    // ── 2FA gate ──────────────────────────────────────────────────────────────
    if (user.two_fa_enabled) {
      const tempToken = issueTempToken(user);

      // Auto-send OTP for SMS and email methods
      if (user.two_fa_method === 'sms' || user.two_fa_method === 'email') {
        const code = generateOTP();
        await storeOTP(user.id, code);
        try {
          if (user.two_fa_method === 'sms') {
            await sendSMSOTP(user.two_fa_phone || user.phone, code);
          } else {
            await sendEmailOTP(user.email, user.full_name, code);
          }
        } catch (e) {
          console.warn('[2FA] OTP send failed:', e.message);
          // Still return pending — user can re-request
        }
      }

      return res.json({
        success:       true,
        requires_2fa:  true,
        two_fa_method: user.two_fa_method,
        temp_token:    tempToken,
      });
    }

    // ── Normal login ──────────────────────────────────────────────────────────
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    const { password_hash, two_fa_secret, ...safeUser } = user;

    audit.log({ userId: user.id, action: audit.ACTIONS.LOGIN, req, metadata: { email } });

    res.json({ success: true, token, user: safeUser });
  } catch (err) { next(err); }
});

// ─── Me ───────────────────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, email, full_name, company_name, phone, plan, calls_used, calls_limit, ai_messages_used, ai_messages_limit, subscription_status, trial_ends_at, email_from_name, email_reply_to, two_fa_enabled, two_fa_method, created_at')
      .eq('id', req.user.id)
      .single();
    if (error) throw error;
    res.json({ success: true, user: data });
  } catch (err) { next(err); }
});

// ─── Change Password ─────────────────────────────────────────────────────────
router.put('/password', requireAuth, async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ success: false, error: 'current_password and new_password required' });
    }

    const pwError = validatePasswordStrength(new_password);
    if (pwError) return res.status(400).json({ success: false, error: pwError });

    const { data: user, error: fetchError } = await supabase
      .from('users')
      .select('id, password_hash')
      .eq('id', req.user.id)
      .single();

    if (fetchError || !user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, error: 'Current password is incorrect' });
    }

    const password_hash = await bcrypt.hash(new_password, 12);
    const { error: updateError } = await supabase
      .from('users')
      .update({ password_hash, updated_at: new Date().toISOString() })
      .eq('id', req.user.id);

    if (updateError) throw updateError;

    audit.log({ userId: req.user.id, action: audit.ACTIONS.SETTINGS_CHANGED, req,
      metadata: { change: 'password' } });

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) { next(err); }
});

// ─── Forgot Password ─────────────────────────────────────────────────────────
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, error: 'Email is required' });

    const { data: user } = await supabase.from('users')
      .select('id, email, full_name').eq('email', email.toLowerCase().trim()).single();

    if (!user) return res.json({ success: true, message: 'If that email exists, a reset link was sent.' });

    const rawToken  = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await supabase.from('password_reset_tokens').upsert({
      user_id:    user.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
      used:       false,
    }, { onConflict: 'user_id' });

    const resetLink = `${APP_URL}/reset-password?token=${rawToken}`;
    const name = user.full_name?.split(' ')[0] || 'there';

    await sendEmail({
      to:        user.email,
      subject:   'Reset your VEORI password',
      body:      `Hey ${name},\n\nSomeone requested a password reset for your VEORI account. If that was you, click the link below. It expires in 1 hour.\n\n${resetLink}\n\nIf you did not request this, you can ignore this email. Your password has not been changed.\n\nVEORI AI`,
      emailType: 'password_reset',
    });

    audit.log({ userId: user.id, action: audit.ACTIONS.PASSWORD_RESET, req,
      metadata: { email, stage: 'requested' } });

    res.json({ success: true, message: 'If that email exists, a reset link was sent.' });
  } catch (err) { next(err); }
});

// ─── Reset Password ───────────────────────────────────────────────────────────
router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, new_password } = req.body;
    if (!token || !new_password) return res.status(400).json({ success: false, error: 'token and new_password required' });

    const pwError = validatePasswordStrength(new_password);
    if (pwError) return res.status(400).json({ success: false, error: pwError });

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const { data: record } = await supabase.from('password_reset_tokens')
      .select('user_id, expires_at, used')
      .eq('token_hash', tokenHash).single();

    if (!record)                                     return res.status(400).json({ success: false, error: 'Invalid or expired reset link' });
    if (record.used)                                 return res.status(400).json({ success: false, error: 'This reset link has already been used' });
    if (new Date(record.expires_at) < new Date())    return res.status(400).json({ success: false, error: 'Reset link has expired. Request a new one.' });

    const password_hash = await bcrypt.hash(new_password, 12);
    await supabase.from('users').update({ password_hash, updated_at: new Date().toISOString() }).eq('id', record.user_id);
    await supabase.from('password_reset_tokens').update({ used: true }).eq('token_hash', tokenHash);

    audit.log({ userId: record.user_id, action: audit.ACTIONS.PASSWORD_RESET, req,
      metadata: { stage: 'completed' } });

    res.json({ success: true, message: 'Password updated. You can now log in.' });
  } catch (err) { next(err); }
});

// ─── Logout ───────────────────────────────────────────────────────────────────
router.post('/logout', requireAuth, (req, res) => {
  audit.log({ userId: req.user.id, action: audit.ACTIONS.LOGOUT, req });
  res.json({ success: true, message: 'Logged out' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2FA ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Setup: TOTP (Google Authenticator / Authy) ───────────────────────────────
// POST /api/auth/2fa/setup/totp
// Returns a secret + QR code data URL. User scans with their authenticator app.
// 2FA is NOT yet active — call /2fa/activate to enable it.
router.post('/2fa/setup/totp', requireAuth, async (req, res, next) => {
  try {
    const { data: user, error } = await supabase.from('users')
      .select('id, email, full_name, two_fa_enabled')
      .eq('id', req.user.id).single();
    if (error || !user) return res.status(404).json({ success: false, error: 'User not found' });

    if (user.two_fa_enabled) {
      return res.status(400).json({ success: false, error: '2FA is already enabled. Disable it first to change method.' });
    }

    const secret = speakeasy.generateSecret({
      name:   `${APP_NAME}:${user.email}`,
      issuer: APP_NAME,
      length: 20,
    });

    // Save secret (pending — not yet enabled)
    await supabase.from('users').update({
      two_fa_secret: secret.base32,
      two_fa_method: 'totp',
    }).eq('id', user.id);

    const otpauthUrl = secret.otpauth_url;
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    res.json({
      success:     true,
      secret:      secret.base32,        // let user manually enter if QR fails
      qr_code:     qrCodeDataUrl,        // base64 PNG — display as <img src="...">
      message:     'Scan the QR code with Google Authenticator or Authy, then call /2fa/activate with the 6-digit code to enable 2FA.',
    });
  } catch (err) { next(err); }
});

// ─── Setup: SMS ───────────────────────────────────────────────────────────────
// POST /api/auth/2fa/setup/sms   body: { phone }
router.post('/2fa/setup/sms', requireAuth, async (req, res, next) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, error: 'phone is required' });

    const { data: user } = await supabase.from('users')
      .select('id, two_fa_enabled').eq('id', req.user.id).single();

    if (user?.two_fa_enabled) {
      return res.status(400).json({ success: false, error: '2FA is already enabled. Disable it first to change method.' });
    }

    // Save phone + method (pending)
    await supabase.from('users').update({
      two_fa_method: 'sms',
      two_fa_phone:  phone,
      two_fa_secret: null,
    }).eq('id', req.user.id);

    // Send verification OTP
    const code = generateOTP();
    await storeOTP(req.user.id, code);
    await sendSMSOTP(phone, code);

    res.json({ success: true, message: 'Verification code sent via SMS. Call /2fa/activate with the code to enable 2FA.' });
  } catch (err) { next(err); }
});

// ─── Setup: Email ─────────────────────────────────────────────────────────────
// POST /api/auth/2fa/setup/email
router.post('/2fa/setup/email', requireAuth, async (req, res, next) => {
  try {
    const { data: user } = await supabase.from('users')
      .select('id, email, full_name, two_fa_enabled').eq('id', req.user.id).single();

    if (user?.two_fa_enabled) {
      return res.status(400).json({ success: false, error: '2FA is already enabled. Disable it first to change method.' });
    }

    await supabase.from('users').update({
      two_fa_method: 'email',
      two_fa_secret: null,
      two_fa_phone:  null,
    }).eq('id', req.user.id);

    const code = generateOTP();
    await storeOTP(req.user.id, code);
    await sendEmailOTP(user.email, user.full_name, code);

    res.json({ success: true, message: 'Verification code sent to your email. Call /2fa/activate with the code to enable 2FA.' });
  } catch (err) { next(err); }
});

// ─── Activate: verify code and turn on 2FA ────────────────────────────────────
// POST /api/auth/2fa/activate   body: { code }
router.post('/2fa/activate', requireAuth, async (req, res, next) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ success: false, error: 'code is required' });

    const { data: user } = await supabase.from('users')
      .select('id, two_fa_method, two_fa_secret, two_fa_enabled').eq('id', req.user.id).single();

    if (!user?.two_fa_method) {
      return res.status(400).json({ success: false, error: 'Start 2FA setup first (/2fa/setup/totp, /2fa/setup/sms, or /2fa/setup/email)' });
    }
    if (user.two_fa_enabled) {
      return res.status(400).json({ success: false, error: '2FA is already active' });
    }

    let valid = false;

    if (user.two_fa_method === 'totp') {
      valid = speakeasy.totp.verify({
        secret:   user.two_fa_secret,
        encoding: 'base32',
        token:    code.replace(/\s/g, ''),
        window:   1,
      });
    } else {
      valid = await verifyOTP(req.user.id, code.replace(/\s/g, ''));
    }

    if (!valid) return res.status(400).json({ success: false, error: 'Invalid or expired code' });

    await supabase.from('users')
      .update({ two_fa_enabled: true })
      .eq('id', req.user.id);

    audit.log({ userId: req.user.id, action: audit.ACTIONS.TWO_FA_ENABLED, req,
      metadata: { method: user.two_fa_method } });

    res.json({ success: true, message: `Two-factor authentication (${user.two_fa_method.toUpperCase()}) is now enabled on your account.` });
  } catch (err) { next(err); }
});

// ─── Resend OTP (for SMS/email — during login or setup) ──────────────────────
// POST /api/auth/2fa/resend   body: { temp_token }  (during login)
// or GET with requireAuth                           (during setup)
router.post('/2fa/resend', async (req, res, next) => {
  try {
    const { temp_token } = req.body;

    let userId, userEmail, userName, twoFaMethod, twoFaPhone;

    if (temp_token) {
      // During login flow
      const decoded = verifyTempToken(temp_token);
      if (!decoded) return res.status(401).json({ success: false, error: 'Invalid or expired session. Please log in again.' });
      const { data: user } = await supabase.from('users')
        .select('id, email, full_name, two_fa_method, two_fa_phone').eq('id', decoded.id).single();
      if (!user) return res.status(404).json({ success: false, error: 'User not found' });
      userId     = user.id;
      userEmail  = user.email;
      userName   = user.full_name;
      twoFaMethod = user.two_fa_method;
      twoFaPhone  = user.two_fa_phone;
    } else {
      return res.status(400).json({ success: false, error: 'temp_token required' });
    }

    if (twoFaMethod === 'totp') {
      return res.status(400).json({ success: false, error: 'TOTP codes are generated by your authenticator app — no resend needed.' });
    }

    const code = generateOTP();
    await storeOTP(userId, code);

    if (twoFaMethod === 'sms') {
      await sendSMSOTP(twoFaPhone, code);
    } else {
      await sendEmailOTP(userEmail, userName, code);
    }

    res.json({ success: true, message: 'New verification code sent.' });
  } catch (err) { next(err); }
});

// ─── Verify 2FA during login ──────────────────────────────────────────────────
// POST /api/auth/2fa/verify   body: { temp_token, code }
router.post('/2fa/verify', async (req, res, next) => {
  try {
    const { temp_token, code } = req.body;
    if (!temp_token || !code) {
      return res.status(400).json({ success: false, error: 'temp_token and code are required' });
    }

    const decoded = verifyTempToken(temp_token);
    if (!decoded) {
      return res.status(401).json({ success: false, error: 'Session expired. Please log in again.' });
    }

    const { data: user } = await supabase.from('users')
      .select('id, email, full_name, company_name, phone, plan, calls_used, calls_limit, ai_messages_used, ai_messages_limit, subscription_status, subscription_plan, subscription_expires_at, monthly_dial_limit, trial_ends_at, email_from_name, email_reply_to, two_fa_enabled, two_fa_method, two_fa_secret, two_fa_phone, password_hash, created_at, referral_code, referred_by, payout_email, payout_method, sms_consent_agreed')
      .eq('id', decoded.id).single();

    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    let valid = false;

    if (user.two_fa_method === 'totp') {
      valid = speakeasy.totp.verify({
        secret:   user.two_fa_secret,
        encoding: 'base32',
        token:    code.replace(/\s/g, ''),
        window:   1,
      });
    } else {
      valid = await verifyOTP(user.id, code.replace(/\s/g, ''));
    }

    if (!valid) {
      audit.log({ userId: user.id, action: audit.ACTIONS.TWO_FA_FAILED, req,
        metadata: { method: user.two_fa_method } });
      return res.status(401).json({ success: false, error: 'Invalid or expired code' });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    const { password_hash, two_fa_secret, ...safeUser } = user;

    audit.log({ userId: user.id, action: audit.ACTIONS.LOGIN, req,
      metadata: { email: user.email, method: '2fa_' + user.two_fa_method } });

    res.json({ success: true, token, user: safeUser });
  } catch (err) { next(err); }
});

// ─── Disable 2FA ──────────────────────────────────────────────────────────────
// DELETE /api/auth/2fa/disable   body: { password }
router.delete('/2fa/disable', requireAuth, async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ success: false, error: 'password is required to disable 2FA' });

    const { data: user } = await supabase.from('users')
      .select('id, password_hash, two_fa_enabled, two_fa_method').eq('id', req.user.id).single();

    if (!user?.two_fa_enabled) {
      return res.status(400).json({ success: false, error: '2FA is not enabled on your account' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ success: false, error: 'Incorrect password' });

    await supabase.from('users').update({
      two_fa_enabled: false,
      two_fa_method:  null,
      two_fa_secret:  null,
      two_fa_phone:   null,
    }).eq('id', req.user.id);

    audit.log({ userId: req.user.id, action: audit.ACTIONS.TWO_FA_DISABLED, req,
      metadata: { method: user.two_fa_method } });

    res.json({ success: true, message: 'Two-factor authentication has been disabled.' });
  } catch (err) { next(err); }
});

// ─── 2FA Status ───────────────────────────────────────────────────────────────
// GET /api/auth/2fa/status
router.get('/2fa/status', requireAuth, async (req, res, next) => {
  try {
    const { data } = await supabase.from('users')
      .select('two_fa_enabled, two_fa_method').eq('id', req.user.id).single();
    res.json({ success: true, enabled: data?.two_fa_enabled || false, method: data?.two_fa_method || null });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GOOGLE OAUTH — Sign in / Sign up with Google
// ═══════════════════════════════════════════════════════════════════════════════

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const BACKEND_URL          = process.env.BACKEND_URL
  || (process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : 'https://veori-ai-main-production.up.railway.app');

// GET /api/auth/google — redirect to Google consent screen
router.get('/google', (req, res) => {
  if (!GOOGLE_CLIENT_ID) {
    return res.redirect(`${APP_URL}/login?error=google_not_configured`);
  }
  const params = new URLSearchParams({
    client_id:     GOOGLE_CLIENT_ID,
    redirect_uri:  `${BACKEND_URL}/api/auth/google/callback`,
    response_type: 'code',
    scope:         'openid email profile',
    access_type:   'offline',
    prompt:        'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// GET /api/auth/google/callback — Google redirects here after user approves
router.get('/google/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error || !code) {
    return res.redirect(`${APP_URL}/login?error=google_cancelled`);
  }

  try {
    // Exchange auth code for access token
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri:  `${BACKEND_URL}/api/auth/google/callback`,
      grant_type:    'authorization_code',
    }, { timeout: 10000 });

    const { access_token } = tokenRes.data;
    if (!access_token) throw new Error('No access token from Google');

    // Get user profile from Google
    const profileRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
      timeout: 10000,
    });

    const { email, name, picture } = profileRes.data;
    if (!email) throw new Error('No email returned from Google');

    const geo = {};

    // Find existing user by email
    let { data: user } = await supabase
      .from('users')
      .select('id, email, full_name, plan, two_fa_enabled, two_fa_method, subscription_status')
      .eq('email', email.toLowerCase())
      .single();

    if (!user) {
      // New user — create account (password_hash required by schema, set to random unguessable value)
      const randomHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
      const { data: newUser, error: createErr } = await supabase
        .from('users')
        .insert({
          id:            uuidv4(),
          email:         email.toLowerCase(),
          password_hash: randomHash,
          full_name:     name || email.split('@')[0],
          plan:          'hustle',
          signup_source: 'google',
          last_seen_at:  new Date().toISOString(),
          ...geo,
        })
        .select('id, email, full_name, plan, two_fa_enabled, two_fa_method, subscription_status')
        .single();

      if (createErr) throw createErr;
      user = newUser;

      audit.log({ userId: user.id, action: audit.ACTIONS.REGISTER,
        metadata: { email: user.email, source: 'google' } });
    }

    // If 2FA enabled, issue temp token and redirect to login for code entry
    if (user.two_fa_enabled) {
      const tempToken = issueTempToken(user);
      const method    = user.two_fa_method || 'email';

      if (method === 'email') {
        const code2fa = generateOTP();
        await storeOTP(user.id, code2fa);
        await sendEmailOTP(user.email, user.full_name, code2fa).catch(() => {});
      }

      const params = new URLSearchParams({
        requires_2fa:  'true',
        two_fa_method: method,
        temp_token:    tempToken,
      });
      return res.redirect(`${APP_URL}/login?${params}`);
    }

    // Issue JWT and redirect to frontend
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    const userPayload = Buffer.from(JSON.stringify({
      id:                  user.id,
      email:               user.email,
      full_name:           user.full_name,
      plan:                user.plan,
      subscription_status: user.subscription_status,
    })).toString('base64url');

    audit.log({ userId: user.id, action: audit.ACTIONS.LOGIN,
      metadata: { email: user.email, method: 'google' } });

    res.redirect(`${APP_URL}/login?gt=${token}&gu=${userPayload}`);
  } catch (err) {
    console.error('[Google OAuth] Error:', err.message);
    res.redirect(`${APP_URL}/login?error=google_failed`);
  }
});

module.exports = router;
