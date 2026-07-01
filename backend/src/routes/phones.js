const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const axios    = require('axios');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// POST /api/phones/provision — buy a number from Vapi, store in Veori
router.post('/provision', async (req, res, next) => {
  try {
    const { area_code, friendly_name } = req.body;

    // Purchase from Vapi
    const vapiKey = process.env.VAPI_API_KEY;
    if (!vapiKey) return res.status(500).json({ success: false, error: 'Vapi API key not configured' });

    // Build inbound webhook URL — Railway sets RAILWAY_PUBLIC_DOMAIN automatically
    const webhookUrl = process.env.VAPI_WEBHOOK_URL
      || (process.env.RAILWAY_PUBLIC_DOMAIN
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/vapi/webhook`
        : null);

    // ── STEP 1: Buy a Free Vapi Number (real US PSTN number, no Twilio account needed)
    // provider: 'vapi' + areaCode = Vapi provisions a free real US phone number
    // (+1XXXXXXXXXX) that can call any cell phone. Up to 10 per account, free.
    if (!area_code) return res.status(400).json({ success: false, error: 'area_code is required to buy a real phone number (e.g. 704 for Charlotte NC)' });

    let vapiNumber;
    try {
      const vapiRes = await axios.post('https://api.vapi.ai/phone-number', {
        provider: 'vapi',
        numberDesiredAreaCode: String(area_code),
        name: friendly_name || `Veori Line (${area_code})`,
        ...(webhookUrl ? { serverUrl: webhookUrl } : {}),
        ...(process.env.VAPI_WEBHOOK_SECRET ? { serverUrlSecret: process.env.VAPI_WEBHOOK_SECRET } : {}),
      }, {
        headers: { Authorization: `Bearer ${vapiKey}`, 'Content-Type': 'application/json' },
        timeout: 30000,
      });
      vapiNumber = vapiRes.data;
      console.log('[Phone] Vapi provision response:', JSON.stringify(vapiNumber));
    } catch (vapiErr) {
      const msg = vapiErr.response?.data?.message || vapiErr.response?.data?.error || vapiErr.message;
      return res.status(502).json({ success: false, error: `Vapi error: ${msg}` });
    }

    // Twilio numbers come back as real E.164 numbers e.g. +17045551234
    const resolvedNumber = vapiNumber.number || vapiNumber.phoneNumber || vapiNumber.id;

    // Determine if this is the operator's first number → mark primary
    const { count: existingCount } = await supabase
      .from('phone_numbers')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.user.id)
      .is('released_at', null);
    const isFirstNumber = (existingCount || 0) === 0;

    // Save to Supabase
    const { data, error } = await supabase.from('phone_numbers').insert([{
      id: uuidv4(),
      user_id: req.user.id,
      number: resolvedNumber,
      friendly_name: friendly_name || resolvedNumber,
      area_code: area_code || vapiNumber.number?.replace(/\D/g, '').slice(1, 4) || null,
      vapi_phone_number_id: vapiNumber.id,
      health_status: 'healthy',
      is_active: true,
      daily_call_limit: 50,
      monthly_cost: 2.15,
      purchased_at: new Date().toISOString(),
      is_primary: isFirstNumber,
    }]).select().single();
    if (error) throw error;

    res.status(201).json({ success: true, data, vapi_id: vapiNumber.id, number: vapiNumber.number });
  } catch (err) { next(err); }
});

// POST /api/phones/buy-local — operator OVERRIDE: buy a specific area-code local
// number on demand (real Twilio number imported into Vapi, uncapped path).
// Body: { area_code: "305", friendly_name?: string }.
// Used when the operator doesn't want the automatic lead-geo matching and wants
// to pick the area code themselves. Falls back to a nearby/any US local number
// if the exact area code is sold out (same behavior as auto-provisioning).
router.post('/buy-local', async (req, res, next) => {
  try {
    const areaCode = String(req.body.area_code || '').replace(/\D/g, '').slice(0, 3);
    if (areaCode.length !== 3) {
      return res.status(400).json({ success: false, error: 'area_code must be a 3-digit US area code (e.g. 305)' });
    }
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      return res.status(503).json({ success: false, error: 'Twilio not configured — cannot buy a local number yet' });
    }

    const { buyLocalTwilioNumber } = require('../services/numberProvisioning');
    const label = req.body.friendly_name || `Veori Line (${areaCode})`;

    const result = await buyLocalTwilioNumber(req.user.id, areaCode, label);
    res.status(201).json({
      success: true,
      number: result.number,
      area_code: result.area_code,
      state: result.state,
      vapi_id: result.vapi_phone_number_id,
      requested_area_code: areaCode,
      fell_back: result.area_code !== areaCode,
    });
  } catch (err) {
    const msg = err.message || 'Failed to buy local number';
    res.status(502).json({ success: false, error: msg });
  }
});

// POST /api/phones/buy-tollfree — operator OVERRIDE: buy a toll-free number on
// demand (Twilio toll-free imported into Vapi). Body: { friendly_name?: string }.
router.post('/buy-tollfree', async (req, res, next) => {
  try {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      return res.status(503).json({ success: false, error: 'Twilio not configured — cannot buy a toll-free number yet' });
    }
    const { buyTollFreeTwilioNumber } = require('../services/numberProvisioning');
    const label = req.body.friendly_name || 'Veori Toll-Free';
    const result = await buyTollFreeTwilioNumber(req.user.id, label);
    res.status(201).json({
      success: true,
      number: result.number,
      area_code: result.area_code,
      vapi_id: result.vapi_phone_number_id,
      is_toll_free: true,
    });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message || 'Failed to buy toll-free number' });
  }
});

// ── Toll-free import (Twilio → Vapi) ─────────────────────────────────────────
// US toll-free prefixes (digits after the leading +1). Toll-free bypasses A2P 10DLC.
const TOLLFREE_PREFIXES = ['800', '833', '844', '855', '866', '877', '888'];

function isUSTollFree(e164) {
  const digits = (e164 || '').replace(/\D/g, '');
  if (digits.length !== 11 || digits[0] !== '1') return false;
  return TOLLFREE_PREFIXES.includes(digits.slice(1, 4));
}

// POST /api/phones/import-twilio — import an operator-owned toll-free Twilio number into Vapi
router.post('/import-twilio', async (req, res, next) => {
  try {
    const { number, friendly_name } = req.body;
    if (!number) return res.status(400).json({ success: false, error: 'number is required (E.164, e.g. +18005551234)' });

    // Toll-free ONLY — bypasses A2P 10DLC registration
    if (!isUSTollFree(number)) {
      return res.status(400).json({ success: false, error: 'Only US toll-free numbers (800/833/844/855/866/877/888) can be imported' });
    }

    const vapiKey     = process.env.VAPI_API_KEY;
    const twilioSid   = process.env.TWILIO_ACCOUNT_SID;
    const twilioToken = process.env.TWILIO_AUTH_TOKEN;
    if (!vapiKey) return res.status(500).json({ success: false, error: 'Vapi API key not configured' });
    if (!twilioSid || !twilioToken) return res.status(500).json({ success: false, error: 'Twilio credentials not configured' });

    // Prevent double-import of the same number for this operator
    const { data: dupe } = await supabase
      .from('phone_numbers')
      .select('id')
      .eq('user_id', req.user.id)
      .eq('number', number)
      .is('released_at', null)
      .maybeSingle();
    if (dupe) return res.status(409).json({ success: false, error: 'This number is already imported' });

    const webhookUrl = process.env.VAPI_WEBHOOK_URL
      || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/vapi/webhook` : null);

    // Import into Vapi
    let vapiNumber;
    try {
      const vapiRes = await axios.post('https://api.vapi.ai/phone-number', {
        provider: 'twilio',
        number,
        twilioAccountSid: twilioSid,
        twilioAuthToken:  twilioToken,
        name: friendly_name || `Veori Toll-Free (${number})`,
        ...(webhookUrl ? { serverUrl: webhookUrl } : {}),
        ...(process.env.VAPI_WEBHOOK_SECRET ? { serverUrlSecret: process.env.VAPI_WEBHOOK_SECRET } : {}),
      }, {
        headers: { Authorization: `Bearer ${vapiKey}`, 'Content-Type': 'application/json' },
        timeout: 30000,
      });
      vapiNumber = vapiRes.data;
      console.log('[Phone] Vapi toll-free import response:', JSON.stringify(vapiNumber));
    } catch (vapiErr) {
      const msg = vapiErr.response?.data?.message || vapiErr.response?.data?.error || vapiErr.message;
      return res.status(502).json({ success: false, error: `Vapi import error: ${msg}` });
    }

    // First number for this operator → mark primary
    const { count: existingCount } = await supabase
      .from('phone_numbers')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.user.id)
      .is('released_at', null);
    const isFirstNumber = (existingCount || 0) === 0;

    const { data, error } = await supabase.from('phone_numbers').insert([{
      id: uuidv4(),
      user_id: req.user.id,
      number,
      friendly_name: friendly_name || number,
      area_code: number.replace(/\D/g, '').slice(1, 4),
      vapi_phone_number_id: vapiNumber.id,
      health_status: 'healthy',
      is_active: true,
      daily_call_limit: 50,
      purchased_at: new Date().toISOString(),
      is_primary: isFirstNumber,
    }]).select().single();
    if (error) throw error;

    res.status(201).json({ success: true, data, vapi_id: vapiNumber.id, number });
  } catch (err) { next(err); }
});

