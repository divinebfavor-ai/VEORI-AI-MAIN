const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const contractService = require('../services/contractService');
const { logActivity } = require('../services/dealActivityService');

const router = express.Router();
router.use(requireAuth);

// GET /api/deals
router.get('/', async (req, res, next) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;
    let q = supabase.from('deals').select('*, leads(first_name, last_name, phone)', { count: 'exact' })
      .eq('user_id', req.user.id).order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);
    if (status) q = q.eq('status', status);
    const { data, error, count } = await q;
    if (error) throw error;
    res.json({ success: true, data, total: count });
  } catch (err) { next(err); }
});

// GET /api/deals/:id
router.get('/:id', async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('deals').select('*, leads(*), buyers(*)')
      .eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'Deal not found' });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /api/deals
router.post('/', async (req, res, next) => {
  try {
    const { lead_id, property_address, property_city, property_state, arv, repair_estimate, offer_price } = req.body;
    const mao = arv && repair_estimate ? (arv * 0.70) - repair_estimate : null;
    const { data, error } = await supabase.from('deals').insert([{
      id: uuidv4(), user_id: req.user.id, lead_id, property_address, property_city, property_state,
      arv, repair_estimate, mao, offer_price, status: 'new'
    }]).select().single();
    if (error) throw error;
    await logActivity({
      userId: req.user.id,
      dealId: data.id,
      leadId: data.lead_id,
      activityType: 'deal_created',
      message: `Deal created for ${data.property_address || 'property'}`,
      metadata: { status: data.status, offer_price: data.offer_price, mao: data.mao },
    });
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
});

// PUT /api/deals/:id
router.put('/:id', async (req, res, next) => {
  try {
    const allowed = ['property_address','property_city','property_state','arv','repair_estimate','mao','offer_price','seller_agreed_price','buyer_price','assignment_fee','status','title_company_id','buyer_id','closing_date','seller_contract_url','buyer_contract_url','contract_status','notes'];
    const updates = { updated_at: new Date().toISOString() };
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    const { data: existing, error: existingError } = await supabase
      .from('deals')
      .select('id, lead_id, status, title_company_id, buyer_id, contract_status')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    if (existingError) throw existingError;

    const { data, error } = await supabase.from('deals').update(updates).eq('id', req.params.id).eq('user_id', req.user.id).select().single();
    if (error) throw error;

    const activityMessages = [];
    if (updates.status && updates.status !== existing.status) {
      activityMessages.push({
        activityType: 'stage_updated',
        message: `Deal stage changed from ${existing.status || 'new'} to ${updates.status}`,
        metadata: { from: existing.status, to: updates.status },
      });
    }
    if (updates.title_company_id && updates.title_company_id !== existing.title_company_id) {
      activityMessages.push({
        activityType: 'title_company_assigned',
        message: 'Title company assigned to deal',
        metadata: { title_company_id: updates.title_company_id },
      });
    }
    if (updates.buyer_id && updates.buyer_id !== existing.buyer_id) {
      activityMessages.push({
        activityType: 'buyer_assigned',
        message: 'Buyer linked to deal',
        metadata: { buyer_id: updates.buyer_id },
      });
    }
    if (updates.contract_status && updates.contract_status !== existing.contract_status) {
      activityMessages.push({
        activityType: 'contract_status_updated',
        message: `Contract status updated to ${updates.contract_status}`,
        metadata: { contract_status: updates.contract_status },
      });
    }

    for (const entry of activityMessages) {
      await logActivity({
        userId: req.user.id,
        dealId: data.id,
        leadId: data.lead_id,
        titleCompanyId: updates.title_company_id || existing.title_company_id,
        ...entry,
      });
    }

    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/deals/:id/activity
router.get('/:id/activity', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('deal_activity')
      .select('id, actor_type, activity_type, message, metadata, created_at')
      .eq('user_id', req.user.id)
      .eq('deal_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    res.json({ success: true, activity: data || [] });
  } catch (err) { next(err); }
});

// POST /api/deals/:id/generate-contract
router.post('/:id/generate-contract', async (req, res, next) => {
  try {
    const { type = 'psa' } = req.body; // psa | assignment
    const { data: deal } = await supabase.from('deals').select('*, leads(*)').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (!deal) return res.status(404).json({ success: false, error: 'Deal not found' });
    const result = await contractService.generate(deal, type);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// POST /api/deals/:id/send-contract
router.post('/:id/send-contract', async (req, res, next) => {
  try {
    const { type = 'psa', recipient_phone, recipient_email } = req.body;
    const { data: deal } = await supabase.from('deals').select('*, leads(*)').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (!deal) return res.status(404).json({ success: false, error: 'Deal not found' });
    const { data: dealWithBuyer } = await supabase.from('deals').select('*, leads(*), buyers(*)').eq('id', req.params.id).eq('user_id', req.user.id).single();
    const result = await contractService.send(dealWithBuyer || deal, type, { phone: recipient_phone, email: recipient_email, userId: req.user.id });
    await logActivity({
      userId: req.user.id,
      dealId: deal.id,
      leadId: deal.lead_id,
      activityType: 'contract_sent',
      message: `${type.toUpperCase()} contract sent`,
      metadata: { type, recipient_phone, recipient_email, signing_url: result.signing_url || null },
    });
    await supabase.from('deals').update({ contract_status: 'sent', updated_at: new Date().toISOString() }).eq('id', deal.id).eq('user_id', req.user.id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// POST /api/deals/:id/send-to-title
router.post('/:id/send-to-title', async (req, res, next) => {
  try {
    const { title_company_id, closing_date, notes } = req.body;
    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .select('*, leads(*), buyers(*)')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    if (dealError) throw dealError;
    if (!deal) return res.status(404).json({ success: false, error: 'Deal not found' });

    const resolvedTitleId = title_company_id || deal.title_company_id;
    if (!resolvedTitleId) {
      return res.status(400).json({ success: false, error: 'Select a title company before sending to title' });
    }

    const { data: titleCompany, error: titleError } = await supabase
      .from('title_companies')
      .select('*')
      .eq('id', resolvedTitleId)
      .eq('user_id', req.user.id)
      .single();
    if (titleError) throw titleError;

    const now = new Date().toISOString();
    const titlePayload = {
      user_id: req.user.id,
      deal_id: deal.id,
      title_company_id: titleCompany.id,
      title_contact_name: titleCompany.contact_name || null,
      title_contact_phone: titleCompany.phone || null,
      title_contact_email: titleCompany.email || null,
      sent_to_title_at: now,
      status: 'documents_sent',
      closing_date: closing_date || deal.closing_date || null,
      notes: notes || null,
      updated_at: now,
    };

    const { data: existingLog } = await supabase
      .from('title_logs')
      .select('id')
      .eq('user_id', req.user.id)
      .eq('deal_id', deal.id)
      .maybeSingle();

    let titleLog;
    if (existingLog?.id) {
      const { data, error } = await supabase
        .from('title_logs')
        .update(titlePayload)
        .eq('id', existingLog.id)
        .select()
        .single();
      if (error) throw error;
      titleLog = data;
    } else {
      const { data, error } = await supabase
        .from('title_logs')
        .insert({ id: uuidv4(), ...titlePayload })
        .select()
        .single();
      if (error) throw error;
      titleLog = data;
    }

    const { data: updatedDeal, error: updateDealError } = await supabase
      .from('deals')
      .update({
        title_company_id: titleCompany.id,
        closing_date: closing_date || deal.closing_date || null,
        status: 'sent_to_title',
        updated_at: now,
      })
      .eq('id', deal.id)
      .eq('user_id', req.user.id)
      .select()
      .single();
    if (updateDealError) throw updateDealError;

    await logActivity({
      userId: req.user.id,
      dealId: deal.id,
      leadId: deal.lead_id,
      titleCompanyId: titleCompany.id,
      activityType: 'sent_to_title',
      message: `Deal package sent to ${titleCompany.name}`,
      metadata: {
        title_company_id: titleCompany.id,
        title_company_name: titleCompany.name,
        closing_date: titlePayload.closing_date,
      },
    });

    res.json({ success: true, data: { deal: updatedDeal, title_log: titleLog, title_company: titleCompany } });
  } catch (err) { next(err); }
});

// GET /api/deals/:id/title-log
router.get('/:id/title-log', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('title_logs')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('deal_id', req.params.id)
      .maybeSingle();
    if (error) throw error;
    res.json({ success: true, title_log: data || null });
  } catch (err) { next(err); }
});

// POST /api/deals/:id/start-buyer-campaign
router.post('/:id/start-buyer-campaign', async (req, res, next) => {
  try {
    const { data: deal } = await supabase.from('deals').select('*').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (!deal) return res.status(404).json({ success: false, error: 'Deal not found' });

    // Find matching buyers
    const { data: buyers } = await supabase.from('buyers')
      .select('*').eq('user_id', req.user.id).eq('is_active', true)
      .or(`buy_box_states.cs.{"${deal.property_state}"},buy_box_states.eq.{}`)
      .lte('max_price', deal.buyer_price || deal.offer_price * 1.1);

    // Log in deals table that buyer search is active
    await supabase.from('deals').update({ status: 'buyer search', updated_at: new Date().toISOString() })
      .eq('id', req.params.id).eq('user_id', req.user.id);
    const campaign = { id: req.params.id, status: 'active' };

    res.json({ success: true, data: { campaign, buyers_matched: buyers?.length || 0 } });
  } catch (err) { next(err); }
});

module.exports = router;
