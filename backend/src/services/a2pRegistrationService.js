/**
 * A2P 10DLC registration (ISV model, per-customer brand)
 *
 * Each Solo+ customer registers their OWN A2P brand + campaign inside their Twilio
 * subaccount (see twilioSubaccountService). Resumable, approval-gated: brand and campaign
 * vetting by TCR are asynchronous (hours to days), so each call advances as far as it can
 * and stores progress on the user record. Ends by writing users.a2p_messaging_service_sid,
 * which smsRotation.js already consumes as the operator's registered sender.
 *
 * Business identity comes from the operator's EXISTING profile fields (the same ones the
 * Settings "Business" form collects): entity_name/legal_name, ein, website, business_email,
 * business_phone, business_street/city/state/postal_code/country, contact_* (authorized
 * representative), and the sms_* fields (campaign use-case + sample). The onboarding form
 * fills these; validateBusinessData reports exactly which are still missing.
 *
 * Flow (Twilio ISV Standard Brand sequence):
 *   not_started -> secondary customer profile + A2P trust bundle submitted -> profile_ready
 *   profile_ready -> brand registration created (TCR async) -> brand_pending
 *   brand_pending (poll) APPROVED -> messaging service + campaign created -> campaign_pending
 *   campaign_pending (poll) ACTIVE -> phone number attached, MG SID stored -> active
 */

const supabase = require('../config/supabase');

const POLICY_SECONDARY_CUSTOMER_PROFILE = 'RNdfbf3fae0e1107f8aded0e7cead80bf5';
const POLICY_A2P_MESSAGING              = 'RNb0d4771c2c98518d916a3d4cd70a8f8b';
const PRIMARY_PROFILE_SID = () => process.env.TWILIO_PRIMARY_CUSTOMER_PROFILE_SID || null;

const STEPS = { NOT_STARTED: 'not_started', PROFILE_READY: 'profile_ready', BRAND_PENDING: 'brand_pending', CAMPAIGN_PENDING: 'campaign_pending', ACTIVE: 'active', ERROR: 'error' };

// Columns pulled for a registration pass (canonical profile fields).
const USER_COLS = 'id, subscription_plan, twilio_subaccount_sid, a2p_registration_step, a2p_customer_profile_sid, a2p_trust_bundle_sid, a2p_brand_sid, a2p_brand_status, a2p_campaign_sid, a2p_campaign_status, a2p_messaging_service_sid, entity_name, legal_name, business_type, business_industry, company_type, ein, website, business_email, business_phone, business_street, business_street2, business_city, business_state, business_postal_code, business_country, contact_first_name, contact_last_name, contact_email, contact_phone, contact_job_title, sms_use_case_summary, sms_message_sample, sms_opt_in_type';

const bizName = (u) => u.entity_name || u.legal_name;

// Required business identity for a Standard brand. Returns the list of missing fields.
function validateBusinessData(u) {
  const missing = [];
  const need = (v, label) => { if (v === undefined || v === null || String(v).trim() === '') missing.push(label); };
  need(bizName(u),             'business name (entity_name/legal_name)');
  need(u.business_type,        'business_type');
  need(u.business_industry,    'business_industry');
  need(u.ein,                  'ein');
  need(u.website,              'website');
  need(u.business_email,       'business_email');
  need(u.business_phone,       'business_phone');
  need(u.business_street,      'business_street');
  need(u.business_city,        'business_city');
  need(u.business_state,       'business_state');
  need(u.business_postal_code, 'business_postal_code');
  need(u.contact_first_name,   'contact_first_name');
  need(u.contact_last_name,    'contact_last_name');
  need(u.contact_email,        'contact_email');
  need(u.contact_phone,        'contact_phone');
  need(u.contact_job_title,    'contact_job_title');
  return missing;
}

// Campaign content, derived from the operator's own opt-in/use-case data where available.
function buildCampaign(u) {
  const samples = String(u.sms_message_sample || '').split('\n').map(s => s.trim()).filter(Boolean);
  return {
    usecase:     'MIXED',
    description: (u.sms_use_case_summary && u.sms_use_case_summary.trim())
      || 'Real estate acquisition outreach: the operator contacts property owners who opted in to discuss selling, sends offers, and coordinates closing.',
    messageFlow: u.sms_opt_in_type === 'WEB_FORM'
      ? 'Property owners opt in by submitting their information on the operator\'s website to receive follow-up messages about an offer on their property.'
      : 'Property owners opt in by verbally agreeing on a call to receive follow-up text messages about an offer on their property.',
    messageSamples: samples.length ? samples : [
      'Hi {name}, this is {company} following up on your property at {address}. Are you still open to a cash offer? Reply STOP to opt out.',
      'Hi {name}, we can close on {address} in as little as 14 days. Want us to send the offer over? Reply STOP to opt out.',
    ],
    hasEmbeddedLinks: true,
    hasEmbeddedPhone: true,
    optInKeywords:  ['START'],
    optOutKeywords: ['STOP'],
    helpKeywords:   ['HELP'],
  };
}