// ── Toll-free SMS carrier verification ───────────────────────────────────────
// US carriers SILENTLY filter SMS sent from a toll-free number that has not
// completed toll-free verification. smsService.sendSMS / smsRotation only pick a
// toll-free as an SMS sender when sms_verification_status === 'verified', so an
// operator must mark/confirm verification before their toll-free starts texting.
//
// Statuses: 'unverified' (default) → 'pending' (submitted to Twilio) → 'verified'.
const SMS_VERIFY_STATES = ['unverified', 'pending', 'verified'];

// GET /api/phones/:id/sms-verification — current SMS verification state for a number.
// If a Twilio verification SID is on file, refresh the live status from Twilio's
// Messaging Compliance REST endpoint (best-effort) and persist any change.
router.get('/:id/sms-verification', async (req, res, next) => {
  try {
    const { data: phone, error } = await supabase
      .from('phone_numbers')
      .select('id, number, is_toll_free, sms_verification_status, sms_verification_sid, sms_verification_at')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    if (error || !phone) return res.status(404).json({ success: false, error: 'Phone number not found' });
    if (!phone.is_toll_free) {
      return res.json({ success: true, data: { ...phone, applicable: false, note: 'SMS verification applies to toll-free numbers only; local numbers use A2P 10DLC.' } });
    }

    // Live refresh from Twilio if we have a verification request SID.
    let status = phone.sms_verification_status || 'unverified';
    if (phone.sms_verification_sid && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      try {
        const r = await axios.get(
          `https://messaging.twilio.com/v1/Tollfree/Verifications/${phone.sms_verification_sid}`,
          { auth: { username: process.env.TWILIO_ACCOUNT_SID, password: process.env.TWILIO_AUTH_TOKEN }, timeout: 10000 }
        );
        // Twilio statuses: PENDING_REVIEW / IN_REVIEW / TWILIO_APPROVED / TWILIO_REJECTED.
        const tw = (r.data?.status || '').toUpperCase();
        const mapped = tw === 'TWILIO_APPROVED' ? 'verified'
          : tw === 'TWILIO_REJECTED' ? 'unverified'
          : 'pending';
        if (mapped !== status) {
          status = mapped;
          await supabase.from('phone_numbers')
            .update({ sms_verification_status: status, sms_verification_at: new Date().toISOString() })
            .eq('id', phone.id).eq('user_id', req.user.id);
        }
      } catch (e) {
        console.warn(`[Phone] toll-free verification refresh failed for ${phone.number}: ${e.message}`);
      }
    }

    res.json({ success: true, data: { ...phone, applicable: true, sms_verification_status: status } });
  } catch (err) { next(err); }
});

