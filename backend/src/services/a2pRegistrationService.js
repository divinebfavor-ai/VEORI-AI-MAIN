/**
 * A2P 10DLC registration (ISV model, per-customer brand)
 *
 * Each Solo+ customer registers their OWN A2P brand + campaign inside their Twilio
 * subaccount (see twilioSubaccountService). This is a RESUMABLE, approval-gated state
 * machine - brand and campaign vetting by TCR are asynchronous (hours to days), so each
 * call advances as far as it can and stores progress on the user record. It ends by
 * writing users.a2p_messaging_service_sid, which smsRotation.js already consumes.
 *
 * Flow (Twilio ISV Standard Brand sequence):
 *   not_started
 *     -> secondary customer profile (+ business info, authorized rep, address) submitted
 *     -> A2P trust bundle submitted
 *   profile_ready
 *     -> brand registration created (TCR async)  -> brand_pending
 *   brand_pending  (poll)  brand APPROVED
 *     -> messaging service + campaign created (TCR async) -> campaign_pending
 *   campaign_pending  (poll)  campaign ACTIVE
 *     -> phone number attached, a2p_messaging_service_sid stored -> active
 *
 * Flag-gated (A2P_REGISTRATION_ENABLED) at the call sites. This module never fires on
 * its own - it is invoked explicitly by an admin/verify path.
 */

const supabase = require('../config/supabase');

// Twilio-published policy SIDs for the two bundles (stable, documented).
const POLICY_SECONDARY_CUSTOMER_PROFILE = 'RNdfbf3fae0e1107f8aded0e7cead80bf5';
const POLICY_A2P_MESSAGING              = 'RNb0d4771c2c98518d916a3d4cd70a8f8b';

// Veori's approved PRIMARY customer profile - required to vouch for each secondary
// profile. Must be set once in the environment.
const PRIMARY_PROFILE_SID = () => process.env.TWILIO_PRIMARY_CUSTOMER_PROFILE_SID || null;

const STEPS = { NOT_STARTED: 'not_started', PROFILE_READY: 'profile_ready', BRAND_PENDING: 'brand_pending', CAMPAIGN_PENDING: 'campaign_pending', ACTIVE: 'active', ERROR: 'error' };

// Campaign content. Compliance-sensitive - review before first real submission.
const CAMPAIGN = {
  usecase:     'MIXED',
  description: 'Real estate acquisition outreach: the operator contacts property owners who have opted in to discuss selling their property, sends offers, and coordinates closing.',
  messageFlow: 'Property owners opt in by submitting their information on the operator\'s website or by verbally agreeing on a call to receive follow-up messages about an offer on their property.',
  messageSamples: [
    'Hi {name}, this is {company} following up on your property at {address}. Are you still open to a cash offer? Reply STOP to opt out.',
    'Hi {name}, we can close on {address} in as little as 14 days. Would you like us to send the offer over? Reply STOP to opt out.',
  ],
  hasEmbeddedLinks: true,
  hasEmbeddedPhone: true,
  optInKeywords:  ['START'],
  optOutKeywords: ['STOP'],
  helpKeywords:   ['HELP'],
};

// ── Required business identity for a Standard brand ──
function validateBusinessData(u) {
  const missing = [];
  const need = (v, label) => { if (!v || String(v).trim() === '') missing.push(label); };
  need(u.entity_name || u.legal_name, 'business_name (entity_name/legal_name)');
  need(u.business_type,               'business_type');
  need(u.business_industry,           'business_industry');
  need(u.ein,                         'ein (business registration number)');
  need(u.website,                     'website');
  need(u.business_email,              'business_email');
  need(u.business_phone,              'business_phone');
  need(u.mailing_address,             'mailing_address');
  need(u.mailing_city,                'mailing_city');
  need(u.mailing_state,               'mailing_state');
  need(u.mailing_zip,                 'mailing_zip');
  need(u.authorized_rep_first_name,   'authorized_rep_first_name');
  need(u.authorized_rep_last_name,    'authorized_rep_last_name');
  need(u.authorized_rep_email,        'authorized_rep_email');
  need(u.authorized_rep_phone,        'authorized_rep_phone');
  need(u.authorized_rep_job_position, 'authorized_rep_job_position');
  return missing;
}

