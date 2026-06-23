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

// ── helpers ────────────────────────────────────────────────────────────────
const money = n => (n == null || n === '' || Number.isNaN(Number(n)))
  ? null
  : `$${Number(n).toLocaleString('en-US')}`;

/**
 * Resolve which acquisition strategy a contract should reflect. ADDITIVE:
 * 'assignment' (the explicit contract type) always wins so the dispo contract
 * is unchanged. Otherwise prefer the deal_type, then the lead's resolved
 * strategy, defaulting to 'cash' (the byte-for-byte original PSA).
 */
function resolveContractStrategy(deal = {}, requestedType = 'psa') {
  if (normalizeType(requestedType) === 'assignment') return 'assignment';
  const lead = deal.leads || {};
  const candidate = String(
    deal.deal_type
    || lead.strategy_override
    || lead.detected_strategy
    || 'cash'
  ).toLowerCase();
  const creative = ['subject_to', 'seller_finance', 'lease_option', 'novation'];
  if (candidate === 'assignment') return 'cash'; // assignment as deal_type → seller-side PSA stays cash
  return creative.includes(candidate) ? candidate : 'cash';
}

/**
 * Fetch the operator's real contract identity from the users table (legal name,
 * entity, license, defaults). Falls back to safe blanks — never throws, so a
 * missing profile degrades to the prior hardcoded behaviour rather than failing.
 */
async function loadOperator(userId) {
  if (!userId) return {};
  try {
    const { data } = await supabase
      .from('users')
      .select('full_name, company_name, legal_name, entity_name, entity_type, buyer_name_on_contract, business_phone, business_email, re_license_number, re_license_state, earnest_money_default, inspection_period_default, closing_period_default, custom_contract_addendum')
      .eq('id', userId)
      .maybeSingle();
    return data || {};
  } catch {
    return {};
  }
}

function buyerNameFor(op = {}) {
  return op.buyer_name_on_contract
    || op.entity_name
    || op.company_name
    || op.legal_name
    || op.full_name
    || 'Veori AI Acquisitions';
}

/**
 * Validate the minimum fields a usable contract needs. Returns a list of
 * human-readable missing items (empty = ready). Generation can still proceed
 * (draft), but the route surfaces these so the operator fixes them.
 */
function validateContract(deal = {}, strategy = 'cash') {
  const lead = deal.leads || {};
  const missing = [];
  if (!deal.property_address) missing.push('property address');
  const sellerName = `${lead.first_name || ''} ${lead.last_name || ''}`.trim();
  if (!sellerName) missing.push('seller name');
  const price = deal.seller_agreed_price ?? deal.offer_price;
  if (price == null || Number(price) <= 0) missing.push('purchase price');
  const t = deal.strategy_terms || {};
  if (strategy === 'subject_to' && !(t.mortgage_balance || lead.mortgage_balance)) {
    missing.push('existing loan balance (subject-to)');
  }
  if (strategy === 'seller_finance' && t.rate == null && t.interest_rate == null) {
    missing.push('financing rate (seller finance)');
  }
  return missing;
}

function sigBlock(roleA, nameA, roleB, nameB) {
  return `
${roleA} SIGNATURE: ___________________________ Date: ___________
${nameA}

${roleB} SIGNATURE: ___________________________ Date: ___________
${nameB}`;
}

