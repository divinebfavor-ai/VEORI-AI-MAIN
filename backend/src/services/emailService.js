const { Resend } = require('resend');
const supabase = require('../config/supabase');

// Use Resend SDK directly — no SMTP/MX record required
const resend = new Resend(process.env.SMTP_PASS || process.env.RESEND_API_KEY);

async function sendEmail({ userId, leadId, dealId, to, subject, body, emailType }) {
  try {
    const from = process.env.EMAIL_FROM || 'Alex at Veori <alex@veori.net>';
    const html = body.includes('<') ? body : body.replace(/\n/g, '<br>');
    const text = body.replace(/<[^>]+>/g, '');

    const { data: info, error } = await resend.emails.send({ from, to, subject, html, text });
    if (error) throw new Error(error.message || JSON.stringify(error));

    // Log to database
    if (supabase && userId) {
      await supabase.from('email_log').insert({
        user_id: userId,
        lead_id: leadId || null,
        deal_id: dealId || null,
        to_email: to,
        subject,
        body,
        email_type: emailType || 'general',
        status: 'sent',
      });
    }

    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('Email send error:', err.message);
    // Log failure
    if (supabase && userId) {
      await supabase.from('email_log').insert({
        user_id: userId,
        to_email: to,
        subject,
        body,
        email_type: emailType || 'general',
        status: 'failed',
        error: err.message,
      });
    }
    throw err;
  }
}

// ─── Email Templates ──────────────────────────────────────────────────────────

function noAnswerFollowUp({ firstName, address, callbackNumber, operatorName, companyName }) {
  return {
    subject: `${address}`,
    body: `Hey ${firstName},\n\nI tried calling you earlier about your property on ${address}. I have a cash offer I think you'd like. Got a few minutes to talk this week?\n\nJust call me back or shoot me a reply.\n\n${operatorName || 'Alex'}\n${callbackNumber || ''}`,
  };
}

function callbackConfirmation({ firstName, address, scheduledDay, scheduledTime, operatorName }) {
  return {
    subject: `Talk ${scheduledDay}`,
    body: `Hey ${firstName},\n\nJust locking in our call for ${scheduledDay} at ${scheduledTime} about ${address}. Looking forward to it.\n\nIf anything comes up just let me know.\n\n${operatorName || 'Alex'}`,
  };
}

function offerFollowUp({ firstName, address, offerAmount, expiryDate, operatorName }) {
  const fmt = (n) => n ? '$' + Number(n).toLocaleString() : 'the offer';
  return {
    subject: `Still interested in ${address}?`,
    body: `Hey ${firstName},\n\nJust checking back in on ${address}. The ${fmt(offerAmount)} cash offer is still on the table through ${expiryDate}.\n\nAny questions I can answer? Happy to talk through it.\n\n${operatorName || 'Alex'}`,
  };
}

function contractSent({ firstName, address, price, signingLink, operatorName }) {
  const fmt = (n) => n ? '$' + Number(n).toLocaleString() : 'the agreed price';
  return {
    subject: `Contract for ${address}`,
    body: `Hey ${firstName},\n\nHere's the purchase agreement for ${address} at ${fmt(price)}. Take a look and sign when you're ready.\n\n${signingLink ? `Sign here: ${signingLink}\n\n` : ''}Any questions just call me.\n\n${operatorName || 'Alex'}`,
  };
}

function titleCompanyNotification({ address, sellerName, buyerName, purchasePrice, assignmentFee, closingDate, psaUrl, assignmentUrl, operatorName, wireInstructions }) {
  const fmt = (n) => n ? '$' + Number(n).toLocaleString() : 'TBD';
  return {
    subject: `New file ready - ${address}`,
    body: `Hi,\n\nWe have a new deal ready to close. Details below.\n\n` +
      `Property: ${address}\n` +
      `Seller: ${sellerName || 'TBD'}\n` +
      `Buyer: ${buyerName || 'TBD'}\n` +
      `Purchase Price: ${fmt(purchasePrice)}\n` +
      `Assignment Fee: ${fmt(assignmentFee)}\n` +
      `Target Close: ${closingDate || 'TBD'}\n\n` +
      (psaUrl ? `PSA: ${psaUrl}\n` : '') +
      (assignmentUrl ? `Assignment: ${assignmentUrl}\n` : '') +
      (wireInstructions ? `\nWire Instructions:\n${wireInstructions}\n` : '') +
      `\nLet me know if you need anything else.\n\n${operatorName || 'Alex'}`,
  };
}

function buyerAlert({ buyerName, address, city, state, beds, baths, sqft, arv, askingPrice, repairEstimate, operatorName }) {
  const fmt = (n) => n ? '$' + Number(n).toLocaleString() : 'TBD';
  const profit = arv && askingPrice && repairEstimate ? fmt(arv - askingPrice - repairEstimate) : 'TBD';
  return {
    subject: `New deal in ${city}, ${state}`,
    body: `Hey ${buyerName},\n\nGot a new off market deal I think fits your criteria. Here are the numbers.\n\n` +
      `${address}\n` +
      `${beds || '?'} bed / ${baths || '?'} bath / ${sqft ? sqft.toLocaleString() + ' sqft' : ''}\n` +
      `ARV: ${fmt(arv)}\n` +
      `Price: ${fmt(askingPrice)}\n` +
      `Repairs: ${fmt(repairEstimate)}\n` +
      `Potential profit: ${profit}\n\n` +
      `Call or reply if you want to move on this.\n\n${operatorName || 'Alex'}`,
  };
}

function offerExpired({ firstName, address, operatorName }) {
  return {
    subject: `${address}`,
    body: `Hey ${firstName},\n\nOur cash offer on ${address} expired but if your situation changes just reach out. We can usually put something together pretty quickly.\n\nHope everything works out for you.\n\n${operatorName || 'Alex'}`,
  };
}

function contractSentReminder({ firstName, address, signingLink, operatorName }) {
  return {
    subject: `Contract still waiting on ${address}`,
    body: `Hey ${firstName},\n\nJust a heads up the contract for ${address} is still waiting on your signature.\n\n${signingLink ? `Sign here: ${signingLink}\n\n` : ''}Any questions just call me and we can go through it together.\n\n${operatorName || 'Alex'}`,
  };
}

function marketUpdate({ firstName, address, operatorName }) {
  return {
    subject: `Thought of you`,
    body: `Hey ${firstName},\n\nCash buyers in your area are really active right now and I thought of your property on ${address}.\n\nIf you're ever open to an offer just let me know. No pressure at all.\n\n${operatorName || 'Alex'}`,
  };
}

function thankYou({ firstName, address, assignmentFee, operatorName }) {
  const fmt = (n) => n ? '$' + Number(n).toLocaleString() : '';
  return {
    subject: `We're closed!`,
    body: `Hey ${firstName},\n\nWe're all done on ${address}${assignmentFee ? ` and your ${fmt(assignmentFee)} has been sent` : ''}. It was great working with you.\n\nIf you ever have another property or know someone who needs to sell fast, think of me.\n\nThanks again.\n\n${operatorName || 'Alex'}`,
  };
}

module.exports = {
  sendEmail,
  templates: {
    noAnswerFollowUp,
    callbackConfirmation,
    offerFollowUp,
    offerExpired,
    contractSent,
    contractSentReminder,
    marketUpdate,
    thankYou,
    titleCompanyNotification,
    buyerAlert,
  },
};
