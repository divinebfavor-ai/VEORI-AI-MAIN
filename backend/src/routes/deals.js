const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const contractService = require('../services/contractService');
const { recordWinningPlaybook } = require('../services/dataMotService');
const { logActivity } = require('../services/dealActivityService');
const { autoAssignTitleCompany, sendDealPackageToTitle, scheduleTitleFollowUps } = require('../services/titleService');

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

// POST /api/deals/create — alias for POST /api/deals
router.post('/create', async (req, res, next) => {
  const { property_address, state, deal_type, arv, repair_costs, offer_price, seller_id, buyer_id, title_company_id } = req.body;
  if (!property_address || !state) return res.status(400).json({ success: false, error: 'property_address and state required' });

  const arv_n = parseFloat(arv) || 0;
  const repair_n = parseFloat(repair_costs) || 0;
  const mao = arv_n > 0 ? (arv_n * 0.70) - repair_n : null;

  try {
    const { data, error } = await supabase.from('deals').insert({
      deal_type: deal_type || 'assignment',
      state,
      property_address,
      arv: arv_n || null,
      repair_costs: repair_n || null,
      mao,
      offer_price: parseFloat(offer_price) || null,
      seller_id: seller_id || null,
      buyer_id: buyer_id || null,
      title_company_id: title_company_id || null,
      operator_id: req.user.id,
      stage: 'lead',
      stage_changed_at: new Date().toISOString(),
      status: 'active',
    }).select().single();
    if (error) throw error;

    // Double-close alert
    if (deal_type === 'double_close') {
      await supabase.from('notifications').insert({
        operator_id: req.user.id,
        type: 'double_close_alert',
        title: 'Transactional Funding Required',
        message: `Deal at ${property_address} is a double-close. Please confirm your funding source before proceeding.`,
        deal_id: data.deal_id,
        is_read: false,
      });
    }

    await supabase.from('ai_command_log').insert({
      deal_id: data.deal_id,
      action_type: 'deal_created',
      message_sent: `Deal created: ${property_address}`,
      outcome: 'success',
      operator_id: req.user.id,
    });

    res.status(201).json({ success: true, deal: data });
  } catch (err) { next(err); }
});