// POST /api/phones/:id/sms-verification — set SMS verification state for a toll-free number.
// Body: { status: 'unverified'|'pending'|'verified', verification_sid?: 'HHxxxx' }.
// Used to (a) record a Twilio verification request SID + flip to 'pending', or
// (b) mark a number 'verified' once Twilio approves. Toll-free numbers only.
router.post('/:id/sms-verification', async (req, res, next) => {
  try {
    const { status, verification_sid } = req.body;
    if (!SMS_VERIFY_STATES.includes(status)) {
      return res.status(400).json({ success: false, error: `status must be one of: ${SMS_VERIFY_STATES.join(', ')}` });
    }
    const { data: phone, error: fetchErr } = await supabase
      .from('phone_numbers')
      .select('id, is_toll_free')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    if (fetchErr || !phone) return res.status(404).json({ success: false, error: 'Phone number not found' });
    if (!phone.is_toll_free) {
      return res.status(400).json({ success: false, error: 'SMS verification applies to toll-free numbers only' });
    }

    const updates = { sms_verification_status: status, sms_verification_at: new Date().toISOString() };
    if (verification_sid !== undefined) updates.sms_verification_sid = verification_sid || null;

    const { data, error } = await supabase
      .from('phone_numbers')
      .update(updates)
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select('id, number, is_toll_free, sms_verification_status, sms_verification_sid, sms_verification_at')
      .single();
    if (error) throw error;

    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// Twilio toll-free verification enums (must match Twilio's accepted values).
const TF_OPT_IN_TYPES = ['VERBAL', 'WEB_FORM', 'PAPER_FORM', 'VIA_TEXT', 'MOBILE_QR_CODE', 'IMPORT'];
const TF_BUSINESS_TYPES = ['PRIVATE_PROFIT', 'PUBLIC_PROFIT', 'SOLE_PROPRIETOR', 'NON_PROFIT', 'GOVERNMENT'];

// POST /api/phones/:id/sms-verification/submit — file a TOLL-FREE SMS verification
// request with Twilio FROM INSIDE VEORI (so the operator skips the Twilio console).
// Creates a Twilio Tollfree/Verifications request for this number, stores the
// returned verification SID, and flips the number to 'pending'. Toll-free only,
// and only for numbers Veori bought through Twilio (we need the Twilio PN SID).
//
// Body (all strings unless noted):
//   business_name*        BusinessName
//   business_type         BusinessType  (one of TF_BUSINESS_TYPES; default PRIVATE_PROFIT)
//   business_website      BusinessWebsite
//   street, street2, city, state, postal_code, country  -> Business* address
//   contact_first_name, contact_last_name, contact_email, contact_phone
//   notification_email*   NotificationEmail (verification result notice)
//   use_case_categories   array of strings (default ['MARKETING'])
//   use_case_summary*     UseCaseSummary (what you text leads)
//   message_sample*       ProductionMessageSample (an example outbound text)
//   opt_in_type           OptInType (one of TF_OPT_IN_TYPES; default VERBAL)
//   opt_in_image_urls     array of publicly-hosted opt-in proof image URLs
//   message_volume        MessageVolume (Twilio enum string, e.g. '10,000'; default '10,000')
router.post('/:id/sms-verification/submit', async (req, res, next) => {
  try {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      return res.status(503).json({ success: false, error: 'Twilio not configured — cannot submit toll-free verification yet' });
    }

    const { data: phone, error: fetchErr } = await supabase
      .from('phone_numbers')
      .select('id, number, is_toll_free, provider, twilio_phone_number_sid, sms_verification_status')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    if (fetchErr || !phone) return res.status(404).json({ success: false, error: 'Phone number not found' });
    if (!phone.is_toll_free) {
      return res.status(400).json({ success: false, error: 'SMS verification applies to toll-free numbers only' });
    }
    if (!phone.twilio_phone_number_sid) {
      return res.status(409).json({ success: false, error: 'This toll-free number has no Twilio SID on file. Only toll-free numbers purchased through Veori (provider:twilio) can be submitted for SMS verification from here.' });
    }
    if (phone.sms_verification_status === 'verified') {
      return res.status(409).json({ success: false, error: 'This number is already SMS-verified' });
    }

    const b = req.body || {};
    // Required-by-us fields (Twilio also enforces most of the address/opt-in set
    // for an approval, but these four are the minimum to file a coherent request).
    const missing = [];
    if (!b.business_name) missing.push('business_name');
    if (!b.notification_email) missing.push('notification_email');
    if (!b.use_case_summary) missing.push('use_case_summary');
    if (!b.message_sample) missing.push('message_sample');
    if (missing.length) {
      return res.status(400).json({ success: false, error: `Missing required fields: ${missing.join(', ')}` });
    }

    const businessType = TF_BUSINESS_TYPES.includes(b.business_type) ? b.business_type : 'PRIVATE_PROFIT';
    const optInType = TF_OPT_IN_TYPES.includes(b.opt_in_type) ? b.opt_in_type : 'VERBAL';
    const useCaseCategories = Array.isArray(b.use_case_categories) && b.use_case_categories.length
      ? b.use_case_categories : ['MARKETING'];
    const optInImageUrls = Array.isArray(b.opt_in_image_urls) ? b.opt_in_image_urls : [];
    const messageVolume = b.message_volume || '10,000';

    // Twilio's REST API takes form-encoded params; arrays repeat the key.
    const params = new URLSearchParams();
    params.append('TollfreePhoneNumberSid', phone.twilio_phone_number_sid);
    params.append('BusinessName', b.business_name);
    params.append('BusinessType', businessType);
    params.append('NotificationEmail', b.notification_email);
    params.append('UseCaseSummary', b.use_case_summary);
    params.append('ProductionMessageSample', b.message_sample);
    params.append('OptInType', optInType);
    params.append('MessageVolume', messageVolume);
    useCaseCategories.forEach(c => params.append('UseCaseCategories', c));
    optInImageUrls.forEach(u => params.append('OptInImageUrls', u));
    if (b.business_website) params.append('BusinessWebsite', b.business_website);
    if (b.street) params.append('BusinessStreetAddress', b.street);
    if (b.street2) params.append('BusinessStreetAddress2', b.street2);
    if (b.city) params.append('BusinessCity', b.city);
    if (b.state) params.append('BusinessStateProvinceRegion', b.state);
    if (b.postal_code) params.append('BusinessPostalCode', b.postal_code);
    if (b.country) params.append('BusinessCountry', b.country);
    if (b.contact_first_name) params.append('BusinessContactFirstName', b.contact_first_name);
    if (b.contact_last_name) params.append('BusinessContactLastName', b.contact_last_name);
    if (b.contact_email) params.append('BusinessContactEmail', b.contact_email);
    if (b.contact_phone) params.append('BusinessContactPhone', b.contact_phone);

    let verificationSid = null;
    let twStatus = 'PENDING_REVIEW';
    try {
      const r = await axios.post(
        'https://messaging.twilio.com/v1/Tollfree/Verifications',
        params.toString(),
        {
          auth: { username: process.env.TWILIO_ACCOUNT_SID, password: process.env.TWILIO_AUTH_TOKEN },
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 20000,
        }
      );
      verificationSid = r.data?.sid || null;
      twStatus = (r.data?.status || 'PENDING_REVIEW').toUpperCase();
    } catch (e) {
      const msg = e.response?.data?.message || e.response?.data?.error || e.message;
      return res.status(502).json({ success: false, error: `Twilio rejected the verification request: ${msg}` });
    }

    // Map Twilio's status to our 3-state model and persist (pending until approved).
    const mapped = twStatus === 'TWILIO_APPROVED' ? 'verified'
      : twStatus === 'TWILIO_REJECTED' ? 'unverified'
      : 'pending';

    const { data, error } = await supabase
      .from('phone_numbers')
      .update({
        sms_verification_status: mapped,
        sms_verification_sid:    verificationSid,
        sms_verification_at:     new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select('id, number, is_toll_free, sms_verification_status, sms_verification_sid, sms_verification_at')
      .single();
    if (error) throw error;

    res.status(201).json({ success: true, data, twilio_status: twStatus });
  } catch (err) { next(err); }
});

// ── Shared toll-free pool (admin only) ───────────────────────────────────────
// Gate: requires the ADMIN_API_KEY secret in the X-Admin-Key header (on top of
// requireAuth). Operators can't fill the shared pool — only the platform owner.
function requireAdmin(req, res, next) {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) return res.status(500).json({ success: false, error: 'Admin key not configured' });
  if (req.get('X-Admin-Key') !== adminKey) {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  next();
}

// POST /api/phones/pool/load — load verified toll-free numbers into the shared pool
// body: { numbers: ["+18005551234", ...] }
router.post('/pool/load', requireAdmin, async (req, res, next) => {
  try {
    const { numbers } = req.body;
    if (!Array.isArray(numbers) || numbers.length === 0) {
      return res.status(400).json({ success: false, error: 'numbers array required (E.164 toll-free)' });
    }
    const { loadPoolNumbers } = require('../services/poolService');
    const result = await loadPoolNumbers(numbers);
    res.status(201).json({ success: true, ...result });
  } catch (err) { next(err); }
});

// GET /api/phones/pool/status — pool counts (admin only)
router.get('/pool/status', requireAdmin, async (req, res, next) => {
  try {
    const counts = {};
    for (const status of ['available', 'assigned']) {
      const { count } = await supabase
        .from('phone_numbers')
        .select('*', { count: 'exact', head: true })
        .eq('is_toll_free', true)
        .eq('pool_status', status);
      counts[status] = count || 0;
    }
    const { count: pending } = await supabase
      .from('phone_numbers')
      .select('*', { count: 'exact', head: true })
      .eq('is_toll_free', true)
      .eq('verified_status', 'pending');
    const { count: available_verified } = await supabase
      .from('phone_numbers')
      .select('*', { count: 'exact', head: true })
      .is('user_id', null)
      .eq('pool_status', 'available')
      .eq('is_toll_free', true)
      .eq('verified_status', 'verified');

    res.json({
      success: true,
      available_to_assign: available_verified || 0,
      available_total:     counts.available,
      assigned:            counts.assigned,
      pending_verification: pending || 0,
    });
  } catch (err) { next(err); }
});

// GET /api/phones/plan-status — beta: unlimited numbers
router.get('/plan-status', async (req, res, next) => {
  try {
    const { count } = await supabase.from('phone_numbers').select('*', { count: 'exact', head: true }).eq('user_id', req.user.id);
    res.json({ success: true, tier: 'beta', used: count || 0, limit: 999, can_provision: true });
  } catch (err) { next(err); }
});

// POST /api/phones/sync-vapi — import all numbers from Vapi account into Veori
router.post('/sync-vapi', async (req, res, next) => {
  try {
    const vapiKey = process.env.VAPI_API_KEY;
    if (!vapiKey) return res.status(500).json({ success: false, error: 'Vapi API key not configured' });

    // Fetch all numbers from Vapi
    const { data: vapiNumbers } = await axios.get('https://api.vapi.ai/phone-number', {
      headers: { Authorization: `Bearer ${vapiKey}` },
      timeout: 15000,
    });
    const numbers = Array.isArray(vapiNumbers) ? vapiNumbers : (vapiNumbers?.results || []);

    // Get already-imported Vapi IDs for this user
    const { data: existing } = await supabase.from('phone_numbers').select('vapi_phone_number_id').eq('user_id', req.user.id);
    const existingIds = new Set((existing || []).map(p => p.vapi_phone_number_id).filter(Boolean));

    const webhookUrl = process.env.VAPI_WEBHOOK_URL
      || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/vapi/webhook` : null);

    const toImport = numbers.filter(n => n.id && !existingIds.has(n.id));
    if (!toImport.length) return res.json({ success: true, imported: 0, message: 'All Vapi numbers already synced' });

    // Wire inbound webhook on each number in Vapi if not already set
    if (webhookUrl) {
      await Promise.all(toImport.map(n =>
        axios.patch(`https://api.vapi.ai/phone-number/${n.id}`, { serverUrl: webhookUrl }, {
          headers: { Authorization: `Bearer ${vapiKey}` },
          timeout: 10000,
        }).catch(() => {})
      ));
    }

    const records = toImport.map(n => ({
      id: uuidv4(),
      user_id: req.user.id,
      number: n.number,
      friendly_name: n.name || n.number,
      area_code: n.number?.replace(/\D/g, '').slice(1, 4) || null,
      vapi_phone_number_id: n.id,
      health_status: 'healthy',
      is_active: true,
      daily_call_limit: 50,
    }));

    const { data: inserted, error } = await supabase.from('phone_numbers').insert(records).select();
    if (error) throw error;

    res.json({ success: true, imported: inserted.length, numbers: inserted });
  } catch (err) { next(err); }
});

