/**
 * Feature 20 — Direct Mail Auto-Trigger
 * Routes: GET /api/direct-mail, POST /api/direct-mail/send, GET /api/direct-mail/templates,
 *         POST /api/direct-mail/auto-trigger/:leadId
 */
const router  = require('express').Router();
const { requireAuth: auth } = require('../middleware/auth');
const supabase = require('../config/supabase');
const directMailService = require('../services/directMailService');

router.use(auth);

// GET /api/direct-mail — history of sent mail
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('direct_mail_log')
      .select('*, leads(first_name, last_name, property_address)')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;
    res.json({ success: true, mail: data || [] });
  } catch (err) {
    console.error('[DirectMail] history error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load mail history' });
  }
});

// GET /api/direct-mail/templates — available templates
router.get('/templates', async (_req, res) => {
  try {
    const templates = [
      { id: 'no_answer', name: 'No Answer Follow-Up', description: 'Send when call goes unanswered 3+ times', trigger: 'no_answer' },
      { id: 'motivated', name: 'Motivated Seller Outreach', description: 'Send to high motivation score leads (70+)', trigger: 'high_motivation' },
      { id: 'last_chance', name: 'Last Chance Offer', description: 'Send to leads with no activity in 30+ days', trigger: 'inactive' },
    ];
    res.json({ success: true, templates });
  } catch (err) {
    console.error('[DirectMail] templates error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load templates' });
  }
});

// POST /api/direct-mail/send — manually send mail to a lead
router.post('/send', async (req, res) => {
  try {
    const { lead_id, template } = req.body;
    if (!lead_id || !template) {
      return res.status(400).json({ success: false, error: 'lead_id and template required' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .eq('user_id', req.user.id)
      .single();

    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

    // Build address for Lob
    const address = {
      name:    `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Property Owner',
      address: lead.property_address || lead.mailing_address || '',
      city:    lead.city || '',
      state:   lead.state || '',
      zip:     lead.zip  || '',
    };

    if (!address.address) {
      return res.status(400).json({ success: false, error: 'Lead has no address on file' });
    }

    // Log first (Lob call may fail in dev without real API key)
    const { data: logEntry, error: logErr } = await supabase
      .from('direct_mail_log')
      .insert({
        user_id:   req.user.id,
        lead_id,
        template,
        address,
        status:    'queued',
        trigger_reason: 'manual',
      })
      .select().single();

    if (logErr) throw logErr;

    // Attempt actual Lob send
    try {
      const result = await directMailService.sendPostcard(lead, template);
      await supabase
        .from('direct_mail_log')
        .update({
          lob_postcard_id: result?.id || null,
          status:          'sent',
          sent_at:         new Date().toISOString(),
        })
        .eq('id', logEntry.id);
      res.json({ success: true, mail: { ...logEntry, status: 'sent', lob_result: result } });
    } catch (lobErr) {
      console.warn('[DirectMail] Lob API error (logged as queued):', lobErr.message);
      res.json({ success: true, mail: logEntry, warning: 'Mail queued — Lob API key not configured' });
    }
  } catch (err) {
    console.error('[DirectMail] send error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to send mail' });
  }
});

// POST /api/direct-mail/auto-trigger/:leadId — check triggers and send if matched
router.post('/auto-trigger/:leadId', async (req, res) => {
  try {
    const { leadId } = req.params;

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', leadId)
      .eq('user_id', req.user.id)
      .single();

    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

    // Check triggers
    const { data: recentMail } = await supabase
      .from('direct_mail_log')
      .select('id')
      .eq('lead_id', leadId)
      .gte('created_at', new Date(Date.now() - 14 * 86400000).toISOString())
      .limit(1);

    if (recentMail?.length > 0) {
      return res.json({ success: true, triggered: false, reason: 'Mail sent within last 14 days' });
    }

    // Determine template
    let template = null;
    let triggerReason = '';

    const daysSinceContact = lead.last_contact_date
      ? Math.floor((Date.now() - new Date(lead.last_contact_date)) / 86400000)
      : 999;

    const { data: recentCalls } = await supabase
      .from('calls')
      .select('status')
      .eq('lead_id', leadId)
      .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString());

    const unanswered = recentCalls?.filter(c => !['completed', 'answered'].includes(c.status)).length || 0;

    if (unanswered >= 3) {
      template = 'no_answer';
      triggerReason = `${unanswered} unanswered calls in last 7 days`;
    } else if ((lead.motivation_score || 0) >= 70) {
      template = 'motivated';
      triggerReason = `High motivation score: ${lead.motivation_score}`;
    } else if (daysSinceContact >= 30) {
      template = 'last_chance';
      triggerReason = `No contact in ${daysSinceContact} days`;
    }

    if (!template) {
      return res.json({ success: true, triggered: false, reason: 'No trigger conditions met' });
    }

    // Send
    const { data: logEntry } = await supabase
      .from('direct_mail_log')
      .insert({
        user_id: req.user.id,
        lead_id: leadId,
        template,
        address: {
          name:    `${lead.first_name || ''} ${lead.last_name || ''}`.trim(),
          address: lead.property_address || '',
          city:    lead.city || '',
          state:   lead.state || '',
          zip:     lead.zip  || '',
        },
        status: 'queued',
        trigger_reason: triggerReason,
      })
      .select().single();

    try {
      const result = await directMailService.sendPostcard(lead, template);
      await supabase.from('direct_mail_log').update({
        lob_postcard_id: result?.id,
        status: 'sent',
        sent_at: new Date().toISOString(),
      }).eq('id', logEntry.id);
    } catch {}

    res.json({ success: true, triggered: true, template, reason: triggerReason, mail: logEntry });
  } catch (err) {
    console.error('[DirectMail] auto-trigger error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to auto-trigger mail' });
  }
});

// GET /api/direct-mail/stats — overview stats
router.get('/stats', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('direct_mail_log')
      .select('template, status')
      .eq('user_id', req.user.id);

    if (error) throw error;

    const rows = data || [];
    const stats = {
      total:    rows.length,
      sent:     rows.filter(r => r.status === 'sent').length,
      queued:   rows.filter(r => r.status === 'queued').length,
      by_template: {},
    };

    for (const r of rows) {
      if (!stats.by_template[r.template]) stats.by_template[r.template] = 0;
      stats.by_template[r.template]++;
    }

    res.json({ success: true, stats });
  } catch (err) {
    console.error('[DirectMail] stats error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load stats' });
  }
});

module.exports = router;
