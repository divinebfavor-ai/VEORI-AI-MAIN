const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const aiService = require('../services/aiService');
const { tagLead, tagLeadsBulk, getOpeningSMS } = require('../services/leadTaggingService');

const router = express.Router();
router.use(requireAuth);

// GET /api/leads — list with all filters
router.get('/', async (req, res, next) => {
  try {
    const { campaign_id, status, score_min, score_max, state, source, limit = 50, offset = 0, search, date_from } = req.query;

    let q = supabase.from('leads').select('*', { count: 'exact' })
      .eq('user_id', req.user.id)
      .order('motivation_score', { ascending: false, nullsFirst: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (status)    q = q.eq('status', status);
    if (state)     q = q.eq('property_state', state);
    if (source)    q = q.eq('source', source);
    if (score_min) q = q.gte('motivation_score', Number(score_min));
    if (score_max) q = q.lte('motivation_score', Number(score_max));
    if (date_from) q = q.gte('created_at', date_from);
    if (search) {
      q = q.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,phone.ilike.%${search}%,property_address.ilike.%${search}%`);
    }

    const { data, error, count } = await q;
    if (error) throw error;
    res.json({ success: true, data, total: count, limit: Number(limit), offset: Number(offset) });
  } catch (err) { next(err); }
});

// POST /api/leads/reset-stale-calling — reset any leads stuck in "calling" with no active call
router.post('/reset-stale-calling', async (req, res, next) => {
  try {
    // Find leads with status "calling" that have no in-progress call
    const { data: activeCalls } = await supabase.from('calls')
      .select('lead_id').eq('user_id', req.user.id)
      .in('status', ['initiated', 'ringing', 'in-progress']);
    const activeLeadIds = (activeCalls || []).map(c => c.lead_id).filter(Boolean);

    let q = supabase.from('leads').update({ status: 'contacted' })
      .eq('user_id', req.user.id).eq('status', 'calling');
    if (activeLeadIds.length > 0) q = q.not('id', 'in', `(${activeLeadIds.join(',')})`);

    const { count } = await q.select('id', { count: 'exact', head: true });
    await q;
    res.json({ success: true, reset: count || 0 });
  } catch (err) { next(err); }
});

// GET /api/leads/:id — full lead with call history
router.get('/:id', async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('leads').select('*, calls(*), deals(*)')
      .eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'Lead not found' });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /api/leads — create single
router.post('/', async (req, res, next) => {
  try {
    const { first_name, last_name, phone, email, property_address, property_city, property_state, property_zip, property_type, estimated_value, estimated_equity, source, notes, tags } = req.body;
    if (!phone) return res.status(400).json({ success: false, error: 'phone required' });

    // DNC check
    const { data: dnc } = await supabase.from('dnc_records').select('id').eq('phone', phone).single();
    const is_on_dnc = !!dnc;

    const { data, error } = await supabase.from('leads').insert([{
      id: uuidv4(), user_id: req.user.id, first_name, last_name, phone, email,
      property_address, property_city, property_state, property_zip, property_type,
      estimated_value, estimated_equity, source, notes, tags, is_on_dnc, status: is_on_dnc ? 'dnc' : 'new'
    }]).select().single();

    if (error) throw error;

    // Auto-tag within 60 seconds (async — don't block response)
    setImmediate(async () => {
      const tagged = await tagLead(data.id);
      if (tagged && !is_on_dnc) {
        // Re-fetch to get tag for SMS
        const { data: full } = await supabase.from('leads').select('*').eq('id', data.id).single();
        if (full) {
          const sms = getOpeningSMS(full);
          // Log opening SMS to be sent (conversations service picks this up)
          await supabase.from('ai_command_log').insert({
            operator_id: req.user.id,
            action_type: 'opening_sms',
            contact_name: `${full.first_name} ${full.last_name}`,
            message_sent: sms,
            outcome: 'queued',
          }).catch(() => {});
        }
      }
    });

    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /api/leads/bulk — CSV import up to 10,000
router.post('/bulk', async (req, res, next) => {
  try {
    const { leads } = req.body;
    if (!Array.isArray(leads) || !leads.length) return res.status(400).json({ success: false, error: 'leads array required' });

    // Get all DNC numbers
    const phones = leads.map(l => l.phone).filter(Boolean);
    const { data: dncData } = await supabase.from('dnc_records').select('phone').in('phone', phones);
    const dncSet = new Set((dncData || []).map(d => d.phone));

    const records = leads.map(l => ({
      id: uuidv4(),
      user_id: req.user.id,
      first_name:       l.first_name || l['First Name'] || l.firstname || '',
      last_name:        l.last_name  || l['Last Name']  || l.lastname  || '',
      phone:            l.phone      || l['Phone']      || '',
      email:            l.email      || l['Email']      || null,
      property_address: l.property_address || l['Property Address'] || l.address || '',
      property_city:    l.property_city    || l['City']    || '',
      property_state:   l.property_state   || l['State']   || '',
      property_zip:     l.property_zip     || l['Zip']     || '',
      property_type:    l.property_type    || l['Type']    || '',
      estimated_value:  parseNum(l.estimated_value  || l['Estimated Value']  || l['AVM']),
      estimated_equity: parseNum(l.estimated_equity || l['Estimated Equity'] || l['Equity']),
      source: l.source || l['Source'] || 'csv_import',
      is_on_dnc: dncSet.has(l.phone),
      status: dncSet.has(l.phone) ? 'dnc' : 'new',
    })).filter(r => r.phone);

    // Deduplicate by phone within batch
    const seen = new Set();
    const unique = records.filter(r => { if (seen.has(r.phone)) return false; seen.add(r.phone); return true; });

    let imported = 0;
    let duplicates = 0;
    const chunkSize = 500;
    for (let i = 0; i < unique.length; i += chunkSize) {
      const chunk = unique.slice(i, i + chunkSize);
      // Use upsert so duplicate phone+user_id rows are ignored instead of erroring
      const { data, error } = await supabase
        .from('leads')
        .upsert(chunk, { onConflict: 'phone,user_id', ignoreDuplicates: true })
        .select('id');
      if (!error) {
        imported += data?.length || chunk.length;
      } else {
        // Upsert failed (e.g. no unique constraint) — fall back to plain insert
        const { data: ins, error: insErr } = await supabase.from('leads').insert(chunk).select('id');
        if (!insErr) imported += ins?.length || chunk.length;
        else {
          console.warn('[Leads import] Insert error:', insErr.message);
          duplicates += chunk.length;
        }
      }
    }

    // Auto-tag all imported leads async — don't block the response
    const { data: newLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(imported);

    if (newLeads?.length) {
      setImmediate(() => tagLeadsBulk(newLeads.map(l => l.id)));

      // Fire opening SMS to every lead that has a phone number
      const { sendOpeningSMS } = require('../services/smsService');
      const userId = req.user.id;
      setImmediate(async () => {
        for (const lead of newLeads) {
          if (lead.phone && !lead.is_on_dnc) {
            await sendOpeningSMS(lead, userId).catch(() => {});
            await new Promise(r => setTimeout(r, 300)); // 300ms between sends
          }
        }
        console.log(`[SMS] Opening texts sent to ${newLeads.filter(l => l.phone).length} leads`);
      });
    }

    res.status(201).json({
      success: true,
      imported,
      dnc_flagged: unique.filter(r => r.is_on_dnc).length,
      duplicates_skipped: duplicates,
      total_received: leads.length,
    });
  } catch (err) { next(err); }
});

// PUT /api/leads/:id
router.put('/:id', async (req, res, next) => {
  try {
    const allowed = ['first_name','last_name','email','phone','property_address','property_city','property_state','property_zip','property_type','estimated_value','estimated_equity','estimated_arv','source','status','motivation_score','notes','tags'];
    const updates = { updated_at: new Date().toISOString() };
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    const { data, error } = await supabase.from('leads').update(updates).eq('id', req.params.id).eq('user_id', req.user.id).select().single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// DELETE /api/leads/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const { error } = await supabase.from('leads').delete().eq('id', req.params.id).eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { next(err); }
});

// GET /api/leads/:id/research — AI property analysis
// POST /api/leads/:id/retag — manually retag a lead
router.post('/:id/retag', async (req, res, next) => {
  try {
    const { data: lead } = await supabase.from('leads').select('id, user_id').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    const tagged = await tagLead(lead.id);
    res.json({ success: true, data: tagged });
  } catch (err) { next(err); }
});

// POST /api/leads/retag-all — retag all leads for this operator
router.post('/retag-all', async (req, res, next) => {
  try {
    const { data: leads } = await supabase.from('leads').select('id').eq('user_id', req.user.id);
    if (!leads?.length) return res.json({ success: true, tagged: 0 });
    setImmediate(() => tagLeadsBulk(leads.map(l => l.id)));
    res.json({ success: true, queued: leads.length, message: `Tagging ${leads.length} leads in background` });
  } catch (err) { next(err); }
});

router.get('/:id/research', async (req, res, next) => {
  try {
    const { data: lead } = await supabase.from('leads').select('*').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    const analysis = await aiService.analyzePropertyOffer({ address: lead.property_address, city: lead.property_city, state: lead.property_state, estimatedValue: lead.estimated_value });
    if (analysis) {
      await supabase.from('leads').update({ estimated_arv: analysis.estimated_arv }).eq('id', req.params.id);
    }
    res.json({ success: true, data: analysis });
  } catch (err) { next(err); }
});

// POST /api/leads/:id/dnc
router.post('/:id/dnc', async (req, res, next) => {
  try {
    const { data: lead } = await supabase.from('leads').select('phone').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    await supabase.from('dnc_records').upsert([{ id: uuidv4(), phone: lead.phone, added_by: req.user.id, reason: req.body.reason || 'manual' }]);
    await supabase.from('leads').update({ is_on_dnc: true, status: 'dnc' }).eq('id', req.params.id);
    res.json({ success: true, message: 'Added to DNC' });
  } catch (err) { next(err); }
});

// POST /api/leads/:id/skip-trace — run skip trace on a lead
router.post('/:id/skip-trace', async (req, res, next) => {
  try {
    const { skipTraceLead } = require('../services/skipTraceService');
    const { data: lead } = await supabase.from('leads').select('*').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    const result = await skipTraceLead(lead);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// POST /api/leads/:id/direct-mail — send a physical postcard
router.post('/:id/direct-mail', async (req, res, next) => {
  try {
    const { sendPostcard } = require('../services/directMailService');
    const { template = 'no_answer' } = req.body;
    const { data: lead } = await supabase.from('leads').select('*').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    if (!lead.property_address) return res.status(400).json({ success: false, error: 'Lead has no property address' });
    const { data: operator } = await supabase.from('users').select('ai_caller_name, company_name, business_phone, id').eq('id', req.user.id).single();
    const result = await sendPostcard({ lead, operator: operator || {}, templateKey: template });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// POST /api/leads/:id/voicemail — drop a ringless voicemail
router.post('/:id/voicemail', async (req, res, next) => {
  try {
    const { dropVoicemail } = require('../services/voicemailService');
    const { template = 'first_contact' } = req.body;
    const { data: lead } = await supabase.from('leads').select('*').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    if (lead.is_on_dnc) return res.status(400).json({ success: false, error: 'Lead is on DNC list' });
    if (!lead.phone) return res.status(400).json({ success: false, error: 'Lead has no phone number' });
    const { data: operator } = await supabase.from('users').select('ai_caller_name, ai_voice_id, company_name, id').eq('id', req.user.id).single();
    const result = await dropVoicemail({ lead, operator: operator || {}, templateKey: template });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// POST /api/leads/ingest — structured lead ingestion with all required fields
router.post('/ingest', async (req, res, next) => {
  try {
    const {
      name, phone, email, property_address, motivation_type,
      price_range_min, price_range_max, timeline, contact_preference,
      lead_source, target_area, notes
    } = req.body;

    if (!phone) return res.status(400).json({ success: false, error: 'phone required' });

    // DNC check
    const { data: dnc } = await supabase.from('dnc_records').select('id').eq('phone', phone).single();
    if (dnc) return res.status(400).json({ success: false, error: 'This number is on the DNC list' });

    const nameParts = (name || '').split(' ');
    const first_name = nameParts[0] || '';
    const last_name  = nameParts.slice(1).join(' ') || '';

    // Insert into leads table (no sellers table in schema)
    const { data: seller, error } = await supabase.from('leads').insert({
      id: uuidv4(),
      user_id: req.user.id,
      first_name, last_name, phone, email: email || null,
      property_address: property_address || target_area || null,
      source: lead_source || 'ingest',
      status: 'new',
      notes: notes || null,
    }).select().single();

    if (error) throw error;

    res.status(201).json({ success: true, seller });
  } catch (err) { next(err); }
});

// POST /api/leads/qualify — AI qualification engine
router.post('/qualify', async (req, res, next) => {
  try {
    const { lead_id, conversation_text } = req.body;
    if (!lead_id) return res.status(400).json({ success: false, error: 'lead_id required' });

    const { data: lead } = await supabase.from('leads').select('*').eq('id', lead_id).eq('user_id', req.user.id).single();
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

    const { qualifyLead } = require('../services/dualAIService');
    const result = await qualifyLead({
      name: `${lead.first_name} ${lead.last_name}`.trim(),
      phone: lead.phone,
      propertyAddress: lead.property_address,
      conversationHistory: conversation_text || '',
      motivationType: lead.motivation_type || 'other',
    });

    // Update motivation score
    await supabase.from('leads').update({
      motivation_score: result.motivation_score,
      updated_at: new Date().toISOString(),
    }).eq('id', lead_id);

    // Store qualification conversation
    if (conversation_text) {
      await supabase.from('ai_command_log').insert({
        contact_id: lead_id,
        contact_name: `${lead.first_name} ${lead.last_name}`.trim(),
        action_type: 'lead_qualified',
        message_sent: conversation_text.substring(0, 500),
        outcome: result.recommended_action,
        operator_id: req.user.id,
      });
    }

    // Auto-escalate to pipeline if score >= 60
    if (result.motivation_score >= 60 && result.recommended_action === 'escalate_to_pipeline') {
      const { data: deal } = await supabase.from('deals').insert({
        id: require('uuid').v4(),
        user_id: req.user.id,
        lead_id: lead.id,
        property_address: lead.property_address,
        property_state: lead.property_state || null,
        status: 'new',
      }).select().single();

      await supabase.from('leads').update({ status: 'interested', deal_id: deal?.id }).eq('id', lead_id);

      await supabase.from('ai_command_log').insert({
        deal_id: deal?.id,
        contact_name: `${lead.first_name} ${lead.last_name}`.trim(),
        action_type: 'escalated_to_pipeline',
        message_sent: `Score: ${result.motivation_score}/100 — auto-escalated to deal pipeline`,
        outcome: 'deal_created',
        operator_id: req.user.id,
      });
    }

    res.json({ success: true, qualification: result });
  } catch (err) { next(err); }
});

function parseNum(v) { const n = parseFloat(String(v || '').replace(/[^0-9.]/g, '')); return isNaN(n) ? null : n; }

// ─── Photo request helpers ────────────────────────────────────────────────────
const crypto = require('crypto');
const axios  = require('axios');

const TELNYX_KEY     = process.env.TELNYX_API_KEY;
const SMS_FROM       = process.env.TELNYX_SMS_NUMBER || '+19197945843';
const TELNYX_PROFILE = process.env.TELNYX_MESSAGING_PROFILE_ID;
const FRONTEND_URL   = process.env.FRONTEND_URL || 'https://veori.net';

async function generatePhotoToken(leadId, userId, sentVia = 'manual') {
  const token     = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await supabase.from('photo_upload_tokens').insert({
    token, lead_id: leadId, user_id: userId, expires_at: expiresAt, sent_via: sentVia,
  });

  return { token, url: `${FRONTEND_URL}/upload/${token}`, expiresAt };
}

// POST /api/leads/:id/send-photo-request — generate link and send to seller
router.post('/:id/send-photo-request', async (req, res, next) => {
  try {
    const { data: lead } = await supabase
      .from('leads')
      .select('id, first_name, last_name, phone, email, property_address, property_city, property_state, user_id')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();

    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    if (!lead.phone && !lead.email) {
      return res.status(400).json({ success: false, error: 'No phone or email on this lead' });
    }

    const name    = lead.first_name || 'there';
    const address = [lead.property_address, lead.property_city, lead.property_state].filter(Boolean).join(', ');

    let sentVia = 'manual';
    let delivered = false;

    // Try SMS first
    if (lead.phone && TELNYX_KEY) {
      const { token, url } = await generatePhotoToken(lead.id, req.user.id, 'sms');
      const message = `Hi ${name}, thanks for speaking with us about ${address || 'your property'}. Please tap the link to send us photos — takes 2 min on your phone:\n\n${url}\n\nThis link expires in 7 days.`;

      try {
        await axios.post('https://api.telnyx.com/v2/messages', {
          from: SMS_FROM,
          to:   lead.phone,
          text: message,
          messaging_profile_id: TELNYX_PROFILE,
        }, {
          headers: { Authorization: `Bearer ${TELNYX_KEY}`, 'Content-Type': 'application/json' },
          timeout: 10000,
        });
        sentVia   = 'sms';
        delivered = true;
        return res.json({ success: true, sent_via: 'sms', phone: lead.phone, token, url });
      } catch (e) {
        console.warn('[PhotoRequest] SMS failed, trying email:', e.message);
      }
    }

    // Fallback to email
    if (lead.email) {
      const { token, url } = await generatePhotoToken(lead.id, req.user.id, 'email');
      const { sendEmail } = require('../services/emailService');
      await sendEmail({
        to:      lead.email,
        subject: `Please send us photos of ${lead.property_address || 'your property'}`,
        html: `
          <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;background:#060E1A;color:#fff;border-radius:16px;padding:40px;">
            <div style="font-size:24px;font-weight:900;letter-spacing:-0.04em;margin-bottom:24px;">VEORI</div>
            <p style="font-size:15px;color:rgba(255,255,255,0.7);margin:0 0 20px;">Hi ${name},</p>
            <p style="font-size:15px;color:rgba(255,255,255,0.7);margin:0 0 24px;">Thanks for speaking with us about <strong style="color:#fff">${address || 'your property'}</strong>. To help us move forward, please send us photos of the property using the button below.</p>
            <a href="${url}" style="display:block;text-align:center;background:#00C37A;color:#060E1A;font-size:15px;font-weight:800;padding:16px;border-radius:10px;text-decoration:none;margin-bottom:20px;">Send Property Photos</a>
            <p style="font-size:12px;color:rgba(255,255,255,0.35);">This link expires in 7 days. If you have any questions, simply reply to this email.</p>
          </div>
        `,
      });
      delivered = true;
      return res.json({ success: true, sent_via: 'email', email: lead.email, token, url });
    }

    // Neither worked — return the link anyway for manual sharing
    const { token, url } = await generatePhotoToken(lead.id, req.user.id, 'manual');
    res.json({ success: true, sent_via: 'link_only', token, url,
      message: 'No phone/email delivery available — copy the link to share manually.' });
  } catch (err) { next(err); }
});

// GET /api/leads/:id/photos — list photos for a lead
router.get('/:id/photos', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('lead_photos')
      .select('id, url, source, file_name, created_at')
      .eq('lead_id', req.params.id)
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ success: true, photos: data || [] });
  } catch (err) { next(err); }
});

module.exports = router;
