const nodemailer = require('nodemailer');
const supabase = require('../config/supabase');

// Create transporter — uses SMTP env vars or falls back to Ethereal for dev
async function getTransporter() {
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  // Dev fallback — logs to console
  return {
    sendMail: async (opts) => {
      console.log('📧 [EMAIL DEV]', JSON.stringify(opts, null, 2));
      return { messageId: 'dev-' + Date.now() };
    }
  };
}

async function sendEmail({ userId, leadId, dealId, to, subject, body, emailType }) {
  try {
    const transporter = await getTransporter();
    const from = process.env.EMAIL_FROM || '"Veori AI" <alex@veori.net>';

    const info = await transporter.sendMail({
      from,
      to,
      subject,
      html: body.includes('<') ? body : body.replace(/\n/g, '<br>'),
      text: body.replace(/<[^>]+>/g, ''),
    });

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
    subject: `Regarding your property at ${address}`,
    body: `Hi ${firstName},\n\nI tried reaching you today about your property at ${address}. I have a cash offer I would like to share with you. Would you have a few minutes this week to chat? I can work around your schedule.\n\nPlease give me a call or reply to this email at your convenience.\n\nBest regards,\n${operatorName || 'Alex'}\n${companyName || 'Veori AI Acquisitions'}\n${callbackNumber || ''}`,
  };
}

function callbackConfirmation({ firstName, address, scheduledDay, scheduledTime, operatorName }) {
  return {
    subject: `Following up — ${address} — ${scheduledDay}`,
    body: `Hi ${firstName},\n\nJust confirming our conversation for ${scheduledDay} at ${scheduledTime}. I am looking forward to discussing your property at ${address} with you.\n\nIf anything changes please feel free to reach out.\n\nBest regards,\n${operatorName || 'Alex'}`,
  };
}

function offerFollowUp({ firstName, address, offerAmount, expiryDate, operatorName }) {
  const fmt = (n) => n ? '$' + Number(n).toLocaleString() : 'our cash offer';
  return {
    subject: `Your cash offer — ${address} — expires ${expiryDate}`,
    body: `Hi ${firstName},\n\nI wanted to follow up on the cash offer of ${fmt(offerAmount)} for your property at ${address}.\n\nThis offer is available through ${expiryDate}. After that my buying capacity moves to other properties.\n\nIs there anything I can answer to help you make a decision?\n\nBest regards,\n${operatorName || 'Alex'}`,
  };
}

function contractSent({ firstName, address, price, signingLink, operatorName }) {
  const fmt = (n) => n ? '$' + Number(n).toLocaleString() : 'the agreed amount';
  return {
    subject: `Your purchase agreement — ${address} — please sign`,
    body: `Hi ${firstName},\n\nAs discussed, here is your purchase agreement for ${address} at ${fmt(price)}.\n\nPlease review and sign at your earliest convenience using the link below. Once signed we move immediately toward closing.\n\n${signingLink ? `Sign here: ${signingLink}\n\n` : ''}If you have any questions please call me directly.\n\nBest regards,\n${operatorName || 'Alex'}`,
  };
}

function titleCompanyNotification({ address, sellerName, buyerName, purchasePrice, assignmentFee, closingDate, psaUrl, assignmentUrl, operatorName, wireInstructions }) {
  const fmt = (n) => n ? '$' + Number(n).toLocaleString() : 'TBD';
  return {
    subject: `New Assignment Ready for Closing — ${address}`,
    body: `Hi,\n\nWe have a new assignment ready for closing. Please see details below.\n\n` +
      `Property: ${address}\n` +
      `Seller: ${sellerName || 'TBD'}\n` +
      `Buyer: ${buyerName || 'TBD'}\n` +
      `Purchase Price: ${fmt(purchasePrice)}\n` +
      `Assignment Fee: ${fmt(assignmentFee)}\n` +
      `Target Close Date: ${closingDate || 'TBD'}\n\n` +
      (psaUrl ? `Purchase & Sale Agreement: ${psaUrl}\n` : '') +
      (assignmentUrl ? `Assignment Agreement: ${assignmentUrl}\n` : '') +
      (wireInstructions ? `\nWire Instructions:\n${wireInstructions}\n` : '') +
      `\nPlease confirm receipt and advise on next steps.\n\nBest regards,\n${operatorName || 'Alex'}\nVeori AI Acquisitions`,
  };
}

