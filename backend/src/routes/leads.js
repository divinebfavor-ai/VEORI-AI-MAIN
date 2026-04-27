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
      const { data, error } = await supabase.from('leads').insert(chunk).select('id').onConflict?.('phone,user_id') || await supabase.from('leads').insert(chunk).select('id');
      if (!error) imported += data?.length || chunk.length;
      else duplicates += chunk.length;
    }

    // Auto-tag all imported leads async — don't block the response
    const { data: newLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(imported);

    if (newLeads?.length) {
      setImmediate(() => tagLeadsBulk(newLeads.map(l => l.id)));
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

    const { data: seller, error } = await supabase.from('sellers').insert({
      name: name || `${first_name} ${last_name}`.trim(),
      phone,
      email: email || null,
      property_address: property_address || target_area || null,
      motivation_type: motivation_type || 'other',
      price_range_min: price_range_min || null,
      price_range_max: price_range_max || null,
      timeline: timeline || null,
      contact_preference: contact_preference || 'sms',
      lead_source: lead_source || 'manual',
      operator_id: req.user.id,
    }).select().single();

    if (error) throw error;

    // Also create a lead record
    await supabase.from('leads').insert({
      id: uuidv4(),
      user_id: req.user.id,
      first_name, last_name, phone, email: email || null,
      property_address: property_address || target_area || null,
      source: lead_source || 'ingest',
      status: 'new',
      motivation_type: motivation_type || 'other',
    });

    // Log the ingestion
    await supabase.from('ai_command_log').insert({
      contact_name: name,
      action_type: 'lead_ingested',
      message_sent: `New ${motivation_type || 'other'} seller lead ingested: ${property_address || phone}`,
      outcome: 'success',
      operator_id: req.user.id,
    });

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
        property_address: lead.property_address,
        state: lead.property_state || '',
        stage: 'contacted',
        seller_id: lead.id,
        operator_id: req.user.id,
        status: 'active',
      }).select().single();

      await supabase.from('leads').update({ status: 'offer_made', deal_id: deal?.deal_id }).eq('id', lead_id);

      await supabase.from('ai_command_log').insert({
        deal_id: deal?.deal_id,
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

module.exports = router;
