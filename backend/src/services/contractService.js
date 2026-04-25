const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');

function getFrontendBaseUrl() {
  return process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:5173';
}

function normalizeType(type = 'psa') {
  return ['psa', 'assignment'].includes(type) ? type : 'psa';
}

function getClosingDate(daysOut = 14) {
  const d = new Date();
  d.setDate(d.getDate() + daysOut);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function generatePSA({ deal, lead, closingDate }) {
  return `
PURCHASE AND SALE AGREEMENT

Property Address: ${deal.property_address}, ${deal.property_city}, ${deal.property_state}

SELLER: ${lead.first_name || ''} ${lead.last_name || ''}
BUYER: ${deal.operator_name || 'Veori AI Acquisitions'} / Assignee

PURCHASE PRICE: $${deal.seller_agreed_price?.toLocaleString() || deal.offer_price?.toLocaleString() || '0'}
EARNEST MONEY DEPOSIT: $${Number(deal.earnest_money_default || 1000).toLocaleString()}
CLOSING DATE: ${closingDate}
INSPECTION PERIOD: ${deal.inspection_period_default || 14} days from acceptance

TERMS:
- Property sold AS-IS, WHERE-IS. No repairs or credits.
- Cash purchase unless otherwise agreed in writing.
- Seller to provide clear title at closing.
- Buyer may assign this agreement where permitted by law.
- Closing costs allocated per final settlement statement.

Accepted this date: ___________

SELLER SIGNATURE: ___________________________ Date: ___________
${lead.first_name || ''} ${lead.last_name || ''}

BUYER SIGNATURE: ___________________________ Date: ___________
${deal.operator_name || 'Veori AI Acquisitions'}

This is a simplified operating template and should be reviewed for state-specific compliance.
`.trim();
}

function generateAssignment({ deal, lead, buyer, closingDate }) {
  const assignmentFee = deal.assignment_fee || Math.max(0, (deal.buyer_price || 0) - (deal.seller_agreed_price || deal.offer_price || 0));
  return `
ASSIGNMENT OF PURCHASE AND SALE AGREEMENT

ASSIGNOR: ${deal.operator_name || 'Veori AI Acquisitions'}
ASSIGNEE: ${buyer?.name || 'Buyer Name'}
PROPERTY: ${deal.property_address}, ${deal.property_city}, ${deal.property_state}

ORIGINAL SELLER: ${lead.first_name || ''} ${lead.last_name || ''}
ORIGINAL PURCHASE PRICE: $${deal.seller_agreed_price?.toLocaleString() || deal.offer_price?.toLocaleString() || '0'}
BUYER / ASSIGNMENT PRICE: $${deal.buyer_price?.toLocaleString() || '0'}
ASSIGNMENT FEE: $${Number(assignmentFee || 0).toLocaleString()}
CLOSING DATE: ${closingDate}

TERMS:
- Assignor transfers all rights under the original purchase agreement to Assignee.
- Assignee accepts the original purchase agreement and all attached addenda.
- Assignment fee is due at closing.
- Assignee acknowledges review of the underlying purchase contract.

ASSIGNOR SIGNATURE: ___________________________ Date: ___________
${deal.operator_name || 'Veori AI Acquisitions'}

ASSIGNEE SIGNATURE: ___________________________ Date: ___________
${buyer?.name || 'Buyer Name'}
`.trim();
}

async function generate(deal, type = 'psa') {
  const normalizedType = normalizeType(type);
  const closingDate = deal.closing_date || getClosingDate(14);
  const lead = deal.leads || {};
  const buyer = deal.buyers || null;

  const content = normalizedType === 'assignment'
    ? generateAssignment({ deal, lead, buyer, closingDate })
    : generatePSA({ deal, lead, closingDate });

  return { type: normalizedType, content, closingDate, status: 'generated' };
}

async function upsertContractRecord({ deal, type, content, closingDate, userId }) {
  const normalizedType = normalizeType(type);
  const { data: existing } = await supabase
    .from('contracts')
    .select('*')
    .eq('user_id', userId)
    .eq('deal_id', deal.id)
    .eq('contract_type', normalizedType)
    .maybeSingle();

  const payload = {
    user_id: userId,
    deal_id: deal.id,
    contract_type: normalizedType,
    content,
    signing_status: 'draft',
    closing_date: deal.closing_date || closingDate || null,
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    const { data, error } = await supabase
      .from('contracts')
      .update(payload)
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('contracts')
    .insert({
      id: uuidv4(),
      ...payload,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function replaceSigners(contractId, signers = []) {
  const { error: deleteError } = await supabase
    .from('contract_signers')
    .delete()
    .eq('contract_id', contractId);
  if (deleteError) throw deleteError;

  const sanitized = signers
    .filter((signer) => signer && signer.name)
    .map((signer) => ({
      id: uuidv4(),
      contract_id: contractId,
      signer_role: signer.role,
      name: signer.name,
      email: signer.email || null,
      phone: signer.phone || null,
      access_token: uuidv4(),
      status: 'pending',
    }));

  if (sanitized.length === 0) return [];

  const { data, error } = await supabase
    .from('contract_signers')
    .insert(sanitized)
    .select();
  if (error) throw error;
  return data;
}

function buildSigningUrl(token) {
  return `${getFrontendBaseUrl()}/sign/${token}`;
}

async function createSigningPackage(deal, type, { userId }) {
  const generated = await generate(deal, type);
  const contract = await upsertContractRecord({
    deal,
    type: generated.type,
    content: generated.content,
    closingDate: generated.closingDate,
    userId,
  });

  const lead = deal.leads || {};
  const buyer = deal.buyers || {};
  const signers = generated.type === 'assignment'
    ? [
        { role: 'assignor', name: deal.operator_name || 'Veori AI Acquisitions' },
        { role: 'buyer', name: buyer.name || 'Buyer', email: buyer.email, phone: buyer.phone },
      ]
    : [
        { role: 'seller', name: `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Seller', email: lead.email, phone: lead.phone },
        { role: 'buyer', name: deal.operator_name || 'Veori AI Acquisitions' },
      ];

  const signerRows = await replaceSigners(contract.id, signers);
  const publicSigningUrl = signerRows[0]?.access_token ? buildSigningUrl(signerRows[0].access_token) : null;

  const { data: updatedContract, error: updateError } = await supabase
    .from('contracts')
    .update({
      signing_status: 'sent',
      signing_url: publicSigningUrl,
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', contract.id)
    .select()
    .single();
  if (updateError) throw updateError;

  return {
    contract: updatedContract,
    signers: signerRows.map((signer) => ({
      ...signer,
      signing_url: buildSigningUrl(signer.access_token),
    })),
    primary_signing_url: publicSigningUrl,
  };
}

async function send(deal, type, { phone, email, userId } = {}) {
  const signing = await createSigningPackage(deal, type, { userId });
  console.log(`[Contract] ${type.toUpperCase()} for ${deal.property_address} → ${phone || email || 'signer link created'}`);
  console.log(`[Contract] Signing URL: ${signing.primary_signing_url}`);
  return {
    status: 'sent',
    signing_url: signing.primary_signing_url,
    sent_to: phone || email || null,
    contract_id: signing.contract.id,
    signers: signing.signers,
  };
}

async function getSigningSession(token) {
  const { data: signer, error: signerError } = await supabase
    .from('contract_signers')
    .select('*, contracts(*)')
    .eq('access_token', token)
    .single();
  if (signerError) throw signerError;
  if (!signer) return null;

  const { error: touchError } = await supabase
    .from('contract_signers')
    .update({ accessed_at: new Date().toISOString() })
    .eq('id', signer.id);
  if (touchError) throw touchError;

  return signer;
}

async function submitSignature(token, { printedName, signatureText }) {
  const signer = await getSigningSession(token);
  if (!signer) throw new Error('Signing session not found');
  if (signer.status === 'signed') return signer;

  const signedAt = new Date().toISOString();
  const { data: updatedSigner, error: signerError } = await supabase
    .from('contract_signers')
    .update({
      printed_name: printedName,
      signature_text: signatureText,
      status: 'signed',
      signed_at: signedAt,
    })
    .eq('id', signer.id)
    .select()
    .single();
  if (signerError) throw signerError;

  const { data: allSigners, error: signersError } = await supabase
    .from('contract_signers')
    .select('*')
    .eq('contract_id', signer.contract_id);
  if (signersError) throw signersError;

  const fullySigned = (allSigners || []).every((row) => row.status === 'signed');
  const { data: contract, error: contractError } = await supabase
    .from('contracts')
    .update({
      signing_status: fullySigned ? 'fully_signed' : 'partially_signed',
      signed_summary: (allSigners || []).map((row) => ({
        signer_role: row.signer_role,
        name: row.printed_name || row.name,
        signed_at: row.id === updatedSigner.id ? signedAt : row.signed_at,
        status: row.id === updatedSigner.id ? 'signed' : row.status,
      })),
      fully_signed_at: fullySigned ? signedAt : null,
      updated_at: signedAt,
    })
    .eq('id', signer.contract_id)
    .select()
    .single();
  if (contractError) throw contractError;

  return { signer: updatedSigner, contract, fully_signed: fullySigned };
}

module.exports = {
  generate,
  send,
  createSigningPackage,
  getSigningSession,
  submitSignature,
};