function buyerAlert({ buyerName, address, city, state, beds, baths, sqft, arv, askingPrice, repairEstimate, operatorName }) {
  const fmt = (n) => n ? '$' + Number(n).toLocaleString() : 'TBD';
  const profit = arv && askingPrice && repairEstimate
    ? fmt(arv - askingPrice - repairEstimate)
    : 'TBD';
  return {
    subject: `New off-market property — ${city}, ${state} — ${beds}bd/${baths}ba — ${fmt(askingPrice)}`,
    body: `Hi ${buyerName},\n\nI have a new off-market property that fits your buy box. Details below. Reply or call me to discuss.\n\n` +
      `Property: ${address}\n` +
      `Beds/Baths: ${beds || '?'} / ${baths || '?'}\n` +
      `Square Feet: ${sqft ? sqft.toLocaleString() : 'TBD'}\n` +
      `ARV: ${fmt(arv)}\n` +
      `Asking: ${fmt(askingPrice)}\n` +
      `Repairs Needed: ${fmt(repairEstimate)}\n` +
      `Potential Profit: ${profit}\n\n` +
      `Best regards,\n${operatorName || 'Alex'}`,
  };
}

function offerExpired({ firstName, address, operatorName }) {
  return {
    subject: `Our offer on ${address} has expired`,
    body: `Hi ${firstName},\n\nJust a quick note — our cash offer for your property at ${address} has expired.\n\nIf your situation changes or you'd like to revisit a sale, please don't hesitate to reach out. We can often put together a new offer quickly.\n\nWishing you all the best.\n\nBest regards,\n${operatorName || 'Alex'}`,
  };
}

function contractSentReminder({ firstName, address, signingLink, operatorName }) {
  return {
    subject: `Reminder — purchase agreement awaiting signature — ${address}`,
    body: `Hi ${firstName},\n\nThis is a friendly reminder that your purchase agreement for ${address} is still awaiting your signature.\n\n${signingLink ? `Sign here: ${signingLink}\n\n` : ''}If you have any questions or concerns, I am happy to walk through the contract with you. Please feel free to call or reply to this email.\n\nBest regards,\n${operatorName || 'Alex'}`,
  };
}

function marketUpdate({ firstName, address, operatorName }) {
  return {
    subject: `Market update — properties like yours are in demand`,
    body: `Hi ${firstName},\n\nI wanted to reach out with a quick market update for your area.\n\nProperties similar to yours at ${address} are seeing strong cash buyer interest right now. If you've been on the fence about selling, this could be a great time to get a fair offer and close on your timeline.\n\nNo pressure — just thought you'd appreciate the update. Happy to chat if you're curious.\n\nBest regards,\n${operatorName || 'Alex'}`,
  };
}

function thankYou({ firstName, address, assignmentFee, operatorName }) {
  const fmt = (n) => n ? '$' + Number(n).toLocaleString() : 'an amount';
  return {
    subject: `Thank you — ${address} is closed!`,
    body: `Hi ${firstName},\n\nCongratulations — the sale of ${address} is now closed! It was a pleasure working with you.\n\nYour proceeds of ${fmt(assignmentFee)} have been disbursed per the closing instructions.\n\nIf you ever have another property you'd like to sell quickly, or if you know someone in a similar situation, please think of us.\n\nThank you again for trusting us with this transaction.\n\nBest regards,\n${operatorName || 'Alex'}`,
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
