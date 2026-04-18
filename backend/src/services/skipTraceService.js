/**
 * Skip Tracing Service
 *
 * Finds additional contact information (phone numbers, emails, relatives)
 * for leads where contact info is missing or incomplete.
 *
 * Primary: BatchSkipTracing (batchskiptracing.com) — bulk API
 * Fallback: PropStream, TLO, or manual lookup links
 */
const axios = require('axios');
const supabase = require('../config/supabase');

const BST_API_KEY = process.env.BATCH_SKIP_TRACE_API_KEY;
const BST_BASE    = 'https://api.batchskiptracing.com/v2';

/**
 * Skip trace a single lead using BatchSkipTracing API
 */
async function skipTraceLead(lead) {
  if (!BST_API_KEY) {
    console.log(`[SkipTrace] API key not configured — returning mock data for ${lead.property_address}`);
    return {
      simulated: true,
      phones: [],
      emails: [],
      message: 'Set BATCH_SKIP_TRACE_API_KEY to enable live skip tracing',
    };
  }

  const payload = {
    name: {
      first: lead.first_name || '',
      last: lead.last_name || '',
    },
    address: {
      street: lead.property_address || '',
      city: lead.property_city || '',
      state: lead.property_state || '',
      zip: lead.property_zip || '',
    },
  };

  try {
    const { data } = await axios.post(`${BST_BASE}/search`, payload, {
      headers: {
        Authorization: `Bearer ${BST_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    const phones = (data.phones || []).map(p => ({
      number:      p.number,
      type:        p.type || 'unknown',  // mobile, landline, voip
      is_valid:    p.is_valid !== false,
      dnc_status:  p.dnc || false,
      carrier:     p.carrier,
    }));

    const emails = (data.emails || []).map(e => ({
      address:  e.email,
      is_valid: e.is_valid !== false,
    }));

    // Update lead with skip trace results
    if (lead.id) {
      const updateData = { skip_traced: true, skip_traced_at: new Date().toISOString() };

      // Use best mobile number as primary phone if current phone is missing
      const bestPhone = phones.find(p => p.type === 'mobile' && p.is_valid && !p.dnc_status);
      if (bestPhone && !lead.phone) updateData.phone = bestPhone.number;

      // Use best email if missing
      const bestEmail = emails.find(e => e.is_valid);
      if (bestEmail && !lead.email) updateData.email = bestEmail.address;

      await supabase.from('leads').update(updateData).eq('id', lead.id).catch(console.error);
    }

    return { success: true, phones, emails, raw: data };
  } catch (err) {
    console.error('[SkipTrace] Error:', err.response?.data || err.message);
    throw new Error(err.response?.data?.message || 'Skip trace failed');
  }
}

/**
 * Bulk skip trace multiple leads
 * BatchSkipTracing has a true batch endpoint — send up to 1000 at once
 */
async function bulkSkipTrace(leads) {
  if (!BST_API_KEY) {
    return leads.map(l => ({ lead_id: l.id, simulated: true }));
  }

  const records = leads.map(lead => ({
    reference_id: lead.id,
    name: { first: lead.first_name || '', last: lead.last_name || '' },
    address: {
      street: lead.property_address || '',
      city:   lead.property_city || '',
      state:  lead.property_state || '',
      zip:    lead.property_zip || '',
    },
  }));

  try {
    const { data } = await axios.post(`${BST_BASE}/batch`, { records }, {
      headers: { Authorization: `Bearer ${BST_API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 120000, // 2 minutes for bulk
    });

    // Process results and update leads
    const results = [];
    for (const result of (data.results || [])) {
      const leadId = result.reference_id;
      const phones = result.phones || [];
      const emails = result.emails || [];

      const updateData = { skip_traced: true, skip_traced_at: new Date().toISOString() };
      const bestMobile = phones.find(p => p.type === 'mobile' && p.is_valid && !p.dnc);
      if (bestMobile) updateData.phone = bestMobile.number;

      const bestEmail = emails.find(e => e.is_valid);
      if (bestEmail) updateData.email = bestEmail.address;

      await supabase.from('leads').update(updateData).eq('id', leadId).catch(() => {});
      results.push({ lead_id: leadId, phones_found: phones.length, emails_found: emails.length });
    }

    return results;
  } catch (err) {
    console.error('[BulkSkipTrace] Error:', err.response?.data || err.message);
    throw err;
  }
}

/**
 * Check DNC status for a phone number
 */
async function checkDNC(phoneNumber) {
  // In production: check against federal DNC registry via approved API
  // For now: check our local dnc_records table
  const { data } = await supabase.from('dnc_records')
    .select('id, reason, added_at')
    .eq('phone', phoneNumber)
    .maybeSingle();

  return {
    on_dnc: !!data,
    reason: data?.reason || null,
    added_at: data?.added_at || null,
  };
}

module.exports = { skipTraceLead, bulkSkipTrace, checkDNC };
