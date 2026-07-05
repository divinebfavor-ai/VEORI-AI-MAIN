const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const contractService = require('../services/contractService');
const { recordWinningPlaybook } = require('../services/dataMotService');
const { logActivity } = require('../services/dealActivityService');
const { runCloseRitual } = require('../services/closeRitualService');
const { autoAssignTitleCompany, sendDealPackageToTitle, scheduleTitleFollowUps } = require('../services/titleService');
const { suggestAssignmentFee } = require('../services/assignmentFeeService');

const router = express.Router();
router.use(requireAuth);

// Helper - true if the table simply doesn't exist yet
function isTableMissing(err) {
  return err?.code === 'PGRST205' || (err?.message || '').includes('Could not find the table');
}

// ─── Learning loop (Rule 3) - record a deal's TERMINAL outcome ────────────────
// When a deal flips to a final state (won = 'closed', lost = 'dead'/'lost'/'dnc'),
// drop one row into deal_outcome_learning so the prediction engine can learn from
// real history (predictionEngine.applyOutcomeLearning reads same-state outcomes to
// nudge confidence). This CLOSES the loop: coo.js + leads.js already READ this table,
// but nothing was WRITING to it.
//
// SAFETY: best-effort & non-blocking (the response is already sent / about to be).
// Never throws. NEVER FABRICATES - fields we don't have are written as null, not
// invented. Only fires on a real status TRANSITION into a terminal state, so a deal
// can't be double-counted by re-saving the same status. Uses the deal row already in
// hand (no buggy re-fetch); a missing table or insert error is swallowed + logged.
const TERMINAL_OUTCOME = { closed: 'closed', dead: 'dead', lost: 'dead', dnc: 'dead' };

async function recordTerminalOutcome(deal, toStatus, leadRow = null) {
  try {
    const outcome = TERMINAL_OUTCOME[(toStatus || '').toLowerCase()];
    if (!outcome || !deal) return;                       // not terminal → nothing to learn

    const createdAt    = deal.created_at ? new Date(deal.created_at) : null;
    const daysToOutcome = createdAt
      ? Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / 86400000))
      : null;
    const now          = new Date();
    const seasons      = ['winter','winter','spring','spring','spring','summer','summer','summer','fall','fall','fall','winter'];

    await supabase.from('deal_outcome_learning').insert({
      deal_id:                deal.id || null,
      outcome,                                            // 'closed' | 'dead'
      reason:                 deal.notes || null,
      days_to_outcome:        daysToOutcome,
      final_motivation_score: leadRow?.motivation_score ?? null,
      state:                  deal.property_state || leadRow?.property_state || null,
      property_type:          deal.property_type || leadRow?.property_type || null,
      month:                  now.getMonth() + 1,
      season:                 seasons[now.getMonth()],
      assignment_fee:         outcome === 'closed' ? (deal.assignment_fee ?? null) : null,
      created_at:             now.toISOString(),
    });
  } catch (e) {
    console.warn('[Deal] Outcome learning record failed (non-fatal):', e.message);
  }
}

// Mirror the deal's EMD state onto its per-deal title_logs row so the title view
// stays in parity with deals (the source of truth). The old call was best-effort
// with a swallowed .catch - a transient failure left title_logs permanently stale
// (drift). This retries, and on permanent failure LOGS the drift instead of hiding
// it, so it's recoverable rather than invisible. Never throws - the deals write
// already succeeded; a mirror failure must not fail the request.
async function mirrorEmdToTitleLog(userId, dealId, fields, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    const { data, error } = await supabase
      .from('title_logs')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('deal_id', dealId)
      .select('id');
    if (!error) {
      if (!data || data.length === 0) {
        // No title_logs row yet for this deal - nothing to mirror onto (title work
        // hasn't started). Not an error; the title view will read deals directly.
        console.log(`[Deal] EMD mirror skipped - no title_logs row for deal ${dealId}`);
      }
      return;
    }
    if (isTableMissing(error)) return; // title_logs not provisioned - nothing to do
    console.warn(`[Deal] EMD mirror attempt ${i + 1}/${attempts} failed for deal ${dealId}: ${error.message}`);
    if (i < attempts - 1) await new Promise(r => setTimeout(r, 400 * (i + 1)));
    else console.error(`[Deal] EMD mirror DRIFT - title_logs not updated for deal ${dealId}: ${error.message}`);
  }
}

