/**
 * Feedback / Bug Reports
 *
 * POST /api/feedback        — submit a report (auth required)
 * GET  /api/feedback        — list all reports (service-role, for admin view)
 * PATCH /api/feedback/:id   — update status (service-role)
 */
const router  = require('express').Router();
const { requireAuth: auth } = require('../middleware/auth');
const supabase = require('../config/supabase');
const { sendEmail } = require('../services/emailService');

const ADMIN_EMAIL = (process.env.ADMIN_EMAILS || 'divineqflash@gmail.com').split(',')[0].trim();

const VALID_TYPES    = ['bug', 'feature', 'complaint', 'other'];
const VALID_STATUSES = ['open', 'in_progress', 'resolved', 'dismissed'];

// ─── POST /api/feedback ───────────────────────────────────────────────────────
router.post('/', auth, async (req, res) => {
  try {
    const { type = 'bug', subject, description, page } = req.body;

    if (!subject?.trim())      return res.status(400).json({ error: 'Subject is required.' });
    if (!description?.trim())  return res.status(400).json({ error: 'Description is required.' });
    if (!VALID_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid type.' });

    const { data, error } = await supabase.from('feedback').insert({
      user_id:     req.user.id,
      user_email:  req.user.email,
      type,
      subject:     subject.trim(),
      description: description.trim(),
      page:        page || null,
      status:      'open',
    }).select().single();

    if (error) throw error;

    // Instant email alert to admin
    sendEmail({
      to:      ADMIN_EMAIL,
      subject: `[Veori ${type.toUpperCase()}] ${subject}`,
      html: `
        <div style="font-family:Inter,Arial,sans-serif;max-width:560px;background:#060E1A;color:#fff;border-radius:12px;padding:32px;">
          <div style="font-size:20px;font-weight:900;margin-bottom:20px;">VEORI — User ${type.charAt(0).toUpperCase()+type.slice(1)}</div>
          <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
            <tr><td style="padding:8px 0;color:rgba(255,255,255,0.5);font-size:12px;width:100px;">From</td><td style="font-size:13px;color:#fff;">${req.user.email}</td></tr>
            <tr><td style="padding:8px 0;color:rgba(255,255,255,0.5);font-size:12px;">Type</td><td style="font-size:13px;color:#fff;">${type}</td></tr>
            <tr><td style="padding:8px 0;color:rgba(255,255,255,0.5);font-size:12px;">Page</td><td style="font-size:13px;color:#fff;">${data.page || 'unknown'}</td></tr>
            <tr><td style="padding:8px 0;color:rgba(255,255,255,0.5);font-size:12px;">Subject</td><td style="font-size:13px;color:#fff;font-weight:600;">${subject}</td></tr>
          </table>
          <div style="background:rgba(255,255,255,0.05);border-radius:8px;padding:16px;font-size:13px;color:rgba(255,255,255,0.8);line-height:1.6;">${description.replace(/\n/g, '<br>')}</div>
          <p style="font-size:11px;color:rgba(255,255,255,0.3);margin-top:20px;">Report ID: ${data.id}</p>
        </div>
      `,
    }).catch(e => console.warn('[Feedback] Admin alert failed:', e.message));

    console.log(`[Feedback] ${req.user.email} submitted ${type}: "${subject}"`);
    res.json({ success: true, id: data.id });
  } catch (err) {
    console.error('[feedback/submit]', err.message);
    res.status(500).json({ error: 'Failed to submit feedback. Please try again.' });
  }
});

// ─── GET /api/feedback ────────────────────────────────────────────────────────
// Admin only — returns all reports sorted newest first
router.get('/', auth, async (req, res) => {
  try {
    const { status, type, limit = 100, offset = 0 } = req.query;

    let query = supabase.from('feedback')
      .select('*')
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (status && VALID_STATUSES.includes(status)) query = query.eq('status', status);
    if (type   && VALID_TYPES.includes(type))      query = query.eq('type', type);

    const { data, error } = await query;
    if (error) throw error;
    res.json({ success: true, feedback: data || [] });
  } catch (err) {
    console.error('[feedback/list]', err.message);
    res.status(500).json({ error: 'Failed to load feedback.' });
  }
});

// ─── PATCH /api/feedback/:id ──────────────────────────────────────────────────
router.patch('/:id', auth, async (req, res) => {
  try {
    const { status } = req.body;
    if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status.' });

    const { error } = await supabase.from('feedback')
      .update({ status })
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('[feedback/update]', err.message);
    res.status(500).json({ error: 'Failed to update feedback.' });
  }
});

module.exports = router;
