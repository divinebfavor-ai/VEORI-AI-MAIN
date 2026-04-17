// ─── Contract Generation & Delivery via Vapi SMS ──────────────────────────────
const vapiService = require('./vapiService');

async function generate(deal, type = 'psa') {
  const closingDate = deal.closing_date || getClosingDate(14);
  const lead = deal.leads || {};
  const content = type === 'psa' ? generatePSA({ deal, lead, closingDate }) : generateAssignment({ deal, lead, closingDate });
  return { type, content, closingDate, status: 'generated' };
}

async function send(deal, type, { phone, email, vapiPhoneNumberId } = {}) {
  const { content } = await generate(deal, type);
  const signingUrl = `https://sign.veori.net/${deal.id}/${type}`;

  console.log(`[Contract] ${type.toUpperCase()} → ${phone || email} | ${signingUrl}`);

  // Send via Vapi native SMS — no Twilio
  if (phone) {
    try {
      await vapiService.sendContractSMS({
        to: phone,
        signingUrl,
        sellerName: `${deal.leads?.first_name || 'there'}`,
        propertyAddress: deal.property_address,
        vapiPhoneNumberId,
      });
      console.log(`[Contract] SMS sent via Vapi to ${phone}`);
    } catch (e) {
      console.error('[Contract] SMS failed:', e.message);
    }
  }

  return { status: 'sent', signing_url: signingUrl, sent_to: phone || email };
}

function generatePSA({ deal, lead, closingDate }) {
  return `PURCHASE AND SALE AGREEMENT

Property: ${deal.property_address}, ${deal.property_city}, ${deal.property_state}
Seller: ${lead.first_name} ${lead.last_name}
Purchase Price: $${(deal.seller_agreed_price || deal.offer_price)?.toLocaleString()}
Earnest Money: $1,000 (non-refundable after inspection period)
Closing Date: ${closingDate}

TERMS: Property sold AS-IS. Cash purchase — no financing contingency. Seller provides clear title. This agreement is assignable by Buyer without Seller consent. Buyer pays all closing costs.

ASSIGNMENT CLAUSE: Buyer may assign this contract to any third party without Seller approval.

SELLER: ___________________________ Date: ___________
${lead.first_name} ${lead.last_name}

BUYER: ___________________________ Date: ___________
Veori AI Acquisitions / Assignee`.trim();
}

function generateAssignment({ deal, lead, closingDate }) {
  const fee = deal.assignment_fee || ((deal.buyer_price || 0) - (deal.seller_agreed_price || deal.offer_price || 0));
  return `ASSIGNMENT OF PURCHASE AND SALE AGREEMENT

Property: ${deal.property_address}, ${deal.property_city}, ${deal.property_state}
Original Purchase Price: $${(deal.seller_agreed_price || deal.offer_price)?.toLocaleString()}
Assignment Price: $${deal.buyer_price?.toLocaleString()}
Assignment Fee: $${fee?.toLocaleString()}
Closing Date: ${closingDate}

Assignor transfers all rights under the original PSA to Assignee.

ASSIGNOR: ___________________________ Date: ___________
ASSIGNEE: ___________________________ Date: ___________`.trim();
}

function getClosingDate(daysOut = 14) {
  const d = new Date();
  d.setDate(d.getDate() + daysOut);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

module.exports = { generate, send };
