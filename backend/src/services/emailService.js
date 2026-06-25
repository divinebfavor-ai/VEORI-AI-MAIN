const { Resend } = require('resend');
const supabase = require('../config/supabase');
const { isEmailSuppressed } = require('./emailSuppression');
const { canSendCold } = require('./emailSendGuard');          // Tier 3a — daily caps + warmup ramp
const { chooseFromAddress } = require('./emailFromRotation');  // Tier 3b — multi-domain from rotation

// Lazy-init Resend — don't crash on boot if key is missing
const RESEND_KEY = process.env.SMTP_PASS || process.env.RESEND_API_KEY;
let resend = null;
try {
  if (RESEND_KEY) resend = new Resend(RESEND_KEY);
} catch (e) { /* key not set — email will simulate */ }

// Feature C — opt-in suppression check. Existing callers pass no unsubscribeUrl
// and (unless explicitly suppressed) behave exactly as before. unsubscribeUrl,
// when supplied, appends a CAN-SPAM footer + List-Unsubscribe header.
async function sendEmail({ userId, leadId, dealId, to, subject, body, html: htmlParam, emailType, unsubscribeUrl }) {
  try {
    // Suppression gate (fails open-safe — returns false if table/Supabase absent)
    if (await isEmailSuppressed(userId, to)) {
      console.log(`[Email] Suppressed (opted out) — not sending to ${to}: ${subject}`);
      if (supabase && userId) {
        await supabase.from('email_log').insert({
          user_id: userId,
          lead_id: leadId || null,
          deal_id: dealId || null,
          to_email: to,
          subject,
          body,
          email_type: emailType || 'general',
          status: 'suppressed',
        }).then(() => {}, () => {}); // best-effort; ignore if 'suppressed' status unsupported
      }
      return { success: false, suppressed: true };
    }

    // Tier 3a — daily send cap + warmup ramp. COLD/MARKETING ONLY: canSendCold
    // returns allowed:true for any non-throttleable (transactional) type, so 2FA/
    // welcome/contract mail is never gated. Fail-open: a guard fault → allowed.
    // When over cap we log a 'throttled' row (so the drip retries cleanly next day
    // without double-counting) and return without sending.
    const gate = await canSendCold(userId, emailType);
    if (!gate.allowed) {
      console.log(`[Email] Throttled (cap ${gate.cap}, sent ${gate.sentToday} today) — deferring ${to}: ${subject}`);
      if (supabase && userId) {
        await supabase.from('email_log').insert({
          user_id: userId,
          lead_id: leadId || null,
          deal_id: dealId || null,
          to_email: to,
          subject,
          body,
          email_type: emailType || 'general',
          status: 'throttled',
        }).then(() => {}, () => {}); // best-effort; ignore if 'throttled' status unsupported
      }
      return { success: false, throttled: true, cap: gate.cap, sentToday: gate.sentToday };
    }

    // Look up operator's custom email settings (from_name, reply_to)
    let fromName = 'Alex at Veori';
    let replyTo  = null;
    if (userId && supabase) {
      const { data: u } = await supabase.from('users').select('email_from_name, email_reply_to, full_name, company_name').eq('id', userId).single();
      if (u) {
        const name    = u.email_from_name || (u.full_name ? `${u.full_name}` : null) || 'Alex at Veori';
        const company = u.company_name ? ` at ${u.company_name}` : '';
        fromName  = u.email_from_name || `${name}${company}`;
        replyTo   = u.email_reply_to  || null;
      }
    }
    const defaultFrom = process.env.EMAIL_FROM || 'alex@veori.net';
    // Tier 3b — rotate the sending address across a verified pool (EMAIL_FROM_POOL).
    // Deterministic per recipient (seed = leadId || to) so a lead always gets the
    // SAME sender across their whole drip — never mid-thread sender swaps. Returns
    // defaultFrom unchanged when the pool env is unset → zero behavior change.
    const fromAddress = chooseFromAddress(leadId || to, defaultFrom);
    // Resend requires "from" to be a verified domain — keep domain but use operator's name
    const from = `${fromName} <${fromAddress}>`;
    // Accept either html: or body: — html: takes precedence (used by welcome email, 2FA OTP)
    let content = htmlParam || body || '';
    // Feature C — CAN-SPAM footer. Only appended when caller supplies an
    // unsubscribeUrl (cold drips do); transactional emails pass none → unchanged.
    if (unsubscribeUrl) {
      content += content.includes('<')
        ? `<br><br><hr><p style="font-size:12px;color:#888">If you'd rather not receive these, <a href="${unsubscribeUrl}">unsubscribe here</a>.</p>`
        : `\n\n—\nIf you'd rather not receive these, unsubscribe here: ${unsubscribeUrl}`;
    }
    const html = content.includes('<') ? content : content.replace(/\n/g, '<br>');
    const text = content.replace(/<[^>]+>/g, '');

    if (!resend) {
      console.log(`[Email] No API key — simulating email to ${to}: ${subject}`);
      return { success: true, simulated: true };
    }
    const emailPayload = { from, to, subject, html, text };
    if (replyTo) emailPayload.reply_to = replyTo;
    // One-click unsubscribe header (RFC 8058) — improves deliverability.
    if (unsubscribeUrl) {
      emailPayload.headers = {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      };
    }
    const { data: info, error } = await resend.emails.send(emailPayload);
    if (error) throw new Error(error.message || JSON.stringify(error));

    // Resend returns the provider message id under `id` (current SDK) or
    // `messageId` (older). Persist it so the webhook can correlate engagement
    // events (delivered/opened/clicked/bounced) back to this exact send row.
    const messageId = info?.id || info?.messageId || null;

    // Log to database
    if (supabase && userId) {
      // message_id is a NEW nullable column (2026-06-27 migration). Try WITH it
      // first; if the column doesn't exist yet (pre-migration), retry WITHOUT it
      // so send-logging never regresses.
      await supabase.from('email_log').insert({
        user_id: userId,
        lead_id: leadId || null,
        deal_id: dealId || null,
        to_email: to,
        subject,
        body,
        email_type: emailType || 'general',
        status: 'sent',
        message_id: messageId,
      }).then(({ error: logErr }) => {
        if (logErr) {
          return supabase.from('email_log').insert({
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
      }, () => {});
    }

    return { success: true, messageId };
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

// ─── Feature C — Cold Email Drip (3 touches) ─────────────────────────────────
// A standalone nurture drip for leads where we only have an email. Plain-text,
// short, CAN-SPAM compliant (every send carries an unsubscribe link via the
// email_drip sequence). NEW — does not alter any template above.

function coldDrip1({ firstName, address, operatorName, callbackNumber }) {
  return {
    subject: `Your property on ${address}`,
    body: `Hey ${firstName || 'there'},\n\nI work with local buyers and your property on ${address} came across my desk. I'd like to make you a fair cash offer — no repairs, no agent fees, you pick the closing date.\n\nWould it be worth a quick conversation?\n\n${operatorName || 'Alex'}\n${callbackNumber || ''}`,
  };
}

function coldDrip2({ firstName, address, operatorName }) {
  return {
    subject: `Re: ${address}`,
    body: `Hey ${firstName || 'there'},\n\nFollowing up on my note about ${address}. A lot of owners I talk to are surprised what a cash buyer will pay when they don't have to fix anything up first.\n\nIf you're even a little curious what the number would be, just reply and I'll put one together — no obligation.\n\n${operatorName || 'Alex'}`,
  };
}

function coldDrip3({ firstName, address, operatorName }) {
  return {
    subject: `Last note on ${address}`,
    body: `Hey ${firstName || 'there'},\n\nI don't want to keep filling your inbox, so this is my last note. If the timing isn't right for ${address}, no problem at all.\n\nIf anything changes — even months from now — keep my email. I can usually close in a couple weeks when a seller's ready.\n\nWishing you the best,\n${operatorName || 'Alex'}`,
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
    coldDrip1,
    coldDrip2,
    coldDrip3,
  },
};
