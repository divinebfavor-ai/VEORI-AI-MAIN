
const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'veori-ai-secret-change-in-production';

// ─── Register ─────────────────────────────────────────────────────────────────
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, full_name, company_name, phone } = req.body;
    if (!email || !password || !full_name) {
      return res.status(400).json({ success: false, error: 'email, password and full_name required' });
    }

    const hash = await bcrypt.hash(password, 12);
    const { data, error } = await supabase
      .from('users')
      .insert([{ id: uuidv4(), email: email.toLowerCase(), password_hash: hash, full_name, company_name, phone, plan: 'hustle' }])
      .select('id, email, full_name, company_name, plan, calls_limit, calls_used')
      .single();

    if (error) {
      if (error.code === '23505') return res.status(409).json({ success: false, error: 'Email already registered' });
      throw error;
    }

    const token = jwt.sign({ id: data.id, email: data.email }, JWT_SECRET, { expiresIn: '7d' });
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
      .select('id, email, full_name, company_name, phone, plan, calls_used, calls_limit, ai_messages_used, ai_messages_limit, created_at')
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

    if (String(new_password).length < 8) {
      return res.status(400).json({ success: false, error: 'New password must be at least 8 characters' });
    }

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

// ─── Logout ───────────────────────────────────────────────────────────────────
router.post('/logout', (_req, res) => res.json({ success: true, message: 'Logged out' }));

module.exports = router;
