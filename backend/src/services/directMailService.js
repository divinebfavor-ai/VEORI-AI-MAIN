/**
 * Direct Mail Service — Lob.com Integration
 *
 * Sends physical postcards and letters to sellers via Lob.com API.
 * Triggers automatically when a seller doesn't answer 3+ consecutive calls.
 *
 * Docs: https://docs.lob.com/#tag/Postcards
 */
const axios = require('axios');
const supabase = require('../config/supabase');

const LOB_API_KEY = process.env.LOB_API_KEY;
const LOB_BASE    = 'https://api.lob.com/v1';

const lobHttp = axios.create({
  baseURL: LOB_BASE,
  auth: { username: LOB_API_KEY || 'test_placeholder', password: '' },
  timeout: 30000,
});

// ─── Postcard Templates ───────────────────────────────────────────────────────
const POSTCARD_TEMPLATES = {
  no_answer: {
    subject: 'Cash Offer for Your Property',
    message: `Hi {firstName},

I recently tried calling you about your property at {address}.

I'm a local cash buyer and I'd love to make you a fair all-cash offer — no repairs needed, no agent fees, close in as little as 14 days on your timeline.

If you're even slightly curious, please call or text me at {phone}.

I promise it's worth 5 minutes of your time.

{aiName}
{companyName}`,
  },
  motivated: {
    subject: 'Still Interested in Your Home',
    message: `Hi {firstName},

We spoke recently about your property at {address}.

I'm still very interested and my cash offer stands. We can close quickly — you pick the date, no repairs, no commissions, no hassle.

Call or text: {phone}

Best,
{aiName}
{companyName}`,
  },
  last_chance: {
    subject: 'Final Notice — Cash Offer Expiring',
    message: `Hi {firstName},

This is my final outreach about your property at {address}.

My cash offer is still available for a short time. If selling quickly, getting a fair price, and avoiding repairs and commissions sounds good — please call me.

{phone}

If the timing isn't right, I completely understand. Wishing you all the best.

{aiName}
{companyName}`,
  },
};

/**
 * Send a postcard to a lead via Lob.com
 */
async function sendPostcard({ lead, operator = {}, templateKey = 'no_answer' }) {
  if (!lead.property_address) throw new Error('Lead has no property address');

  const aiName     = operator.ai_caller_name || 'Alex';
  const companyName= operator.company_name   || 'Local Real Estate Investor';
  const returnPhone= operator.business_phone  || operator.phone || '(555) 000-0000';
  const returnAddr = {
    name:    companyName,
    address_line1: operator.address_line1 || '123 Main Street',
    address_city:  operator.city          || 'Detroit',
    address_state: operator.state_abbr    || 'MI',
    address_zip:   operator.zip           || '48201',
    address_country: 'US',
  };

  const tmpl = POSTCARD_TEMPLATES[templateKey] || POSTCARD_TEMPLATES.no_answer;

  const message = tmpl.message
    .replace(/{firstName}/g, lead.first_name || 'Homeowner')
    .replace(/{address}/g,   lead.property_address)
    .replace(/{phone}/g,     returnPhone)
    .replace(/{aiName}/g,    aiName)
    .replace(/{companyName}/g, companyName);

  if (!LOB_API_KEY || LOB_API_KEY === 'test_placeholder') {
    console.log(`[DirectMail] LOB_API_KEY not set — simulating postcard to ${lead.property_address}`);
    // Log it in DB anyway
    await supabase.from('email_log').insert({
      user_id:    operator.id,
      lead_id:    lead.id,
      email_type: 'direct_mail_simulated',
      to_address: `${lead.property_address}, ${lead.property_city}, ${lead.property_state}`,
      subject:    tmpl.subject,
      body:       message,
      sent_at:    new Date().toISOString(),
      status:     'simulated',
    }).catch(() => {});
    return { simulated: true, message: 'Set LOB_API_KEY to send real postcards' };
  }

  // Build Lob postcard request
  const payload = {
    description: `Postcard to ${lead.first_name} ${lead.last_name} — ${lead.property_address}`,
    to: {
      name: `${lead.first_name || 'Homeowner'} ${lead.last_name || ''}`.trim(),
      address_line1: lead.property_address,
      address_city:  lead.property_city  || '',
      address_state: lead.property_state || '',
      address_zip:   lead.property_zip   || '',
      address_country: 'US',
    },
    from: returnAddr,
    size: '4x6',
    // Lob supports HTML front/back — using a simple template
    front: `<html><body style="font-family:Arial,sans-serif;padding:20px;">
      <h2 style="color:#000;font-size:20px;">${tmpl.subject}</h2>
      <p style="font-size:14px;line-height:1.6;">${message.replace(/\n/g, '<br>')}</p>
    </body></html>`,
    back: `<html><body style="font-family:Arial,sans-serif;padding:20px;background:#f5f5f5;">
      <p style="font-size:12px;color:#666;">This is a commercial offer. To be removed from our list, call ${returnPhone}.</p>
    </body></html>`,
    metadata: { lead_id: lead.id || '', user_id: operator.id || '', template: templateKey },
  };

  try {
    const { data } = await lobHttp.post('/postcards', payload);

    // Log the mailing
    await supabase.from('email_log').insert({
      user_id:    operator.id,
      lead_id:    lead.id,
      email_type: 'direct_mail',
      to_address: `${lead.property_address}, ${lead.property_city}, ${lead.property_state}`,
      subject:    tmpl.subject,
      body:       message,
      sent_at:    new Date().toISOString(),
      status:     'sent',
      external_id: data.id,
    }).catch(() => {});

    console.log(`[DirectMail] Postcard sent — Lob ID: ${data.id}`);
    return { success: true, lob_id: data.id, expected_delivery: data.expected_delivery_date };
  } catch (err) {
    console.error('[DirectMail] Lob error:', err.response?.data || err.message);
    throw new Error(err.response?.data?.error?.message || 'Direct mail failed');
  }
}

/**
 * Check if a lead qualifies for auto direct mail trigger
 * (3+ unanswered calls in the last 14 days)
 */
async function checkAutoMailTrigger(leadId, userId) {
  const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString();
  const { data: calls } = await supabase.from('calls')
    .select('id, outcome')
    .eq('lead_id', leadId)
    .eq('user_id', userId)
    .in('outcome', ['not_home', 'voicemail'])
    .gte('created_at', twoWeeksAgo);

  return (calls?.length || 0) >= 3;
}

module.exports = { sendPostcard, checkAutoMailTrigger, POSTCARD_TEMPLATES };