// ── Real Twilio adapter (scoped to the customer's subaccount) ──
function realAdapter(subaccountSid) {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error('Twilio master credentials not configured');
  if (!subaccountSid) throw new Error('missing subaccount SID');
  const client = require('twilio')(sid, token, { accountSid: subaccountSid });
  const th = client.trusthub.v1;
  const mg = client.messaging.v1;
  return {
    createCustomerProfile: (p) => th.customerProfiles.create({ policySid: POLICY_SECONDARY_CUSTOMER_PROFILE, ...p }),
    createEndUser:         (p) => th.endUsers.create(p),
    createSupportingDoc:   (p) => th.supportingDocuments.create(p),
    assignToProfile:       (profileSid, objectSid) => th.customerProfiles(profileSid).customerProfilesEntityAssignments.create({ objectSid }),
    evaluateProfile:       (profileSid) => th.customerProfiles(profileSid).customerProfilesEvaluations.create({ policySid: POLICY_SECONDARY_CUSTOMER_PROFILE }),
    submitProfile:         (profileSid) => th.customerProfiles(profileSid).update({ status: 'pending-review' }),
    createAddress:         (p) => client.addresses.create(p),
    createTrustProduct:    (p) => th.trustProducts.create({ policySid: POLICY_A2P_MESSAGING, ...p }),
    assignToTrustProduct:  (tpSid, objectSid) => th.trustProducts(tpSid).trustProductsEntityAssignments.create({ objectSid }),
    evaluateTrustProduct:  (tpSid) => th.trustProducts(tpSid).trustProductsEvaluations.create({ policySid: POLICY_A2P_MESSAGING }),
    submitTrustProduct:    (tpSid) => th.trustProducts(tpSid).update({ status: 'pending-review' }),
    createBrand:           (p) => mg.brandRegistrations.create(p),
    fetchBrand:            (brandSid) => mg.brandRegistrations(brandSid).fetch(),
    createMessagingService:(p) => mg.services.create(p),
    createCampaign:        (mgSid, p) => mg.services(mgSid).usAppToPerson.create(p),
    fetchCampaign:         (mgSid, campaignSid) => mg.services(mgSid).usAppToPerson(campaignSid).fetch(),
    addNumber:             (mgSid, phoneNumberSid) => mg.services(mgSid).phoneNumbers.create({ phoneNumberSid }),
  };
}

async function patchUser(userId, fields) {
  const { error } = await supabase.from('users').update({ ...fields, a2p_updated_at: new Date().toISOString() }).eq('id', userId);
  if (error) throw error;
}

async function buildProfileAndBundle(a, u) {
  const email = u.business_email;
  const name  = bizName(u);

  const profile = await a.createCustomerProfile({ email, friendlyName: `veori:${u.id} profile` });

  const biz = await a.createEndUser({
    type: 'customer_profile_business_information',
    friendlyName: `${name} business info`,
    attributes: {
      business_name:                 name,
      business_type:                 u.business_type,
      business_industry:             u.business_industry,
      business_registration_identifier: 'EIN',
      business_registration_number:  u.ein,
      business_regions_of_operation: 'USA_AND_CANADA',
      website_url:                   u.website,
      business_identity:             'direct_customer',
    },
  });
  await a.assignToProfile(profile.sid, biz.sid);

  const rep = await a.createEndUser({
    type: 'authorized_representative_1',
    friendlyName: `${name} authorized rep`,
    attributes: {
      first_name:     u.contact_first_name,
      last_name:      u.contact_last_name,
      email:          u.contact_email,
      phone_number:   u.contact_phone,
      business_title: u.contact_job_title,
      job_position:   u.contact_job_title,
    },
  });
  await a.assignToProfile(profile.sid, rep.sid);

  const address = await a.createAddress({
    customerName: name,
    friendlyName: `${name} address`,
    street:       u.business_street,
    city:         u.business_city,
    region:       u.business_state,
    postalCode:   u.business_postal_code,
    isoCountry:   u.business_country || 'US',
  });
  const doc = await a.createSupportingDoc({
    type: 'customer_profile_address',
    friendlyName: `${name} address doc`,
    attributes: { address_sids: address.sid },
  });
  await a.assignToProfile(profile.sid, doc.sid);

  const primary = PRIMARY_PROFILE_SID();
  if (!primary) throw new Error('TWILIO_PRIMARY_CUSTOMER_PROFILE_SID not configured (Veori primary profile required to vouch for the customer)');
  await a.assignToProfile(profile.sid, primary);

  await a.evaluateProfile(profile.sid);
  await a.submitProfile(profile.sid);

  const bundle = await a.createTrustProduct({ email, friendlyName: `veori:${u.id} a2p bundle` });
  const msgProfile = await a.createEndUser({
    type: 'us_a2p_messaging_profile_information',
    friendlyName: `${name} messaging profile`,
    attributes: { company_type: u.company_type || 'private' },
  });
  await a.assignToTrustProduct(bundle.sid, msgProfile.sid);
  await a.assignToTrustProduct(bundle.sid, profile.sid);
  await a.evaluateTrustProduct(bundle.sid);
  await a.submitTrustProduct(bundle.sid);

  return { profileSid: profile.sid, bundleSid: bundle.sid };
}