// ── Real Twilio adapter (scoped to the customer's subaccount) ──
// The parent auth token acts within a subaccount by overriding the account SID, so we
// never need to store the subaccount's own auth token.
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

// Build the secondary customer profile + A2P trust bundle and submit both for review.
async function buildProfileAndBundle(a, user) {
  const email = user.business_email;
  const businessName = user.entity_name || user.legal_name;

  const profile = await a.createCustomerProfile({ email, friendlyName: `veori:${user.id} profile` });

  const biz = await a.createEndUser({
    type: 'customer_profile_business_information',
    friendlyName: `${businessName} business info`,
    attributes: {
      business_name:                businessName,
      business_type:                user.business_type,
      business_industry:            user.business_industry,
      business_registration_identifier: 'EIN',
      business_registration_number: user.ein,
      business_regions_of_operation: 'USA_AND_CANADA',
      website_url:                  user.website,
      business_identity:            'direct_customer',
      social_media_profile_urls:    '',
    },
  });
  await a.assignToProfile(profile.sid, biz.sid);

  const rep = await a.createEndUser({
    type: 'authorized_representative_1',
    friendlyName: `${businessName} authorized rep`,
    attributes: {
      first_name:   user.authorized_rep_first_name,
      last_name:    user.authorized_rep_last_name,
      email:        user.authorized_rep_email,
      phone_number: user.authorized_rep_phone,
      business_title: user.authorized_rep_job_position,
      job_position: user.authorized_rep_job_position,
    },
  });
  await a.assignToProfile(profile.sid, rep.sid);

  const address = await a.createAddress({
    customerName: businessName,
    friendlyName: `${businessName} address`,
    street:       user.mailing_address,
    city:         user.mailing_city,
    region:       user.mailing_state,
    postalCode:   user.mailing_zip,
    isoCountry:   user.business_iso_country || 'US',
  });
  const doc = await a.createSupportingDoc({
    type: 'customer_profile_address',
    friendlyName: `${businessName} address doc`,
    attributes: { address_sids: address.sid },
  });
  await a.assignToProfile(profile.sid, doc.sid);

  const primary = PRIMARY_PROFILE_SID();
  if (!primary) throw new Error('TWILIO_PRIMARY_CUSTOMER_PROFILE_SID not configured (Veori primary profile required to vouch for the customer)');
  await a.assignToProfile(profile.sid, primary);

  await a.evaluateProfile(profile.sid);
  await a.submitProfile(profile.sid);

  // A2P trust bundle
  const bundle = await a.createTrustProduct({ email, friendlyName: `veori:${user.id} a2p bundle` });
  const msgProfile = await a.createEndUser({
    type: 'us_a2p_messaging_profile_information',
    friendlyName: `${businessName} messaging profile`,
    attributes: { company_type: user.company_type || 'private' },
  });
  await a.assignToTrustProduct(bundle.sid, msgProfile.sid);
  await a.assignToTrustProduct(bundle.sid, profile.sid);
  await a.evaluateTrustProduct(bundle.sid);
  await a.submitTrustProduct(bundle.sid);

  return { profileSid: profile.sid, bundleSid: bundle.sid };
}

/**
 * Advance the registration one phase. Idempotent and resumable: safe to call repeatedly;
 * it does the next not-yet-done step based on stored state. `adapterFactory` is injectable
 * for tests. Returns { step, ...sids, done }.
 */