// POST /api/phones/fix-webhooks — patch ALL existing Vapi numbers with the correct serverUrl
// Run once to repair numbers that were provisioned before the serverUrl approach was in place
router.post('/fix-webhooks', async (req, res, next) => {
  try {
    const vapiKey = process.env.VAPI_API_KEY;
    if (!vapiKey) return res.status(500).json({ success: false, error: 'Vapi API key not configured' });

    const webhookUrl = process.env.VAPI_WEBHOOK_URL
      || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/vapi/webhook` : null);

    if (!webhookUrl) return res.status(500).json({ success: false, error: 'Webhook URL not configured (set VAPI_WEBHOOK_URL or RAILWAY_PUBLIC_DOMAIN)' });

    // Get all DB numbers with a Vapi ID for this user
    const { data: dbNumbers } = await supabase
      .from('phone_numbers')
      .select('vapi_phone_number_id, number')
      .eq('user_id', req.user.id)
      .not('vapi_phone_number_id', 'is', null);

    if (!dbNumbers?.length) return res.json({ success: true, patched: 0, message: 'No Vapi numbers found' });

    const results = await Promise.allSettled(
      dbNumbers.map(p =>
        axios.patch(`https://api.vapi.ai/phone-number/${p.vapi_phone_number_id}`, {
          serverUrl: webhookUrl,
          assistantId: null, // clear old static assignment
        }, {
          headers: { Authorization: `Bearer ${vapiKey}`, 'Content-Type': 'application/json' },
          timeout: 10000,
        })
      )
    );

    const patched  = results.filter(r => r.status === 'fulfilled').length;
    const failed   = results.length - patched;

    console.log(`[Phone] fix-webhooks: ${patched} patched, ${failed} failed for user ${req.user.id}`);
    res.json({ success: true, patched, failed, webhook_url: webhookUrl });
  } catch (err) { next(err); }
});

