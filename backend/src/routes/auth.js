
const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const { sendEmail } = require('../services/emailService');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'veori-ai-secret-change-in-production';
const APP_URL    = process.env.FRONTEND_URL || 'https://veori.net';

const geoip = require('geoip-lite');

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

// ─── Register ─────────────────────────────────────────────────────────────────
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, full_name, company_name, phone } = req.body;
    if (!email || !password || !full_name) {
      return res.status(400).json({ success: false, error: 'email, password and full_name required' });
    }

    const pwError = validatePasswordStrength(password);
    if (pwError) return res.status(400).json({ success: false, error: pwError });

    const hash = await bcrypt.hash(password, 12);
    const geo  = getGeoFromRequest(req);
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

    // Send welcome email (fire and forget)
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
      .select('*')
      .eq('email', email.toLowerCase())
      .single();

    if (error || !user) return res.status(401).json({ success: false, error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ success: false, error: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    const { password_hash, ...safeUser } = user;
    res.json({ success: true, token, user: safeUser });
  } catch (err) { next(err); }
});

// ─── Me ───────────────────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, email, full_name, company_name, phone, plan, calls_used, calls_limit, ai_messages_used, ai_messages_limit, subscription_status, trial_ends_at, email_from_name, email_reply_to, created_at')
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

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) { next(err); }
});

// ─── Forgot Password ─────────────────────────────────────────────────────────
// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, error: 'Email is required' });

    const { data: user } = await supabase.from('users')
      .select('id, email, full_name').eq('email', email.toLowerCase().trim()).single();

    // Always return success to prevent email enumeration attacks
    if (!user) return res.json({ success: true, message: 'If that email exists, a reset link was sent.' });

    // Generate a secure random token (hex, 32 bytes = 64 chars)
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    // Store hashed token in DB
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

    res.json({ success: true, message: 'If that email exists, a reset link was sent.' });
  } catch (err) { next(err); }
});

// ─── Reset Password ──────────────────────────────────────────────────────────
// POST /api/auth/reset-password
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

    if (!record)                         return res.status(400).json({ success: false, error: 'Invalid or expired reset link' });
    if (record.used)                     return res.status(400).json({ success: false, error: 'This reset link has already been used' });
    if (new Date(record.expires_at) < new Date()) return res.status(400).json({ success: false, error: 'Reset link has expired. Request a new one.' });

    const password_hash = await bcrypt.hash(new_password, 12);
    await supabase.from('users').update({ password_hash, updated_at: new Date().toISOString() }).eq('id', record.user_id);
    await supabase.from('password_reset_tokens').update({ used: true }).eq('token_hash', tokenHash);

    res.json({ success: true, message: 'Password updated. You can now log in.' });
  } catch (err) { next(err); }
});

// ─── Logout ───────────────────────────────────────────────────────────────────
router.post('/logout', (_req, res) => res.json({ success: true, message: 'Logged out' }));

module.exports = router;