function generatePSA({ deal, lead, op = {}, closingDate }) {
  const buyer = buyerNameFor(op);
  const emd = op.earnest_money_default != null ? op.earnest_money_default : (deal.earnest_money_default || 1000);
  const inspection = op.inspection_period_default != null ? op.inspection_period_default : (deal.inspection_period_default || 14);
  return `
PURCHASE AND SALE AGREEMENT

Property Address: ${deal.property_address || ''}, ${deal.property_city || ''}, ${deal.property_state || ''}

SELLER: ${lead.first_name || ''} ${lead.last_name || ''}
BUYER: ${buyer} / Assignee

PURCHASE PRICE: ${money(deal.seller_agreed_price ?? deal.offer_price) || '$0'}
EARNEST MONEY DEPOSIT: ${money(emd)}
CLOSING DATE: ${closingDate}
INSPECTION PERIOD: ${inspection} days from acceptance

TERMS:
- Property sold AS-IS, WHERE-IS. No repairs or credits.
- Cash purchase unless otherwise agreed in writing.
- Seller to provide clear title at closing.
- Buyer may assign this agreement where permitted by law.
- Closing costs allocated per final settlement statement.

NON-CIRCUMVENTION:
- This Agreement and Buyer's rights herein may be assigned by Buyer. Any
  assignee, prospective assignee, or party introduced to this property or to
  Seller by Buyer is bound by this non-circumvention term as a condition of any
  such introduction.
- No such party shall contact, negotiate with, or contract directly or
  indirectly with Seller to acquire this property outside of this Agreement or
  an assignment of it. This obligation survives for twenty-four (24) months.
- A party who circumvents Buyer to acquire the property shall owe Buyer the
  assignment fee that would have been due, as liquidated damages, plus
  reasonable attorneys' fees and costs of enforcement.

Accepted this date: ___________

SELLER SIGNATURE: ___________________________ Date: ___________
${lead.first_name || ''} ${lead.last_name || ''}

BUYER SIGNATURE: ___________________________ Date: ___________
${buyer}
${op.custom_contract_addendum ? `\nADDENDUM:\n${op.custom_contract_addendum}\n` : ''}
This is a simplified operating template and should be reviewed for state-specific compliance.
`.trim();
}

function generateAssignment({ deal, lead, op = {}, buyer, closingDate }) {
  const assignor = buyerNameFor(op);
  const assignmentFee = deal.assignment_fee || Math.max(0, (deal.buyer_price || 0) - (deal.seller_agreed_price || deal.offer_price || 0));
  return `
ASSIGNMENT OF PURCHASE AND SALE AGREEMENT

ASSIGNOR: ${assignor}
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

NON-CIRCUMVENTION:
- The Seller, the property, and this transaction were sourced and procured by
  Assignor. Assignee agrees NOT to circumvent Assignor by contacting,
  negotiating with, or contracting directly or indirectly with the Original
  Seller (or any agent, affiliate, relative, entity, or successor of the
  Seller) to acquire this property outside of this Agreement.
- This obligation survives termination or expiration of this Agreement for a
  period of twenty-four (24) months.
- If Assignee acquires the property (or any interest in it) by circumventing
  Assignor, Assignee shall owe Assignor the full Assignment Fee stated above as
  liquidated damages, plus Assignor's reasonable attorneys' fees and costs of
  enforcement. The parties agree this fee is a fair estimate of Assignor's
  damages and is not a penalty.
- Assignee shall keep the Seller's identity and contact information confidential
  and shall not disclose them to any third party for the purpose of acquiring
  this property apart from this Agreement.

ASSIGNOR SIGNATURE: ___________________________ Date: ___________
${assignor}

ASSIGNEE SIGNATURE: ___________________________ Date: ___________
${buyer?.name || 'Buyer Name'}
`.trim();
}

// ── Creative-finance contract templates (strategy-aware) ─────────────────────
// Each reads structured terms from deal.strategy_terms (falling back to lead
// signals) and renders the right legal framing. All degrade to blanks when an
// input is missing — never throw.