async function advance(userId, { adapterFactory = realAdapter } = {}) {
  const { data: user, error } = await supabase.from('users')
    .select('id, subscription_plan, twilio_subaccount_sid, a2p_registration_step, a2p_customer_profile_sid, a2p_trust_bundle_sid, a2p_brand_sid, a2p_brand_status, a2p_campaign_sid, a2p_campaign_status, a2p_messaging_service_sid, entity_name, legal_name, business_type, business_industry, company_type, ein, website, business_email, business_phone, mailing_address, mailing_city, mailing_state, mailing_zip, business_iso_country, authorized_rep_first_name, authorized_rep_last_name, authorized_rep_email, authorized_rep_phone, authorized_rep_job_position')
    .eq('id', userId).single();
  if (error) throw error;
  if (!user) return { ok: false, reason: 'user not found' };
  if (!user.twilio_subaccount_sid) return { ok: false, reason: 'no Twilio subaccount - provision that first' };

  const missing = validateBusinessData(user);
  if (missing.length) return { ok: false, reason: 'incomplete business data', missing };

  const step = user.a2p_registration_step || STEPS.NOT_STARTED;
  const a = adapterFactory(user.twilio_subaccount_sid);

  try {
    if (step === STEPS.NOT_STARTED) {
      const { profileSid, bundleSid } = await buildProfileAndBundle(a, user);
      await patchUser(userId, { a2p_customer_profile_sid: profileSid, a2p_trust_bundle_sid: bundleSid, a2p_registration_step: STEPS.PROFILE_READY, a2p_last_error: null });
      return { ok: true, step: STEPS.PROFILE_READY, profileSid, bundleSid };
    }

    if (step === STEPS.PROFILE_READY) {
      const brand = await a.createBrand({ customerProfileBundleSid: user.a2p_customer_profile_sid, a2PProfileBundleSid: user.a2p_trust_bundle_sid });
      await patchUser(userId, { a2p_brand_sid: brand.sid, a2p_brand_status: brand.status || 'PENDING', a2p_registration_step: STEPS.BRAND_PENDING });
      return { ok: true, step: STEPS.BRAND_PENDING, brandSid: brand.sid, brandStatus: brand.status || 'PENDING' };
    }

    if (step === STEPS.BRAND_PENDING) {
      const brand = await a.fetchBrand(user.a2p_brand_sid);
      await patchUser(userId, { a2p_brand_status: brand.status });
      if (brand.status !== 'APPROVED') return { ok: true, step: STEPS.BRAND_PENDING, brandStatus: brand.status, waiting: true };

      const svc = await a.createMessagingService({ friendlyName: `veori:${user.id} a2p` });
      const campaign = await a.createCampaign(svc.sid, {
        brandRegistrationSid: user.a2p_brand_sid,
        description:          CAMPAIGN.description,
        messageFlow:          CAMPAIGN.messageFlow,
        messageSamples:       CAMPAIGN.messageSamples,
        usAppToPersonUsecase: CAMPAIGN.usecase,
        hasEmbeddedLinks:     CAMPAIGN.hasEmbeddedLinks,
        hasEmbeddedPhone:     CAMPAIGN.hasEmbeddedPhone,
        optInKeywords:        CAMPAIGN.optInKeywords,
        optOutKeywords:       CAMPAIGN.optOutKeywords,
        helpKeywords:         CAMPAIGN.helpKeywords,
      });
      await patchUser(userId, { a2p_messaging_service_sid: svc.sid, a2p_campaign_sid: campaign.sid, a2p_campaign_status: campaign.campaignStatus || campaign.status || 'PENDING', a2p_registration_step: STEPS.CAMPAIGN_PENDING });
      return { ok: true, step: STEPS.CAMPAIGN_PENDING, messagingServiceSid: svc.sid, campaignSid: campaign.sid };
    }

    if (step === STEPS.CAMPAIGN_PENDING) {
      const campaign = await a.fetchCampaign(user.a2p_messaging_service_sid, user.a2p_campaign_sid);
      const status = campaign.campaignStatus || campaign.status;
      await patchUser(userId, { a2p_campaign_status: status });
      if (!['VERIFIED', 'ACTIVE', 'SUCCESS'].includes(String(status).toUpperCase())) {
        return { ok: true, step: STEPS.CAMPAIGN_PENDING, campaignStatus: status, waiting: true };
      }
      await patchUser(userId, { a2p_registration_step: STEPS.ACTIVE });
      return { ok: true, step: STEPS.ACTIVE, done: true, messagingServiceSid: user.a2p_messaging_service_sid };
    }

    if (step === STEPS.ACTIVE) return { ok: true, step: STEPS.ACTIVE, done: true, messagingServiceSid: user.a2p_messaging_service_sid };

    return { ok: false, reason: `unknown step '${step}'` };
  } catch (e) {
    await patchUser(userId, { a2p_last_error: e.message, a2p_registration_step: STEPS.ERROR }).catch(() => {});
    throw e;
  }
}

module.exports = {
  STEPS, CAMPAIGN, POLICY_SECONDARY_CUSTOMER_PROFILE, POLICY_A2P_MESSAGING,
  validateBusinessData, realAdapter, advance,
};
