const express = require('express');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const contractService = require('../services/contractService');
const { logActivity } = require('../services/dealActivityService');

const router = express.Router();

router.post('/create_contract', requireAuth, async (req, res, next) => {
  try {
    const { deal_id, type = 'psa' } = req.body;
    if (!deal_id) return res.status(400).json({ success: false, error: 'deal_id required' });

    const { data: deal, error } = await supabase
      .from('deals')
      .select('*, leads(*), buyers(*)')
      .eq('id', deal_id)
      .eq('user_id', req.user.id)
      .single();
    if (error) throw error;
    if (!deal) return res.status(404).json({ success: false, error: 'Deal not found' });

    const generated = await contractService.generate(deal, type);
    const signing = await contractService.createSigningPackage(deal, type, { userId: req.user.id });

    await logActivity({
      userId: req.user.id,
      dealId: deal.id,
      leadId: deal.lead_id,
      activityType: 'contract_created',
      message: `${type.toUpperCase()} contract created`,
      metadata: { contract_id: signing.contract.id, contract_type: type },
    });

    res.json({ success: true, data: { ...generated, ...signing } });
  } catch (err) {
    if (err instanceof contractService.ContractError) return res.status(err.status).json({ success: false, error: err.message });
    next(err);
  }
});

router.post('/start_signing_session', requireAuth, async (req, res, next) => {
  try {
    const { deal_id, type = 'psa' } = req.body;
    if (!deal_id) return res.status(400).json({ success: false, error: 'deal_id required' });

    const { data: deal, error } = await supabase
      .from('deals')
      .select('*, leads(*), buyers(*)')
      .eq('id', deal_id)
      .eq('user_id', req.user.id)
      .single();
    if (error) throw error;
    if (!deal) return res.status(404).json({ success: false, error: 'Deal not found' });

    const signing = await contractService.createSigningPackage(deal, type, { userId: req.user.id });
    await logActivity({
      userId: req.user.id,
      dealId: deal.id,
      leadId: deal.lead_id,
      activityType: 'signing_session_started',
      message: `${type.toUpperCase()} signing session started`,
      metadata: { contract_id: signing.contract.id },
    });
    res.json({ success: true, data: signing });
  } catch (err) {
    if (err instanceof contractService.ContractError) return res.status(err.status).json({ success: false, error: err.message });
    next(err);
  }
});

router.get('/session/:token', async (req, res, next) => {
  try {
    const token = String(req.params.token || '');
    if (!/^[0-9a-f-]{36}$/i.test(token)) return res.status(404).json({ success: false, error: 'Signing session not found' });
    const signer = await contractService.getSigningSession(token);
    if (!signer) return res.status(404).json({ success: false, error: 'Signing session not found' });
    res.json({
      success: true,
      data: {
        signer: {
          id: signer.id,
          name: signer.name,
          signer_role: signer.signer_role,
          status: signer.status,
        },
        contract: {
          id: signer.contracts.id,
          contract_type: signer.contracts.contract_type,
          content: signer.contracts.content,
          signing_status: signer.contracts.signing_status,
          closing_date: signer.contracts.closing_date,
        },
      },
    });
  } catch (err) { next(err); }
});

router.post('/handle_sign_submission/:token', async (req, res, next) => {
  try {
    const { printed_name, signature_text } = req.body;
    if (typeof printed_name !== 'string' || typeof signature_text !== 'string' || !printed_name.trim() || !signature_text.trim()) {
      return res.status(400).json({ success: false, error: 'printed_name and signature_text required' });
    }
    if (printed_name.length > 200 || signature_text.length > 200) {
      return res.status(400).json({ success: false, error: 'Name and signature must be 200 characters or fewer' });
    }
    if (!/^[0-9a-f-]{36}$/i.test(String(req.params.token || ''))) {
      return res.status(404).json({ success: false, error: 'Signing session not found' });
    }

    const result = await contractService.submitSignature(req.params.token, {
      printedName: printed_name.trim(),
      signatureText: signature_text.trim(),
    });
    if (result.already_signed) return res.json({ success: true, data: result });

    const { data: contract } = await supabase
      .from('contracts')
      .select('deal_id, user_id, contract_type')
      .eq('id', result.contract.id)
      .single();

    if (contract?.deal_id && contract?.user_id) {
      await logActivity({
        userId: contract.user_id,
        dealId: contract.deal_id,
        activityType: 'contract_signed',
        message: `${result.signer.signer_role} signed contract`,
        metadata: { contract_id: result.contract.id, fully_signed: result.fully_signed },
      });

      if (result.fully_signed) {
        const { error: signedErr } = await supabase
          .from('deals')
          .update({ contract_status: 'signed', updated_at: new Date().toISOString() })
          .eq('id', contract.deal_id)
          .eq('user_id', contract.user_id);
        if (signedErr) console.error(`[Contracts] marking deal ${contract.deal_id} signed failed:`, signedErr.message);

        // A fully signed PURCHASE contract (psa, with the seller) puts the deal under
        // contract, which starts buyer outreach and the title hand-off. A signed
        // assignment (with the buyer) must not restart buyer outreach. Only a deal
        // that hasn't reached under_contract is moved - never pulled back.
        if (contract.contract_type === 'psa') try {
          const { changeDealStage, STAGE_KEYS } = require('../services/dealStageService');
          const { data: dealRow } = await supabase.from('deals').select('status')
            .eq('id', contract.deal_id).eq('user_id', contract.user_id).maybeSingle();
          const idx = STAGE_KEYS.indexOf(dealRow?.status);
          const contractIdx = STAGE_KEYS.indexOf('under_contract');
          if (dealRow && dealRow.status !== 'lost' && (idx === -1 || idx < contractIdx)) {
            await changeDealStage({
              dealId: contract.deal_id, userId: contract.user_id, stage: 'under_contract',
              actor: 'system', reason: 'contract fully signed',
            });
          }
        } catch (e) {
          console.error(`[Contracts] moving deal ${contract.deal_id} under contract failed:`, e.message);
        }
      }
    }

    res.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof contractService.ContractError) return res.status(err.status).json({ success: false, error: err.message });
    next(err);
  }
});

router.get('/get_signed_contract/:id', requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('contracts')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'Contract not found' });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// NOTE: The legacy Dropbox Sign endpoints (/create, /start-signing-session,
// /handle-sign-submission, /get-signed-contract/:contract_id) were removed.
// They queried columns that do not exist in the schema (contract_id,
// operator_id, dropbox_sign_request_id), so every call 404'd, and the webhook
// accepted unauthenticated payloads. The native signing flow above
// (/create_contract, /start_signing_session, /session/:token,
// /handle_sign_submission/:token, /get_signed_contract/:id) is the live path
// and is what the frontend uses.

module.exports = router;