function generateSubjectTo({ deal, lead, op = {}, closingDate }) {
  const buyer = buyerNameFor(op);
  const t = deal.strategy_terms || {};
  const loanBal = t.mortgage_balance ?? lead.mortgage_balance;
  const arrears = t.arrears_amount ?? lead.arrears_amount;
  const monthly = t.est_monthly_payment ?? lead.est_monthly_payment;
  const rate = t.interest_rate ?? lead.interest_rate;
  const cashToSeller = t.cash_to_seller;
  const price = deal.seller_agreed_price ?? deal.offer_price;
  return `
PURCHASE AGREEMENT — SUBJECT TO EXISTING FINANCING

Property Address: ${deal.property_address || ''}, ${deal.property_city || ''}, ${deal.property_state || ''}

SELLER: ${lead.first_name || ''} ${lead.last_name || ''}
BUYER: ${buyer} / Assignee

PURCHASE PRICE: ${money(price) || '$0'}
ACQUISITION STRUCTURE: Buyer takes title SUBJECT TO the existing loan(s) of record, which remain in place.

EXISTING FINANCING TAKEN OVER:
- Approx. existing loan balance: ${money(loanBal) || '____________'}
- Estimated monthly payment (PITI): ${money(monthly) || '____________'}
- Note interest rate: ${rate != null ? `${rate}%` : '________%'}
- Arrears to be reinstated by Buyer at/near closing: ${money(arrears) || '$0'}
- Cash to Seller at closing: ${money(cashToSeller) || '____________'}

TERMS:
- Buyer takes title SUBJECT TO the existing mortgage(s); the loan(s) are NOT assumed and remain in the name of record.
- Buyer agrees to make the monthly payments on the existing loan(s) directly or via a designated servicer beginning at closing.
- Seller authorizes Buyer (or Buyer's servicer) to communicate with the lender and access loan information (limited authorization to be executed at closing).
- Buyer acknowledges the lender's due-on-sale right; Buyer accepts this risk.
- Property conveyed AS-IS, WHERE-IS via warranty deed; Seller to deliver marketable title.
- Buyer may assign this Agreement where permitted by law.
- CLOSING DATE: ${closingDate}

DISCLOSURE: Seller understands the existing loan(s) remain in Seller's name until paid off or refinanced, and that the loan balance affects Seller's credit until then. Both parties are advised to seek independent legal and tax counsel.

NON-CIRCUMVENTION:
- This Agreement and Buyer's rights herein may be assigned by Buyer. Any party introduced to this property or Seller by Buyer is bound by this term.
- No such party shall contract directly with Seller outside this Agreement for twenty-four (24) months. Circumvention = liquidated damages equal to Buyer's intended fee plus attorneys' fees.
${sigBlock('SELLER', `${lead.first_name || ''} ${lead.last_name || ''}`, 'BUYER', buyer)}
${op.custom_contract_addendum ? `\nADDENDUM:\n${op.custom_contract_addendum}\n` : ''}
This is a simplified operating template and should be reviewed for state-specific compliance.
`.trim();
}

function generateSellerFinance({ deal, lead, op = {}, closingDate }) {
  const buyer = buyerNameFor(op);
  const t = deal.strategy_terms || {};
  const price = t.purchase_price ?? deal.seller_agreed_price ?? deal.offer_price;
  const down = t.down_payment;
  const downPct = t.down_percent;
  const rate = t.rate ?? t.interest_rate;
  const term = t.term_years;
  const balloon = t.balloon_years;
  const monthly = t.monthly_payment;
  return `
PURCHASE AGREEMENT WITH SELLER FINANCING (OWNER CARRY)

Property Address: ${deal.property_address || ''}, ${deal.property_city || ''}, ${deal.property_state || ''}

SELLER (Lender): ${lead.first_name || ''} ${lead.last_name || ''}
BUYER (Borrower): ${buyer} / Assignee

PURCHASE PRICE: ${money(price) || '$0'}
SELLER FINANCING TERMS:
- Down payment: ${money(down) || '____________'}${downPct != null ? ` (${downPct}%)` : ''}
- Amount financed by Seller: ${money(price != null && down != null ? Number(price) - Number(down) : null) || '____________'}
- Interest rate: ${rate != null ? `${rate}%` : '________%'} per annum
- Amortization term: ${term != null ? `${term} years` : '______ years'}
- Estimated monthly payment (P&I): ${money(monthly) || '____________'}
- Balloon: ${balloon != null ? `balance due in full at ${balloon} years` : 'none / as agreed'}

TERMS:
- Seller agrees to carry a promissory note secured by a mortgage/deed of trust on the Property for the financed amount above.
- Buyer shall execute a promissory note and security instrument at closing reflecting the terms herein.
- Payments are due monthly beginning thirty (30) days after closing; late charges and default terms per the note.
- Buyer may prepay without penalty unless otherwise stated in the note.
- Property conveyed AS-IS, WHERE-IS; Seller to deliver marketable title subject to the security instrument.
- Buyer may assign this Agreement where permitted by law.
- CLOSING DATE: ${closingDate}

DISCLOSURE: This transaction creates an owner-financed mortgage. Both parties are advised to seek independent legal and tax counsel and to comply with applicable lending/disclosure laws (including SAFE Act / Dodd-Frank where applicable).

NON-CIRCUMVENTION:
- This Agreement may be assigned by Buyer. Any party introduced to this property or Seller by Buyer is bound by this term for twenty-four (24) months; circumvention = liquidated damages plus attorneys' fees.
${sigBlock('SELLER', `${lead.first_name || ''} ${lead.last_name || ''}`, 'BUYER', buyer)}
${op.custom_contract_addendum ? `\nADDENDUM:\n${op.custom_contract_addendum}\n` : ''}
This is a simplified operating template and should be reviewed for state-specific compliance.
`.trim();
}

