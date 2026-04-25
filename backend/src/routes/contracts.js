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
  } catch (err) { next(err); }
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
      metadata: { contract_id: signing.contract.id, signing_url: signing.primary_signing_url },
    });
    res.json({ success: true, data: signing });
  } catch (err) { next(err); }
});

router.get('/session/:token', async (req, res, next) => {
  try {
    const signer = await contractService.getSigningSession(req.params.token);
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
    if (!printed_name || !signature_text) {
      return res.status(400).json({ success: false, error: 'printed_name and signature_text required' });
    }

    const result = await contractService.submitSignature(req.params.token, {
      printedName: printed_name,
      signatureText: signature_text,
    });

    const { data: contract } = await supabase
      .from('contracts')
      .select('deal_id, user_id')
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
        await supabase
          .from('deals')
          .update({
            contract_status: 'signed',
            status: 'under_contract',
            updated_at: new Date().toISOString(),
          })
          .eq('id', contract.deal_id)
          .eq('user_id', contract.user_id);
      }
    }

    res.json({ success: true, data: result });
  } catch (err) { next(err); }
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

module.exports = router;
