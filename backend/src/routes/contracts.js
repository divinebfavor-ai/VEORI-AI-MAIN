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

// ─── Dropbox Sign endpoints (white-label) ────────────────────────────────────

// POST /api/contracts/create
router.post('/create', requireAuth, async (req, res, next) => {
  try {
    const { deal_id, contract_type } = req.body;
    if (!deal_id) return res.status(400).json({ success: false, error: 'deal_id required' });

    const { data: deal } = await supabase.from('deals').select('*, leads(*), buyers(*)')
      .eq('deal_id', deal_id).single();
    if (!deal || deal.operator_id !== req.user.id) return res.status(404).json({ success: false, error: 'Deal not found' });

    // Double-close requires transactional funding alert
    if (deal.deal_type === 'double_close') {
      await supabase.from('notifications').insert({
        operator_id: req.user.id,
        type: 'double_close_alert',
        title: 'Transactional Funding Required',
        message: `Deal at ${deal.property_address} is a double-close. Please confirm your funding source before proceeding.`,
        deal_id,
        is_read: false,
      });
    }

    // Get compliance disclosure for state
    const { generateComplianceDisclosure } = require('../services/dualAIService');
    const { CONTRACT_FOOTER } = require('../services/dropboxSignService');
    const disclosure = await generateComplianceDisclosure({
      state: deal.state,
      dealType: contract_type || deal.deal_type || 'assignment',
    }).catch(() => CONTRACT_FOOTER);

    // Store contract record
    const { data: contract, error } = await supabase.from('contracts').insert({
      deal_id,
      contract_type: contract_type || 'purchase_and_sale',
      signing_status: 'unsigned',
      compliance_disclosure: disclosure,
      created_at: new Date().toISOString(),
    }).select().single();
    if (error) throw error;

    await supabase.from('ai_command_log').insert({
      deal_id,
      action_type: 'contract_generated',
      message_sent: `${contract_type || 'PSA'} contract generated for ${deal.property_address}`,
      outcome: 'success',
      operator_id: req.user.id,
    });

    res.json({ success: true, contract, compliance_disclosure: disclosure });
  } catch (err) { next(err); }
});

// POST /api/contracts/start-signing-session
router.post('/start-signing-session', requireAuth, async (req, res, next) => {
  try {
    const { contract_id, seller_email, seller_name, buyer_email, buyer_name } = req.body;
    if (!contract_id) return res.status(400).json({ success: false, error: 'contract_id required' });

    const { data: contract } = await supabase.from('contracts').select('*, deals(property_address, state, operator_id)')
      .eq('contract_id', contract_id).single();
    if (!contract || contract.deals?.operator_id !== req.user.id) {
      return res.status(404).json({ success: false, error: 'Contract not found' });
    }

    const { createSignatureRequest } = require('../services/dropboxSignService');

    const signers = [];
    if (seller_email && seller_name) signers.push({ email: seller_email, name: seller_name });
    if (buyer_email && buyer_name) signers.push({ email: buyer_email, name: buyer_name });

    if (signers.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one signer (seller or buyer) required' });
    }

    let dsRequest = null;
    let signatureRequestId = null;
    try {
      dsRequest = await createSignatureRequest({
        contractId: contract_id,
        contractType: contract.contract_type,
        pdfUrl: contract.pdf_url || null,
        signers,
        title: `Veori AI — ${contract.contract_type} Agreement`,
      });
      signatureRequestId = dsRequest?.signature_request_id;
    } catch (dsErr) {
      console.error('[DropboxSign] API error:', dsErr.message);
    }

    await supabase.from('contracts').update({
      signing_status: 'sent',
      dropbox_sign_request_id: signatureRequestId || null,
      updated_at: new Date().toISOString(),
    }).eq('contract_id', contract_id);

    await supabase.from('ai_command_log').insert({
      deal_id: contract.deal_id,
      action_type: 'signing_session_started',
      message_sent: `Signing session started for ${contract.contract_type}`,
      outcome: 'sent',
      operator_id: req.user.id,
    });

    res.json({
      success: true,
      contract_id,
      signature_request_id: signatureRequestId,
      signing_status: 'sent',
      signers_count: signers.length,
    });
  } catch (err) { next(err); }
});

// POST /api/contracts/handle-sign-submission
router.post('/handle-sign-submission', async (req, res, next) => {
  try {
    const { signature_request_id, event_type } = req.body;

    // Dropbox Sign webhook payload
    if (event_type === 'signature_request_signed' || event_type === 'signature_request_all_signed') {
      const { data: contract } = await supabase.from('contracts')
        .select('contract_id, deal_id')
        .eq('dropbox_sign_request_id', signature_request_id)
        .single();

      if (contract) {
        const allSigned = event_type === 'signature_request_all_signed';
        await supabase.from('contracts').update({
          signing_status: allSigned ? 'fully_signed' : 'partially_signed',
          ...(allSigned ? { seller_signed_at: new Date().toISOString() } : {}),
          updated_at: new Date().toISOString(),
        }).eq('contract_id', contract.contract_id);

        if (allSigned && contract.deal_id) {
          await supabase.from('deals').update({
            stage: 'under_contract',
            stage_changed_at: new Date().toISOString(),
          }).eq('deal_id', contract.deal_id);

          await supabase.from('ai_command_log').insert({
            deal_id: contract.deal_id,
            action_type: 'contract_fully_signed',
            message_sent: 'All parties signed. Deal moved to Under Contract.',
            outcome: 'success',
          });
        }
      }
    }

    res.json({ success: true });
  } catch (err) { next(err); }
});

// GET /api/contracts/get-signed-contract/:contract_id
router.get('/get-signed-contract/:contract_id', requireAuth, async (req, res, next) => {
  try {
    const { data: contract, error } = await supabase.from('contracts')
      .select('*, deals(property_address, state, operator_id)')
      .eq('contract_id', req.params.contract_id)
      .single();
    if (error) throw error;
    if (!contract || contract.deals?.operator_id !== req.user.id) {
      return res.status(404).json({ success: false, error: 'Contract not found' });
    }

    // Try to get download URL from Dropbox Sign
    let download_url = contract.signed_pdf_url;
    if (!download_url && contract.dropbox_sign_request_id && contract.signing_status === 'fully_signed') {
      try {
        const { downloadSignedDocument } = require('../services/dropboxSignService');
        const dl = await downloadSignedDocument(contract.dropbox_sign_request_id);
        download_url = dl?.file_url || null;
        if (download_url) {
          await supabase.from('contracts').update({ signed_pdf_url: download_url }).eq('contract_id', contract.contract_id);
        }
      } catch {}
    }

    res.json({ success: true, contract: { ...contract, download_url } });
  } catch (err) { next(err); }
});

module.exports = router;