function generateLeaseOption({ deal, lead, op = {}, closingDate }) {
  const buyer = buyerNameFor(op);
  const t = deal.strategy_terms || {};
  const optionPrice = t.option_price ?? deal.seller_agreed_price ?? deal.offer_price;
  const optionFee = t.option_fee;
  const leaseMonthly = t.lease_monthly ?? t.market_rent;
  const optionMonths = t.option_months;
  return `
RESIDENTIAL LEASE WITH OPTION TO PURCHASE

Property Address: ${deal.property_address || ''}, ${deal.property_city || ''}, ${deal.property_state || ''}

OWNER/OPTIONOR: ${lead.first_name || ''} ${lead.last_name || ''}
TENANT/OPTIONEE: ${buyer} / Assignee

OPTION TERMS:
- Option (future purchase) price: ${money(optionPrice) || '____________'}
- Non-refundable option fee (paid up front): ${money(optionFee) || '____________'}
- Monthly lease payment: ${money(leaseMonthly) || '____________'}
- Option/lease term: ${optionMonths != null ? `${optionMonths} months` : '______ months'}

TERMS:
- Optionor grants Optionee the EXCLUSIVE OPTION to purchase the Property at the Option Price during the option term.
- The option fee is non-refundable and ${'applied'} toward the purchase price only if the option is exercised, as agreed.
- During the term, Optionee leases the Property and pays the monthly lease payment; a portion may be credited toward purchase if stated in an addendum.
- Optionee may exercise the option by written notice during the term, after which the parties close per a standard purchase agreement.
- Property leased AS-IS; maintenance responsibilities per the lease addendum.
- This Option may be assigned by Optionee where permitted by law.
- TARGET CLOSING (if exercised): ${closingDate}

DISCLOSURE: This is a lease combined with an option to purchase. Both parties are advised to seek independent legal counsel; option consideration and rent credits affect the final purchase.

NON-CIRCUMVENTION:
- This Agreement may be assigned by Optionee. Any party introduced to this property or Owner by Optionee is bound for twenty-four (24) months; circumvention = liquidated damages plus attorneys' fees.
${sigBlock('OWNER/OPTIONOR', `${lead.first_name || ''} ${lead.last_name || ''}`, 'TENANT/OPTIONEE', buyer)}
${op.custom_contract_addendum ? `\nADDENDUM:\n${op.custom_contract_addendum}\n` : ''}
This is a simplified operating template and should be reviewed for state-specific compliance.
`.trim();
}

