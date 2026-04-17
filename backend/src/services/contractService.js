// ─── Contract Generation & Delivery Service ───────────────────────────────────
if (process.env.NODE_ENV !== 'production') require('dotenv').config();

/**
 * Generate a Purchase & Sale Agreement or Assignment Agreement
 * In production this would integrate with DocuSign/HelloSign API
 * For now generates text template and logs it
 */
async function generate(deal, type = 'psa') {
  const closingDate = deal.closing_date || getClosingDate(14);
  const lead = deal.leads || {};

  if (type === 'psa') {
    const contract = generatePSA({ deal, lead, closingDate });
    return { type: 'psa', content: contract, closingDate, status: 'generated' };
  }

  if (type === 'assignment') {
    const contract = generateAssignment({ deal, lead, closingDate });
    return { type: 'assignment', content: contract, closingDate, status: 'generated' };
  }

  throw new Error(`Unknown contract type: ${type}`);
}

/**
 * Send contract via SMS (DocuSign/HelloSign link)
 * Twilio SMS integration point
 */
async function send(deal, type, { phone, email } = {}) {
  const contractData = await generate(deal, type);

  // In production: upload to DocuSign, get signing URL, send via Twilio SMS
  // For now: log and return mock URL
  const signingUrl = `https://veori.ai/sign/${deal.id}/${type}?token=${Buffer.from(deal.id).toString('base64')}`;

  console.log(`[Contract] ${type.toUpperCase()} for ${deal.property_address} → ${phone || email}`);
  console.log(`[Contract] Signing URL: ${signingUrl}`);

  // TODO: Send SMS via Twilio
  // await twilioClient.messages.create({ body: `Please sign your contract: ${signingUrl}`, from: process.env.TWILIO_PHONE_NUMBER, to: phone });

  return { status: 'sent', signing_url: signingUrl, sent_to: phone || email };
}

function generatePSA({ deal, lead, closingDate }) {
  return `
PURCHASE AND SALE AGREEMENT

Property Address: ${deal.property_address}, ${deal.property_city}, ${deal.property_state}

SELLER: ${lead.first_name} ${lead.last_name}
BUYER: [Buyer Name] / Assignee

PURCHASE PRICE: $${deal.seller_agreed_price?.toLocaleString() || deal.offer_price?.toLocaleString()}
EARNEST MONEY DEPOSIT: $1,000 (non-refundable after inspection period)
CLOSING DATE: ${closingDate}
INSPECTION PERIOD: 14 days from acceptance

TERMS:
- Property sold AS-IS, WHERE-IS. No repairs or credits.
- Cash purchase — no financing contingency.
- Seller to provide clear title at closing.
- This agreement is assignable by Buyer without Seller consent.
- Buyer pays all closing costs.

ASSIGNMENT CLAUSE: Buyer reserves the right to assign this contract to any third party without Seller's approval. Seller's obligation to sell shall be to the ultimate assignee.

Accepted this date: ___________

SELLER SIGNATURE: ___________________________ Date: ___________
${lead.first_name} ${lead.last_name}

BUYER SIGNATURE: ___________________________ Date: ___________
Veori AI Acquisitions / Assignee

This is a simplified template. Consult a real estate attorney in your state.
`.trim();
}

function generateAssignment({ deal, lead, closingDate }) {
  return `
ASSIGNMENT OF PURCHASE AND SALE AGREEMENT

ASSIGNOR: [Your Name/Company]
ASSIGNEE: [Buyer Name]
PROPERTY: ${deal.property_address}, ${deal.property_city}, ${deal.property_state}

ORIGINAL CONTRACT DATE: ${new Date().toLocaleDateString()}
ORIGINAL PURCHASE PRICE: $${deal.seller_agreed_price?.toLocaleString() || deal.offer_price?.toLocaleString()}
BUYER/ASSIGNMENT PRICE: $${deal.buyer_price?.toLocaleString()}
ASSIGNMENT FEE: $${deal.assignment_fee?.toLocaleString() || ((deal.buyer_price || 0) - (deal.seller_agreed_price || deal.offer_price || 0)).toLocaleString()}

TERMS:
- Assignor assigns all rights and obligations under the original PSA to Assignee.
- Assignee accepts all terms and conditions of the original PSA.
- Assignment fee due at closing.
- Assignee has reviewed and accepted the original PSA.

ASSIGNOR SIGNATURE: ___________________________ Date: ___________

ASSIGNEE SIGNATURE: ___________________________ Date: ___________
${/* buyer name placeholder */ 'Buyer Name'}

Closing Date: ${closingDate}
`.trim();
}

function getClosingDate(daysOut = 14) {
  const d = new Date();
  d.setDate(d.getDate() + daysOut);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

module.exports = { generate, send };