/**
 * Advance the registration one phase. Idempotent, resumable. `adapterFactory` is
 * injectable for tests. Returns { ok, step, ...sids, waiting?, done?, missing? }.
 */
async function advance(userId, { adapterFactory = realAdapter } = {}) {
  const { data: u, error } = await supabase.from('users').select(USER_COLS).eq('id', userId).single();
  if (error) throw error;
  if (!u) return { ok: false, reason: 'user not found' };
  if (!u.twilio_subaccount_sid) return { ok: false, reason: 'no Twilio subaccount - provision that first' };

  const missing = validateBusinessData(u);
  if (missing.length) return { ok: false, reason: 'incomplete business data', missing };

  const step = u.a2p_registration_step || STEPS.NOT_STARTED;
  const a = adapterFactory(u.twilio_subaccount_sid);

  try {
    if (step === STEPS.NOT_STARTED) {
      const { profileSid, bundleSid } = await buildProfileAndBundle(a, u);
      await patchUser(userId, { a2p_customer_profile_sid: profileSid, a2p_trust_bundle_sid: bundleSid, a2p_registration_step: STEPS.PROFILE_READY, a2p_last_error: null });
      return { ok: true, step: STEPS.PROFILE_READY, profileSid, bundleSid };
    }

    if (step === STEPS.PROFILE_READY) {
      const brand = await a.createBrand({ customerProfileBundleSid: u.a2p_customer_profile_sid, a2PProfileBundleSid: u.a2p_trust_bundle_sid });
      await patchUser(userId, { a2p_brand_sid: brand.sid, a2p_brand_status: brand.status || 'PENDING', a2p_registration_step: STEPS.BRAND_PENDING });
      return { ok: true, step: STEPS.BRAND_PENDING, brandSid: brand.sid, brandStatus: brand.status || 'PENDING' };
    }

    if (step === STEPS.BRAND_PENDING) {
      const brand = await a.fetchBrand(u.a2p_brand_sid);
      await patchUser(userId, { a2p_brand_status: brand.status });
      if (brand.status !== 'APPROVED') return { ok: true, step: STEPS.BRAND_PENDING, brandStatus: brand.status, waiting: true };

      const svc = await a.createMessagingService({ friendlyName: `veori:${u.id} a2p` });
      const c = buildCampaign(u);
      const campaign = await a.createCampaign(svc.sid, {
        brandRegistrationSid: u.a2p_brand_sid,
        description:          c.description,
        messageFlow:          c.messageFlow,
        messageSamples:       c.messageSamples,
        usAppToPersonUsecase: c.usecase,
        hasEmbeddedLinks:     c.hasEmbeddedLinks,
        hasEmbeddedPhone:     c.hasEmbeddedPhone,
        optInKeywords:        c.optInKeywords,
        optOutKeywords:       c.optOutKeywords,
        helpKeywords:         c.helpKeywords,
      });
      await patchUser(userId, { a2p_messaging_service_sid: svc.sid, a2p_campaign_sid: campaign.sid, a2p_campaign_status: campaign.campaignStatus || campaign.status || 'PENDING', a2p_registration_step: STEPS.CAMPAIGN_PENDING });
      return { ok: true, step: STEPS.CAMPAIGN_PENDING, messagingServiceSid: svc.sid, campaignSid: campaign.sid };
    }

    if (step === STEPS.CAMPAIGN_PENDING) {
      const campaign = await a.fetchCampaign(u.a2p_messaging_service_sid, u.a2p_campaign_sid);
      const status = campaign.campaignStatus || campaign.status;
      await patchUser(userId, { a2p_campaign_status: status });
      if (!['VERIFIED', 'ACTIVE', 'SUCCESS'].includes(String(status).toUpperCase())) {
        return { ok: true, step: STEPS.CAMPAIGN_PENDING, campaignStatus: status, waiting: true };
      }
      await patchUser(userId, { a2p_registration_step: STEPS.ACTIVE });
      return { ok: true, step: STEPS.ACTIVE, done: true, messagingServiceSid: u.a2p_messaging_service_sid };
    }

    if (step === STEPS.ACTIVE) return { ok: true, step: STEPS.ACTIVE, done: true, messagingServiceSid: u.a2p_messaging_service_sid };

    return { ok: false, reason: `unknown step '${step}'` };
  } catch (e) {
    await patchUser(userId, { a2p_last_error: e.message, a2p_registration_step: STEPS.ERROR }).catch(() => {});
    throw e;
  }
}

module.exports = {
  STEPS, USER_COLS, POLICY_SECONDARY_CUSTOMER_PROFILE, POLICY_A2P_MESSAGING,
  validateBusinessData, buildCampaign, realAdapter, advance,
};
