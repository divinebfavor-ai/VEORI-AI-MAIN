#!/usr/bin/env node
/**
 * One-time: create Veori's PRIMARY Trust Hub customer profile.
 *
 * In the ISV model this primary profile (Veori's own verified business identity) vouches
 * for every customer's secondary profile during A2P brand registration. Its SID goes into
 * TWILIO_PRIMARY_CUSTOMER_PROFILE_SID, which a2pRegistrationService requires.
 *
 * You may already have a primary profile from Twilio onboarding - check the console first:
 *   Twilio Console -> Trust Hub -> Customer Profiles (the "Primary" one). If it exists,
 *   just copy its BU... SID into the env var and skip this script.
 *
 * Reads Veori's identity from env (set these before running):
 *   VEORI_BUSINESS_NAME, VEORI_BUSINESS_TYPE, VEORI_BUSINESS_INDUSTRY, VEORI_EIN,
 *   VEORI_WEBSITE, VEORI_BUSINESS_EMAIL,
 *   VEORI_STREET, VEORI_CITY, VEORI_STATE, VEORI_POSTAL, VEORI_COUNTRY (default US),
 *   VEORI_REP_FIRST, VEORI_REP_LAST, VEORI_REP_EMAIL, VEORI_REP_PHONE, VEORI_REP_TITLE
 *
 * Usage:  railway run node scripts/create-primary-profile.js
 */
require('dotenv').config();

const PRIMARY_POLICY = process.env.TWILIO_PRIMARY_PROFILE_POLICY_SID || 'RNdfbf3fae0e1107f8aded0e7cead80bf5';

function need(keys) {
  const missing = keys.filter(k => !process.env[k] || !String(process.env[k]).trim());
  if (missing.length) { console.error('ABORT: missing env vars:\n  ' + missing.join('\n  ')); process.exit(1); }
}

(async () => {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    console.error('ABORT: TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set.'); process.exit(1);
  }
  need(['VEORI_BUSINESS_NAME','VEORI_BUSINESS_TYPE','VEORI_BUSINESS_INDUSTRY','VEORI_EIN','VEORI_WEBSITE','VEORI_BUSINESS_EMAIL',
        'VEORI_STREET','VEORI_CITY','VEORI_STATE','VEORI_POSTAL',
        'VEORI_REP_FIRST','VEORI_REP_LAST','VEORI_REP_EMAIL','VEORI_REP_PHONE','VEORI_REP_TITLE']);

  const e = process.env;
  const client = require('twilio')(e.TWILIO_ACCOUNT_SID, e.TWILIO_AUTH_TOKEN); // master account
  const th = client.trusthub.v1;
  const name = e.VEORI_BUSINESS_NAME;

  console.log('Creating Veori primary customer profile...');
  const profile = await th.customerProfiles.create({
    friendlyName: `${name} (Veori primary)`,
    email:        e.VEORI_BUSINESS_EMAIL,
    policySid:    PRIMARY_POLICY,
  });
  console.log('  profile:', profile.sid);

  const biz = await th.endUsers.create({
    type: 'customer_profile_business_information',
    friendlyName: `${name} business info`,
    attributes: {
      business_name:                    name,
      business_type:                    e.VEORI_BUSINESS_TYPE,
      business_industry:                e.VEORI_BUSINESS_INDUSTRY,
      business_registration_identifier: 'EIN',
      business_registration_number:     e.VEORI_EIN,
      business_regions_of_operation:    'USA_AND_CANADA',
      website_url:                      e.VEORI_WEBSITE,
      business_identity:                'direct_customer',
    },
  });
  await th.customerProfiles(profile.sid).customerProfilesEntityAssignments.create({ objectSid: biz.sid });

  const rep = await th.endUsers.create({
    type: 'authorized_representative_1',
    friendlyName: `${name} authorized rep`,
    attributes: {
      first_name: e.VEORI_REP_FIRST, last_name: e.VEORI_REP_LAST,
      email: e.VEORI_REP_EMAIL, phone_number: e.VEORI_REP_PHONE,
      business_title: e.VEORI_REP_TITLE, job_position: e.VEORI_REP_TITLE,
    },
  });
  await th.customerProfiles(profile.sid).customerProfilesEntityAssignments.create({ objectSid: rep.sid });

  const address = await client.addresses.create({
    customerName: name, friendlyName: `${name} address`,
    street: e.VEORI_STREET, city: e.VEORI_CITY, region: e.VEORI_STATE,
    postalCode: e.VEORI_POSTAL, isoCountry: e.VEORI_COUNTRY || 'US',
  });
  const doc = await th.supportingDocuments.create({
    type: 'customer_profile_address', friendlyName: `${name} address doc`,
    attributes: { address_sids: address.sid },
  });
  await th.customerProfiles(profile.sid).customerProfilesEntityAssignments.create({ objectSid: doc.sid });

  await th.customerProfiles(profile.sid).customerProfilesEvaluations.create({ policySid: PRIMARY_POLICY });
  await th.customerProfiles(profile.sid).update({ status: 'pending-review' });

  console.log('\nSUBMITTED for review. Primary customer profile SID:\n');
  console.log('  ' + profile.sid);
  console.log('\nSet this in Railway:');
  console.log('  TWILIO_PRIMARY_CUSTOMER_PROFILE_SID=' + profile.sid);
})().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