// GET /api/phones
router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('phone_numbers').select('*').eq('user_id', req.user.id).order('health_status');
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/phones/health
router.get('/health', async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('phone_numbers').select('*').eq('user_id', req.user.id);
    if (error) throw error;
    const summary = {
      total: data.length,
      active: data.filter(p => p.health_status === 'healthy' && p.is_active).length,
      cooling: data.filter(p => p.health_status === 'cooling').length,
      resting: data.filter(p => p.health_status === 'resting').length,
      flagged: data.filter(p => p.health_status === 'flagged').length,
      numbers: data,
    };
    res.json({ success: true, data: summary });
  } catch (err) { next(err); }
});

// POST /api/phones/select — intelligent number selection
router.post('/select', async (req, res, next) => {
  try {
    const { seller_state, exclude_ids = [], seller_phone, seller_area_code } = req.body;
    const phoneRotation = require('../services/phoneRotation');
    // Local-presence matching: prefer an explicit seller_area_code, else derive it from seller_phone.
    let leadAreaCode = seller_area_code || null;
    if (!leadAreaCode && seller_phone) {
      const d = String(seller_phone).replace(/\D/g, '');
      leadAreaCode = d.length === 11 && d.startsWith('1') ? d.slice(1, 4) : (d.length === 10 ? d.slice(0, 3) : null);
    }
    const number = await phoneRotation.selectBestNumber(req.user.id, seller_state, exclude_ids, leadAreaCode);
    if (!number) return res.status(404).json({ success: false, error: 'No healthy numbers available' });
    res.json({ success: true, data: number });
  } catch (err) { next(err); }
});