function generateNovation({ deal, lead, op = {}, closingDate }) {
  const buyer = buyerNameFor(op);
  const t = deal.strategy_terms || {};
  const acquisition = t.acquisition_price ?? t.list_price ?? deal.seller_agreed_price ?? deal.offer_price;
  const resale = t.target_resale ?? t.resale_price ?? deal.arv;
  const reno = t.repairs ?? t.reno_estimate;
  return `
NOVATION AGREEMENT (PURCHASE + AGREEMENT TO RESELL)

Property Address: ${deal.property_address || ''}, ${deal.property_city || ''}, ${deal.property_state || ''}

SELLER: ${lead.first_name || ''} ${lead.last_name || ''}
BUYER/NOVATOR: ${buyer} / Assignee

PRICING:
- Agreed acquisition price to Seller: ${money(acquisition) || '____________'}
- Intended retail resale price: ${money(resale) || '____________'}
- Planned light reno / make-ready: ${money(reno) || '$0'}

TERMS:
- Seller and Buyer agree Buyer will market and re-sell ("novate") the Property to an end buyer at or near retail; Seller's net proceeds equal the Agreed Acquisition Price above.
- Buyer is authorized, at Buyer's expense, to make light cosmetic improvements and to list/market the Property to a retail buyer prior to closing.
- Upon a retail sale, the original agreement is novated (replaced) by a new agreement between Seller and the end buyer; Buyer's profit is the spread above Seller's net, less reno, commission, and closing costs.
- Seller agrees to cooperate with showings, the retail listing, and a single closing that nets Seller the Agreed Acquisition Price.
- Property conveyed AS-IS by Seller as to latent defects; make-ready performed by Buyer.
- CLOSING DATE: ${closingDate}

DISCLOSURE: This is a novation/resale structure. Seller understands Buyer intends to resell at a higher price and that Buyer retains the spread. Both parties are advised to seek independent legal counsel.

NON-CIRCUMVENTION:
- This Agreement may be assigned/novated by Buyer. Any party introduced to this property or Seller by Buyer is bound for twenty-four (24) months; circumvention = liquidated damages plus attorneys' fees.
${sigBlock('SELLER', `${lead.first_name || ''} ${lead.last_name || ''}`, 'BUYER/NOVATOR', buyer)}
${op.custom_contract_addendum ? `\nADDENDUM:\n${op.custom_contract_addendum}\n` : ''}
This is a simplified operating template and should be reviewed for state-specific compliance.
`.trim();
}

async function generate(deal, type = 'psa', { userId } = {}) {
  const normalizedType = normalizeType(type);
  const closingDate = deal.closing_date || getClosingDate(14);
  const lead = deal.leads || {};
  const buyer = deal.buyers || null;
  const op = await loadOperator(userId || deal.user_id);
  const strategy = resolveContractStrategy(deal, normalizedType);
  const missing = validateContract(deal, strategy);

  let content;
  if (normalizedType === 'assignment') {
    content = generateAssignment({ deal, lead, op, buyer, closingDate });
  } else {
    switch (strategy) {
      case 'subject_to':     content = generateSubjectTo({ deal, lead, op, closingDate }); break;
      case 'seller_finance': content = generateSellerFinance({ deal, lead, op, closingDate }); break;
      case 'lease_option':   content = generateLeaseOption({ deal, lead, op, closingDate }); break;
      case 'novation':       content = generateNovation({ deal, lead, op, closingDate }); break;
      default:               content = generatePSA({ deal, lead, op, closingDate });
    }
  }

  const titleMap = {
    assignment: 'Assignment Agreement',
    subject_to: 'Purchase Agreement — Subject To',
    seller_finance: 'Purchase Agreement — Seller Financing',
    lease_option: 'Lease With Option to Purchase',
    novation: 'Novation Agreement',
    cash: 'Purchase & Sale Agreement',
  };
  const docTitle = normalizedType === 'assignment' ? titleMap.assignment : (titleMap[strategy] || titleMap.cash);

  return { type: normalizedType, strategy, doc_title: docTitle, content, closingDate, missing, ready: missing.length === 0, status: 'generated' };
}

/**
 * Render a contract to a downloadable PDF buffer using PDFKit (already a project
 * dependency — see routes/dealPackage.js). Monospaced body so the signature
 * underscores and columns line up like the on-screen text.
 */
function renderPdf({ content, doc_title = 'Contract' }) {
  const PDFDocument = require('pdfkit');
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 54, size: 'LETTER' });
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.font('Helvetica-Bold').fontSize(14).text(doc_title, { align: 'center' });
      doc.moveDown(1);
      doc.font('Courier').fontSize(9.5).text(content, { align: 'left', lineGap: 1.5 });
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
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
  const generated = await generate(deal, type, { userId });
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
  renderPdf,
  send,
  createSigningPackage,
  getSigningSession,
  submitSignature,
};