// PATCH /api/deals/:id/stage — advance deal stage
router.patch('/:id/stage', async (req, res, next) => {
  try {
    const VALID_STAGES = ['lead','contacted','offer_sent','under_contract','sent_to_title','closing_prep','closed'];
    const { stage } = req.body;
    if (!VALID_STAGES.includes(stage)) return res.status(400).json({ success: false, error: 'Invalid stage' });

    const { data: deal } = await supabase.from('deals').select('stage, ai_paused, operator_id').eq('deal_id', req.params.id).single();
    if (!deal || deal.operator_id !== req.user.id) return res.status(404).json({ success: false, error: 'Deal not found' });

    const { data, error } = await supabase.from('deals').update({
      stage,
      stage_changed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('deal_id', req.params.id).select().single();
    if (error) throw error;

    await supabase.from('ai_command_log').insert({
      deal_id: req.params.id,
      action_type: 'stage_changed',
      message_sent: `Stage changed from ${deal.stage} → ${stage}`,
      outcome: 'success',
      operator_id: req.user.id,
    });

    res.json({ success: true, deal: data });

    // Record winning playbook when deal closes
    if (stage === 'closed') {
      setImmediate(async () => {
        try {
          const { data: fullDeal } = await supabase.from('deals').select('*').eq('deal_id', req.params.id).single();
          const { data: lead } = fullDeal?.lead_id
            ? await supabase.from('leads').select('*').eq('id', fullDeal.lead_id).single()
            : { data: null };
          if (fullDeal) {
            const { count: callCount } = await supabase.from('calls').select('*', { count: 'exact', head: true }).eq('lead_id', fullDeal.lead_id);
            const createdAt = new Date(fullDeal.created_at);
            const daysToClose = Math.round((Date.now() - createdAt.getTime()) / 86400000);
            await recordWinningPlaybook({ deal: fullDeal, lead, calls_to_close: callCount || 0, days_to_close: daysToClose });
          }
        } catch (e) { console.error('[DataMot] Playbook record failed:', e.message); }
      });
    }

    // Auto-start buyer campaign when deal moves to under_contract
    if (stage === 'under_contract') {
      setImmediate(async () => {
        try {
          const { data: fullDeal } = await supabase.from('deals').select('*').eq('deal_id', req.params.id).single();
          if (!fullDeal) return;
          // Find buyers in same state that match on price
          const { data: matchedBuyers } = await supabase.from('buyers')
            .select('*')
            .eq('user_id', req.user.id)
            .or(`preferred_states.cs.{${fullDeal.property_state}},preferred_states.is.null`)
            .lte('max_purchase_price', (fullDeal.buyer_price || fullDeal.offer_price || 999999999) * 1.15)
            .eq('is_active', true)
            .limit(20);
          console.log(`[Deal] Auto buyer match: ${matchedBuyers?.length || 0} buyers found for deal ${req.params.id}`);
          await supabase.from('ai_command_log').insert({
            deal_id: req.params.id,
            action_type: 'buyer_match_auto',
            message_sent: `Auto-matched ${matchedBuyers?.length || 0} buyers when deal moved to under_contract`,
            outcome: 'success',
            operator_id: req.user.id,
          });
        } catch (e) {
          console.error('[Deal] Auto buyer match failed:', e.message);
        }
      });

      // Auto title company workflow — assign, email deal package, schedule follow-ups
      setImmediate(async () => {
        try {
          const { data: fullDeal } = await supabase.from('deals').select('*').eq('deal_id', req.params.id).single();
          if (!fullDeal) return;
          const dealDbId = fullDeal.id || req.params.id;
          const userId = req.user.id;

          const assigned = await autoAssignTitleCompany(dealDbId, userId);
          if (assigned) {
            await sendDealPackageToTitle(dealDbId, userId);
            await scheduleTitleFollowUps(dealDbId, userId);
            console.log(`[Title] Full automation triggered for deal ${dealDbId} → ${assigned.name}`);
          } else {
            console.log(`[Title] No title company found for deal ${dealDbId} — skipping auto-send`);
          }
        } catch (e) {
          console.error('[Title] Auto title workflow failed:', e.message);
        }
      });
    }
  } catch (err) { next(err); }
});

// PATCH /api/deals/:id/pause-ai — toggle AI pause for a deal
router.patch('/:id/pause-ai', async (req, res, next) => {
  try {
    const { paused } = req.body;
    const { data: deal } = await supabase.from('deals').select('operator_id, ai_paused').eq('deal_id', req.params.id).single();
    if (!deal || deal.operator_id !== req.user.id) return res.status(404).json({ success: false, error: 'Deal not found' });

    const newState = paused !== undefined ? !!paused : !deal.ai_paused;
    const { data, error } = await supabase.from('deals').update({ ai_paused: newState, updated_at: new Date().toISOString() }).eq('deal_id', req.params.id).select().single();
    if (error) throw error;

    await supabase.from('ai_command_log').insert({
      deal_id: req.params.id,
      action_type: newState ? 'ai_paused' : 'ai_resumed',
      message_sent: newState ? 'AI automation paused by operator' : 'AI automation resumed by operator',
      outcome: 'success',
      operator_id: req.user.id,
    });

    res.json({ success: true, ai_paused: newState });
  } catch (err) { next(err); }
});

// GET /api/deals/:id/velocity-score — compute Deal Velocity Score
router.get('/:id/velocity-score', async (req, res, next) => {
  try {
    const { data: deal } = await supabase.from('deals').select('*').eq('deal_id', req.params.id).single();
    if (!deal || deal.operator_id !== req.user.id) return res.status(404).json({ success: false, error: 'Deal not found' });

    // Count AI touches (conversations/actions)
    const { count: touchCount } = await supabase.from('ai_command_log').select('*', { count: 'exact', head: true }).eq('deal_id', req.params.id);
    const daysSinceContact = deal.stage_changed_at ? Math.floor((Date.now() - new Date(deal.stage_changed_at).getTime()) / 86400000) : 30;

    // Weighted scoring formula
    const motivationScore   = (deal.motivation_score || 50) * 0.35;
    const recencyScore      = Math.max(0, 100 - (daysSinceContact * 3)) * 0.20;
    const touchScore        = Math.min(100, (touchCount || 0) * 10) * 0.15;
    const stageScore        = (['offer_sent','under_contract'].includes(deal.stage) ? 80 : 40) * 0.15;
    const buyerDepthScore   = 50 * 0.10; // default — update with buyer pool query if needed
    const complianceScore   = 70 * 0.05; // default

    const velocity = Math.min(100, Math.round(motivationScore + recencyScore + touchScore + stageScore + buyerDepthScore + complianceScore));

    // Persist velocity score
    await supabase.from('deals').update({ deal_velocity_score: velocity }).eq('deal_id', req.params.id);

    const label = velocity >= 70 ? 'High probability' : velocity >= 40 ? 'Needs attention' : 'At risk';
    const color = velocity >= 70 ? 'green' : velocity >= 40 ? 'yellow' : 'red';

    res.json({ success: true, velocity_score: velocity, label, color });
  } catch (err) { next(err); }
});

// GET /api/deals/:id/brief — Smart Deal Brief (Claude Sonnet 4.6)
router.get('/:id/brief', async (req, res, next) => {
  try {
    const { data: deal } = await supabase.from('deals').select('*').eq('deal_id', req.params.id).single();
    if (!deal || deal.operator_id !== req.user.id) return res.status(404).json({ success: false, error: 'Deal not found' });

    const { data: lastLog } = await supabase.from('ai_command_log')
      .select('action_type, message_sent, created_at')
      .eq('deal_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const { data: seller } = deal.seller_id
      ? await supabase.from('sellers').select('name').eq('seller_id', deal.seller_id).single()
      : { data: null };

    const { generateDealBrief } = require('../services/dualAIService');
    const result = await generateDealBrief({
      deal,
      lastAiAction: lastLog ? `${lastLog.action_type} — ${new Date(lastLog.created_at).toLocaleDateString()}` : null,
      sellerName: seller?.name || null,
      nextRecommendedStep: null,
    });

    res.json({ success: true, ...result });
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