// POST /api/phones
router.post('/', async (req, res, next) => {
  try {
    const { number, friendly_name, area_code, state, carrier, daily_call_limit = 50 } = req.body;
    if (!number) return res.status(400).json({ success: false, error: 'number required' });
    const { data, error } = await supabase.from('phone_numbers').insert([{
      id: uuidv4(), user_id: req.user.id, number, friendly_name, area_code, state, carrier, daily_call_limit
    }]).select().single();
    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /api/phones/bulk — import CSV of numbers
router.post('/bulk', async (req, res, next) => {
  try {
    const { numbers } = req.body;
    if (!Array.isArray(numbers) || !numbers.length) return res.status(400).json({ success: false, error: 'numbers array required' });
    const records = numbers.map(n => ({ id: uuidv4(), user_id: req.user.id, number: n.number, friendly_name: n.friendly_name, area_code: n.area_code, state: n.state, carrier: n.carrier, daily_call_limit: n.daily_call_limit || 50 }));
    const { data, error } = await supabase.from('phone_numbers').insert(records).select();
    if (error) throw error;
    res.status(201).json({ success: true, data, imported: data.length });
  } catch (err) { next(err); }
});

// PUT /api/phones/:id
router.put('/:id', async (req, res, next) => {
  try {
    const allowed = ['friendly_name','daily_call_limit','is_active','health_status','spam_score','sms_daily_limit','sms_enabled'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    // Coerce the SMS cap to a sane non-negative integer (carrier-safe ceiling per number).
    if (updates.sms_daily_limit !== undefined) {
      const n = parseInt(updates.sms_daily_limit, 10);
      updates.sms_daily_limit = Number.isFinite(n) && n >= 0 ? n : 0;
    }
    const { data, error } = await supabase.from('phone_numbers').update(updates).eq('id', req.params.id).eq('user_id', req.user.id).select().single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// POST /api/phones/:id/release — soft-delete: cancel in Vapi + mark released in DB
router.post('/:id/release', async (req, res, next) => {
  try {
    const { reason } = req.body;
    const { data: phone, error: fetchErr } = await supabase
      .from('phone_numbers')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    if (fetchErr || !phone) return res.status(404).json({ success: false, error: 'Phone number not found' });
    if (phone.released_at) return res.status(400).json({ success: false, error: 'Number already released' });

    // Delete from Vapi (best-effort — don't block on failure)
    const vapiKey = process.env.VAPI_API_KEY;
    if (phone.vapi_phone_number_id && vapiKey) {
      await axios.delete(`https://api.vapi.ai/phone-number/${phone.vapi_phone_number_id}`, {
        headers: { Authorization: `Bearer ${vapiKey}` },
        timeout: 15000,
      }).catch(e => console.warn('[Phone] Vapi release failed:', e.message));
    }

    // Soft-delete in DB
    const { data: updated, error: updateErr } = await supabase
      .from('phone_numbers')
      .update({
        is_active: false,
        released_at: new Date().toISOString(),
        release_reason: reason || 'operator_released',
        health_status: 'released',
        is_primary: false,
      })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select()
      .single();
    if (updateErr) throw updateErr;

    res.json({ success: true, message: 'Phone number released', data: updated });
  } catch (err) { next(err); }
});

// DELETE /api/phones/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const { error } = await supabase.from('phone_numbers').delete().eq('id', req.params.id).eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ success: true, message: 'Phone number deleted' });
  } catch (err) { next(err); }
});

// POST /api/phones/provision-pool — manually provision the full number pool for current plan
// Useful for existing operators who subscribed before auto-provisioning existed
router.post('/provision-pool', async (req, res, next) => {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('subscription_plan, subscription_status')
      .eq('id', req.user.id)
      .single();

    if (!user?.subscription_plan || user.subscription_status !== 'active') {
      return res.status(400).json({ success: false, error: 'Active subscription required to provision number pool' });
    }

    const { provisionNumberPool } = require('../services/numberProvisioning');

    // Respond immediately — provisioning happens in background
    res.json({
      success: true,
      message: `Provisioning numbers for ${user.subscription_plan} plan. Check back in a few minutes — your numbers will appear automatically.`,
      plan: user.subscription_plan,
    });

    // Run provisioning in background
    provisionNumberPool(req.user.id, user.subscription_plan).then(result => {
      console.log(`[Phones] Manual pool provision for ${req.user.id}:`, result);
    }).catch(err => {
      console.error('[Phones] Manual pool provision error:', err.message);
    });
  } catch (err) { next(err); }
});

// POST /api/phones/auto-scale — manually kick off geo-matched calling-capacity sizing + buy.
// This is the same engine that fires automatically on every lead import (ensureCallingCapacity):
// it counts callable leads, sizes the local fleet to burn them at a healthy pace (plan-capped,
// per-operator paced), and buys only the per-state shortfall via the uncapped Twilio→Vapi path.
// The auto-on-import trigger stays intact; this endpoint is a manual override / kickstart so an
// operator can force the sizing now instead of waiting for the next import. Runs synchronously
// and returns the exact sizing + buy result so the operator can see what happened.
router.post('/auto-scale', async (req, res, next) => {
  try {
    const { ensureCallingCapacity } = require('../services/numberProvisioning');
    const result = await ensureCallingCapacity(req.user.id);

    // ensureCallingCapacity never throws — it returns a skipped/error shape instead.
    if (result?.skipped) {
      return res.json({
        success: true,
        scaled: false,
        reason: result.skipped,
        detail: result,
      });
    }

    return res.json({
      success: true,
      scaled: true,
      message: result.bought > 0
        ? `Bought ${result.bought} local number${result.bought === 1 ? '' : 's'} — sized to ${result.callableLeads} callable leads at a ${result.pace_days}-day pace.`
        : `Already at capacity — ${result.currentLocal} local number${result.currentLocal === 1 ? '' : 's'} cover ${result.callableLeads} callable leads. Nothing to buy.`,
      ...result,
    });
  } catch (err) { next(err); }
});

module.exports = router;