// GET /api/deals
router.get('/', async (req, res, next) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;
    let q = supabase.from('deals').select('*, leads(first_name, last_name, phone)', { count: 'exact' })
      .eq('user_id', req.user.id).order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);
    if (status) q = q.eq('status', status);
    const { data, error, count } = await q;
    if (error) {
      if (isTableMissing(error)) return res.json({ success: true, data: [], total: 0 });
      throw error;
    }
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
    const {
      lead_id, property_address, property_city, property_state, property_zip,
      arv, repair_estimate, offer_price, status,
      seller_name, seller_phone, seller_email, seller_primary_tag,
      estimated_value, estimated_equity,
    } = req.body;
    const mao = arv && repair_estimate ? (arv * 0.70) - repair_estimate : null;

    // If lead_id provided, pull seller info from lead for auto-fill
    let sellerInfo = {};
    if (lead_id) {
      const { data: lead } = await supabase.from('leads').select('first_name,last_name,phone,email,primary_tag,estimated_value,estimated_equity').eq('id', lead_id).single().then(null, () => ({ data: null }));
      if (lead) {
        sellerInfo = {
          seller_name:        seller_name || `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || null,
          seller_phone:       seller_phone || lead.phone || null,
          seller_email:       seller_email || lead.email || null,
          seller_primary_tag: seller_primary_tag || lead.primary_tag || null,
          estimated_value:    estimated_value || lead.estimated_value || null,
          estimated_equity:   estimated_equity || lead.estimated_equity || null,
        };
      }
    }

    const { data, error } = await supabase.from('deals').insert([{
      id: uuidv4(), user_id: req.user.id, lead_id,
      property_address, property_city, property_state, property_zip,
      arv, repair_estimate, mao, offer_price,
      status: status || 'lead',
      ...sellerInfo,
    }]).select().single();
    if (error) throw error;

    // logActivity is non-fatal - deal creation must succeed even if activity log fails
    logActivity({
      userId: req.user.id,
      dealId: data.id,
      leadId: data.lead_id,
      activityType: 'deal_created',
      message: `Deal created for ${data.property_address || 'property'}`,
      metadata: { status: data.status, offer_price: data.offer_price, mao: data.mao },
    }).catch(e => console.warn('[Deal] Activity log failed (non-fatal):', e.message));

    res.status(201).json({ success: true, data, deal: data });
  } catch (err) { next(err); }
});

// PUT /api/deals/:id
router.put('/:id', async (req, res, next) => {
  try {
    const allowed = ['property_address','property_city','property_state','arv','repair_estimate','mao','offer_price','seller_agreed_price','buyer_price','assignment_fee','status','title_company_id','buyer_id','closing_date','seller_contract_url','buyer_contract_url','contract_status','notes','emd_status','emd_amount','emd_refundable','emd_held_by'];
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
      logActivity({
        userId: req.user.id,
        dealId: data.id,
        leadId: data.lead_id,
        titleCompanyId: updates.title_company_id || existing.title_company_id,
        ...entry,
      }).catch(e => console.warn('[Deal] Activity log failed (non-fatal):', e.message));
    }

    // Learning loop (Rule 3): on a real transition into a terminal state, record the
    // outcome so predictions sharpen over time. Best-effort + non-blocking - runs after
    // the response, pulls the lead's motivation score if available, never fails the PUT.
    if (updates.status && updates.status !== existing.status && TERMINAL_OUTCOME[(updates.status || '').toLowerCase()]) {
      setImmediate(async () => {
        let leadRow = null;
        if (data.lead_id) {
          const { data: ld } = await supabase.from('leads')
            .select('motivation_score, property_state, property_type')
            .eq('id', data.lead_id).single().then(null, () => ({ data: null }));
          leadRow = ld || null;
        }
        await recordTerminalOutcome(data, updates.status, leadRow);
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
    const { type = 'psa' } = req.body; // psa | assignment (strategy auto-detected from deal_type)
    const { data: deal } = await supabase.from('deals').select('*, leads(*), buyers(*)').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (!deal) return res.status(404).json({ success: false, error: 'Deal not found' });
    const result = await contractService.generate(deal, type, { userId: req.user.id });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// GET /api/deals/:id/contract.pdf?type=psa|assignment - on-demand downloadable PDF.
// Streams the generated contract as a PDF attachment; nothing stored.
router.get('/:id/contract.pdf', async (req, res, next) => {
  try {
    const type = String(req.query.type || 'psa');
    const { data: deal } = await supabase.from('deals').select('*, leads(*), buyers(*)').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (!deal) return res.status(404).json({ success: false, error: 'Deal not found' });
    const result = await contractService.generate(deal, type, { userId: req.user.id });
    const pdf = await contractService.renderPdf({ content: result.content, doc_title: result.doc_title });
    const safeAddr = String(deal.property_address || 'contract').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'contract';
    const filename = `${safeAddr}-${result.strategy || result.type}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdf.length);
    res.send(pdf);
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
    logActivity({
      userId: req.user.id,
      dealId: deal.id,
      leadId: deal.lead_id,
      activityType: 'contract_sent',
      message: `${type.toUpperCase()} contract sent`,
      metadata: { type, recipient_phone, recipient_email, signing_url: result.signing_url || null },
    }).catch(e => console.warn('[Deal] Activity log failed:', e.message));
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

    logActivity({
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
    }).catch(e => console.warn('[Deal] Activity log failed:', e.message));

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

// GET /api/deals/:id/wire - the EFFECTIVE wire instructions for this deal.
// Resolution: per-deal override on title_logs wins; else the title-company default.
// Stores/returns last-4 + free-text only (never full account/routing numbers).
router.get('/:id/wire', async (req, res, next) => {
  try {
    const WIRE_KEYS = ['wire_bank_name','wire_account_name','wire_routing_last4','wire_account_last4','wire_instructions'];
    const { data: deal } = await supabase
      .from('deals')
      .select('id, title_company_id')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    if (!deal) return res.status(404).json({ success: false, error: 'Deal not found' });

    const { data: log } = await supabase
      .from('title_logs')
      .select('wire_bank_name, wire_account_name, wire_routing_last4, wire_account_last4, wire_instructions')
      .eq('user_id', req.user.id)
      .eq('deal_id', req.params.id)
      .maybeSingle();

    let titleDefault = null;
    if (deal.title_company_id) {
      const { data: tc } = await supabase
        .from('title_companies')
        .select('wire_bank_name, wire_account_name, wire_routing_last4, wire_account_last4, wire_instructions')
        .eq('id', deal.title_company_id)
        .eq('user_id', req.user.id)
        .maybeSingle();
      titleDefault = tc || null;
    }

    // Per-deal override wins field-by-field; fall back to the title-company default.
    const effective = {};
    let source = 'none';
    for (const k of WIRE_KEYS) {
      const override = log && log[k] != null && log[k] !== '' ? log[k] : null;
      const fallback = titleDefault && titleDefault[k] != null && titleDefault[k] !== '' ? titleDefault[k] : null;
      effective[k] = override ?? fallback ?? null;
      if (override != null) source = 'deal_override';
      else if (effective[k] != null && source === 'none') source = 'title_default';
    }

    res.json({ success: true, wire: effective, source, deal_override: log || null, title_default: titleDefault });
  } catch (err) { next(err); }
});

// POST /api/deals/:id/wire - save a PER-DEAL wire override onto title_logs.
// Upserts the deal's title_logs row (creating a minimal one if the deal hasn't been
// sent to title yet) so wiring details are pinned to the exact deal - isolation.
router.post('/:id/wire', async (req, res, next) => {
  try {
    const WIRE_KEYS = ['wire_bank_name','wire_account_name','wire_routing_last4','wire_account_last4','wire_instructions'];
    const { data: deal, error: dErr } = await supabase
      .from('deals')
      .select('id, lead_id, title_company_id')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    if (dErr) throw dErr;
    if (!deal) return res.status(404).json({ success: false, error: 'Deal not found' });

    const now = new Date().toISOString();
    const wireUpdates = { updated_at: now };
    WIRE_KEYS.forEach(k => { if (req.body[k] !== undefined) wireUpdates[k] = req.body[k]; });

    const { data: existing } = await supabase
      .from('title_logs')
      .select('id')
      .eq('user_id', req.user.id)
      .eq('deal_id', deal.id)
      .maybeSingle();

    let titleLog;
    if (existing?.id) {
      const { data, error } = await supabase
        .from('title_logs')
        .update(wireUpdates)
        .eq('id', existing.id)
        .eq('user_id', req.user.id)
        .select()
        .single();
      if (error) throw error;
      titleLog = data;
    } else {
      const { data, error } = await supabase
        .from('title_logs')
        .insert({
          id: uuidv4(),
          user_id: req.user.id,
          deal_id: deal.id,
          title_company_id: deal.title_company_id || null,
          status: 'wire_set',
          ...wireUpdates,
        })
        .select()
        .single();
      if (error) throw error;
      titleLog = data;
    }

    logActivity({
      userId: req.user.id,
      dealId: deal.id,
      leadId: deal.lead_id,
      titleCompanyId: deal.title_company_id || null,
      activityType: 'wire_instructions_set',
      message: 'Per-deal wire instructions saved',
      metadata: { account_last4: wireUpdates.wire_account_last4 ?? null },
    }).catch(e => console.warn('[Deal] Activity log failed:', e.message));

    res.json({ success: true, title_log: titleLog });
  } catch (err) { next(err); }
});

// POST /api/deals/:id/emd/confirm - manually confirm earnest money received.
// The buyer-YES path auto-REQUESTS the EMD (sms.js handleBuyerReply); this is the
// operator's manual CONFIRM that it actually landed. Mirrors the per-deal EMD onto
// title_logs so the title view sees it too. Scoped to the operator.
router.post('/:id/emd/confirm', async (req, res, next) => {
  try {
    const { amount, held_by, refundable } = req.body;
    const { data: deal, error: dealErr } = await supabase
      .from('deals')
      .select('id, lead_id, emd_amount, emd_status')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    if (dealErr) throw dealErr;
    if (!deal) return res.status(404).json({ success: false, error: 'Deal not found' });

    const now = new Date().toISOString();
    const confirmedAmount = amount != null ? Number(amount)
      : (deal.emd_amount != null ? Number(deal.emd_amount) : null);

    const updates = {
      emd_status:      'received',
      emd_received_at: now,
      updated_at:      now,
    };
    if (confirmedAmount != null) updates.emd_amount = confirmedAmount;
    if (held_by !== undefined)   updates.emd_held_by = held_by;
    if (refundable !== undefined) updates.emd_refundable = !!refundable;

    const { data, error } = await supabase
      .from('deals')
      .update(updates)
      .eq('id', deal.id)
      .eq('user_id', req.user.id)
      .select()
      .single();
    if (error) throw error;

    // Mirror onto the per-deal title log (retry + drift-logged - title view parity).
    await mirrorEmdToTitleLog(req.user.id, deal.id, {
      emd_status: 'received',
      emd_amount: confirmedAmount,
    });

    logActivity({
      userId: req.user.id,
      dealId: deal.id,
      leadId: deal.lead_id,
      activityType: 'emd_received',
      message: `Earnest money deposit confirmed received${confirmedAmount != null ? ` ($${confirmedAmount.toLocaleString()})` : ''}`,
      metadata: { emd_amount: confirmedAmount, held_by: updates.emd_held_by ?? null, refundable: updates.emd_refundable ?? null },
    }).catch(e => console.warn('[Deal] Activity log failed:', e.message));

    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/deals/:id/fee-suggestion - AI-suggested assignment fee from the spread.
// Read-only: returns the suggestion + basis WITHOUT writing. Operator decides.
router.get('/:id/fee-suggestion', async (req, res, next) => {
  try {
    const { data: deal, error } = await supabase
      .from('deals')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    if (error) throw error;
    if (!deal) return res.status(404).json({ success: false, error: 'Deal not found' });
    const suggestion = suggestAssignmentFee(deal);
    res.json({ success: true, suggestion });
  } catch (err) { next(err); }
});

// POST /api/deals/:id/fee-suggestion/apply - write the chosen fee onto the deal.
// Persists the operator's accepted figure plus the AI suggestion + its basis for
// the record. `fee` defaults to the AI suggestion if the operator doesn't override.
router.post('/:id/fee-suggestion/apply', async (req, res, next) => {
  try {
    const { fee } = req.body;
    const { data: deal, error } = await supabase
      .from('deals')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    if (error) throw error;
    if (!deal) return res.status(404).json({ success: false, error: 'Deal not found' });

    const suggestion = suggestAssignmentFee(deal);
    const chosen = fee != null ? Number(fee) : suggestion.suggested;
    if (chosen == null) {
      return res.status(400).json({ success: false, error: 'No fee to apply - provide a fee or set deal pricing first.' });
    }

    const now = new Date().toISOString();
    const { data, error: upErr } = await supabase
      .from('deals')
      .update({
        assignment_fee:           chosen,
        assignment_fee_suggested: suggestion.suggested,
        assignment_fee_basis:     suggestion.basis,
        updated_at:               now,
      })
      .eq('id', deal.id)
      .eq('user_id', req.user.id)
      .select()
      .single();
    if (upErr) throw upErr;

    logActivity({
      userId: req.user.id,
      dealId: deal.id,
      leadId: deal.lead_id,
      activityType: 'assignment_fee_set',
      message: `Assignment fee set to $${Number(chosen).toLocaleString()}`,
      metadata: { fee: chosen, suggested: suggestion.suggested, basis: suggestion.basis },
    }).catch(e => console.warn('[Deal] Activity log failed:', e.message));

    res.json({ success: true, data, suggestion });
  } catch (err) { next(err); }
});

// POST /api/deals/create - alias for POST /api/deals (schema-aligned)
router.post('/create', async (req, res, next) => {
  try {
    const { property_address, property_city, property_state, deal_type, strategy_terms, arv, repair_estimate, offer_price, lead_id, title_company_id } = req.body;
    if (!property_address) return res.status(400).json({ success: false, error: 'property_address required' });

    const arv_n = parseFloat(arv) || 0;
    const repair_n = parseFloat(repair_estimate) || 0;
    const mao = arv_n > 0 ? Math.round((arv_n * 0.70) - repair_n) : null;

    const { data, error } = await supabase.from('deals').insert({
      id: require('uuid').v4(),
      user_id: req.user.id,
      lead_id: lead_id || null,
      deal_type: deal_type || 'assignment',
      strategy_terms: strategy_terms || null,   // structured creative terms; null for cash/assignment
      property_address,
      property_city: property_city || null,
      property_state: property_state || null,
      arv: arv_n || null,
      repair_estimate: repair_n || null,
      mao,
      offer_price: parseFloat(offer_price) || null,
      title_company_id: title_company_id || null,
      status: 'lead',
    }).select().single();
    if (error) throw error;

    logActivity({
      userId: req.user.id, dealId: data.id, leadId: data.lead_id,
      activityType: 'deal_created', message: `Deal created for ${property_address}`,
      metadata: { status: data.status, deal_type: data.deal_type },
    }).catch(e => console.warn('[Deal] Activity log failed:', e.message));

    res.status(201).json({ success: true, deal: data, data });
  } catch (err) { next(err); }
});

// PATCH /api/deals/:id/stage - advance deal stage
router.patch('/:id/stage', async (req, res, next) => {
  try {
    const VALID_STAGES = ['lead','contacted','offer_sent','under_contract','sent_to_title','closing_prep','closed'];
    const { stage } = req.body;
    if (!VALID_STAGES.includes(stage)) return res.status(400).json({ success: false, error: 'Invalid stage' });

    const { data: deal } = await supabase.from('deals').select('status, ai_paused, user_id').eq('id', req.params.id).single();
    if (!deal || deal.user_id !== req.user.id) return res.status(404).json({ success: false, error: 'Deal not found' });

    const { data, error } = await supabase.from('deals').update({
      status: stage,
      updated_at: new Date().toISOString(),
    }).eq('id', req.params.id).eq('user_id', req.user.id).select().single();
    if (error) throw error;

    supabase.from('ai_command_log').insert({
      deal_id: req.params.id,
      action_type: 'stage_changed',
      message_sent: `Stage changed from ${deal.status} → ${stage}`,
      outcome: 'success',
      operator_id: req.user.id,
    }).then(null, () => {});

    res.json({ success: true, deal: data });

    // Record winning playbook when deal closes
    if (stage === 'closed') {
      setImmediate(async () => {
        try {
          const { data: fullDeal } = await supabase.from('deals').select('*').eq('id', req.params.id).single();
          const { data: lead } = fullDeal?.lead_id
            ? await supabase.from('leads').select('*').eq('id', fullDeal.lead_id).single()
            : { data: null };
          if (fullDeal) {
            const { count: callCount } = await supabase.from('calls').select('*', { count: 'exact', head: true }).eq('lead_id', fullDeal.lead_id);
            const createdAt = new Date(fullDeal.created_at);
            const daysToClose = Math.round((Date.now() - createdAt.getTime()) / 86400000);
            await recordWinningPlaybook({ deal: fullDeal, lead, calls_to_close: callCount || 0, days_to_close: daysToClose });
            // Learning loop (Rule 3): record the won outcome alongside the playbook so
            // predictionEngine has same-state history. Best-effort; never throws.
            await recordTerminalOutcome(fullDeal, 'closed', lead);
          }
        } catch (e) { console.error('[DataMot] Playbook record failed:', e.message); }
      });

      // CLOSE RITUAL (Stage 6) - stamp the fee, text thank-you to seller + buyer,
      // and drop a deal_closed row on the chart. Idempotent + best-effort; never
      // blocks the response (already sent above) and never throws here.
      setImmediate(() => {
        runCloseRitual({ dealId: req.params.id, userId: req.user.id })
          .catch(e => console.error('[CloseRitual] failed:', e.message));
      });
    }

    // Auto-start buyer campaign when deal moves to under_contract
    if (stage === 'under_contract') {
      setImmediate(async () => {
        try {
          // Match buyers on the LIVE buy-box columns and blast them via the Phase-1
          // SMS queue. buyerDispoService.startBuyerBlast owns the correct matcher
          // (replacing the old dead-column query that referenced preferred_states /
          // max_purchase_price, which don't exist on the live buyers table).
          const buyerDispo = require('../services/buyerDispoService');
          const { matched, enqueued, campaignId } = await buyerDispo.startBuyerBlast(req.params.id, req.user.id);
          console.log(`[Deal] Auto buyer blast: matched ${matched}, enqueued ${enqueued} for deal ${req.params.id}`);
          await supabase.from('ai_command_log').insert({
            deal_id: req.params.id,
            action_type: 'buyer_blast_auto',
            message_sent: `Auto-matched ${matched} buyers, blasted ${enqueued} when deal moved to under_contract`,
            outcome: 'success',
            operator_id: req.user.id,
          }).then(null, () => {});
        } catch (e) {
          console.error('[Deal] Auto buyer blast failed:', e.message);
        }
      });

      // Auto title company workflow - assign, email deal package, schedule follow-ups
      setImmediate(async () => {
        try {
          const { data: fullDeal } = await supabase.from('deals').select('*').eq('id', req.params.id).single();
          if (!fullDeal) return;
          const dealDbId = fullDeal.id || req.params.id;
          const userId = req.user.id;

          const assigned = await autoAssignTitleCompany(dealDbId, userId);
          if (assigned) {
            await sendDealPackageToTitle(dealDbId, userId);
            await scheduleTitleFollowUps(dealDbId, userId);
            console.log(`[Title] Full automation triggered for deal ${dealDbId} → ${assigned.name}`);
          } else {
            console.log(`[Title] No title company found for deal ${dealDbId} - skipping auto-send`);
          }
        } catch (e) {
          console.error('[Title] Auto title workflow failed:', e.message);
        }
      });
    }
  } catch (err) { next(err); }
});

// PATCH /api/deals/:id/pause-ai - toggle AI pause for a deal
router.patch('/:id/pause-ai', async (req, res, next) => {
  try {
    const { paused } = req.body;
    const { data: deal } = await supabase.from('deals').select('user_id, ai_paused').eq('id', req.params.id).single();
    if (!deal || deal.user_id !== req.user.id) return res.status(404).json({ success: false, error: 'Deal not found' });

    const newState = paused !== undefined ? !!paused : !deal.ai_paused;
    const { data, error } = await supabase.from('deals').update({ ai_paused: newState, updated_at: new Date().toISOString() }).eq('id', req.params.id).eq('user_id', req.user.id).select().single();
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

// GET /api/deals/:id/velocity-score - compute Deal Velocity Score
router.get('/:id/velocity-score', async (req, res, next) => {
  try {
    const { data: deal } = await supabase.from('deals').select('*').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (!deal) return res.status(404).json({ success: false, error: 'Deal not found' });

    // Count AI touches (conversations/actions)
    const { count: touchCount } = await supabase.from('ai_command_log').select('*', { count: 'exact', head: true }).eq('deal_id', req.params.id);
    const daysSinceContact = deal.updated_at ? Math.floor((Date.now() - new Date(deal.updated_at).getTime()) / 86400000) : 30;

    // Weighted scoring formula
    const motivationScore   = (deal.motivation_score || 50) * 0.35;
    const recencyScore      = Math.max(0, 100 - (daysSinceContact * 3)) * 0.20;
    const touchScore        = Math.min(100, (touchCount || 0) * 10) * 0.15;
    const stageScore        = (['offer_sent','under_contract','sent_to_title'].includes(deal.status) ? 80 : 40) * 0.15;
    const buyerDepthScore   = 50 * 0.10; // default - update with buyer pool query if needed
    const complianceScore   = 70 * 0.05; // default

    const velocity = Math.min(100, Math.round(motivationScore + recencyScore + touchScore + stageScore + buyerDepthScore + complianceScore));

    // Persist velocity score
    await supabase.from('deals').update({ deal_velocity_score: velocity }).eq('id', req.params.id).eq('user_id', req.user.id);

    const label = velocity >= 70 ? 'High probability' : velocity >= 40 ? 'Needs attention' : 'At risk';
    const color = velocity >= 70 ? 'green' : velocity >= 40 ? 'yellow' : 'red';

    res.json({ success: true, velocity_score: velocity, label, color });
  } catch (err) { next(err); }
});

// GET /api/deals/:id/brief - Smart Deal Brief (Claude Sonnet 4.6)
router.get('/:id/brief', async (req, res, next) => {
  try {
    const { data: deal } = await supabase.from('deals').select('*, leads(first_name, last_name)').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (!deal) return res.status(404).json({ success: false, error: 'Deal not found' });

    const { data: lastLog } = await supabase.from('ai_command_log')
      .select('action_type, message_sent, created_at')
      .eq('deal_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const sellerName = deal.leads ? `${deal.leads.first_name || ''} ${deal.leads.last_name || ''}`.trim() || null : null;

    const { generateDealBrief } = require('../services/dualAIService');
    const result = await generateDealBrief({
      deal,
      lastAiAction: lastLog ? `${lastLog.action_type} - ${new Date(lastLog.created_at).toLocaleDateString()}` : null,
      sellerName,
      nextRecommendedStep: null,
    });

    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

// NOTE: POST /:id/start-buyer-campaign was removed. It was dead + broken:
//   • no UI component ever called it (only an unused api.js wrapper),
//   • its buyer matcher was inverted (.lte('max_price', price) matched buyers who
//     could NOT afford the deal),
//   • it returned a fake { campaign } object without starting anything.
// The real dispo path is the automatic buyer blast that fires when a deal moves to
// 'under_contract' (see the stage handler above → buyerDispoService.startBuyerBlast).

module.exports = router;
