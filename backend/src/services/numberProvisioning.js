/**
 * Number Pool Auto-Provisioning
 *
 * When an operator subscribes or upgrades, this service provisions the right
 * number of phone numbers for their plan — matched to the geographic distribution
 * of their actual leads. If they have 60% FL leads and 40% TX leads, they get
 * 60% FL area codes and 40% TX area codes.
 *
 * Numbers needed per plan (based on 60 calls/number/day, 22 working days/month
 * = 1,320 dials/number/month):
 *   Founding / Starter  (3,000 dials)  →  3 calling numbers
 *   Growth              (7,000 dials)  →  6 calling numbers
 *   Pro                (15,000 dials)  → 12 calling numbers
 *   Scale              (30,000 dials)  → 23 calling numbers
 *   Enterprise         (50,000 dials)  → 38 calling numbers
 */

const axios    = require('axios');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');

// Numbers needed per plan.
// Sized from each plan's monthly DIAL limit at the documented health rate of
// 1,320 dials/number/month (60 dials/number/day × 22 working days):
//   starter 3k→3 · solo 7k→6 · operator 15k→12 · scale 30k→23 · enterprise 50k→38.
// (Dial tiers are unchanged from the prior plan set — only the names changed —
//  so these counts carry forward 1:1.) `founding_member` is kept ONLY as a safe
// fallback for any legacy subscriber still on that retired tier; it is no longer
// an offered plan.
const PLAN_NUMBER_COUNTS = {
  starter:         3,
  solo:            6,
  operator:        12,
  scale:           23,
  enterprise:      38,
  founding_member: 3,   // retired tier — fallback only
};

// ── Toll-free vs. local split ────────────────────────────────────────────────
// Best-practice split for real-estate cold calling (decided with the owner):
//   * The BULK of every plan is LOCAL — local presence (seller's own area code)
//     gets the most answers on OUTBOUND cold calls. These are lead-geo matched.
//   * A SMALL FIXED number of TOLL-FREE lines provide a stable, A2P-10DLC-bypassing
//     "call us back" / inbound + caller-ID-trust line. Toll-free does NOT scale
//     linearly with dial volume — a couple is enough at any plan size.
// Monday's pricing reshape only needs to touch THIS map (single source of truth).
const PLAN_TOLLFREE_COUNTS = {
  starter:         1,
  solo:            1,
  operator:        2,
  scale:           2,
  enterprise:      2,
  founding_member: 1,   // retired tier — fallback only
};

/**
 * Split a plan's total number allotment into { tollFree, local }.
 * tollFree is the small fixed count above (capped so it never exceeds the plan
 * total); local is everything else, which is what gets lead-geo matched.
 */
function splitNumberCounts(plan) {
  const total    = PLAN_NUMBER_COUNTS[plan] || 0;
  const tollFree  = Math.min(PLAN_TOLLFREE_COUNTS[plan] || 0, total);
  const local     = Math.max(0, total - tollFree);
  return { total, tollFree, local };
}

// State → area codes (local numbers for geographic matching)
const STATE_AREA_CODES = {
  AL: ['205', '251', '256'],
  AK: ['907'],
  AZ: ['480', '520', '602', '623', '928'],
  AR: ['479', '501', '870'],
  CA: ['213', '310', '323', '408', '415', '510', '619', '626', '650', '714', '747', '760', '805', '818', '858', '909', '916', '925', '949'],
  CO: ['303', '719', '720', '970'],
  CT: ['203', '475', '860'],
  DE: ['302'],
  FL: ['239', '305', '321', '352', '386', '407', '561', '689', '727', '754', '772', '786', '813', '850', '863', '904', '941', '954'],
  GA: ['229', '404', '470', '478', '678', '706', '762', '770', '912'],
  HI: ['808'],
  ID: ['208', '986'],
  IL: ['217', '224', '309', '312', '331', '618', '630', '708', '773', '779', '815', '847'],
  IN: ['219', '260', '317', '463', '574', '765', '812'],
  IA: ['319', '515', '563', '641', '712'],
  KS: ['316', '620', '785', '913'],
  KY: ['270', '364', '502', '606', '859'],
  LA: ['225', '318', '337', '504', '985'],
  ME: ['207'],
  MD: ['240', '301', '410', '443', '667'],
  MA: ['339', '351', '413', '508', '617', '774', '781', '857', '978'],
  MI: ['231', '248', '269', '313', '517', '586', '616', '734', '810', '906', '947', '989'],
  MN: ['218', '320', '507', '612', '651', '763', '952'],
  MS: ['228', '601', '662', '769'],
  MO: ['314', '417', '573', '636', '660', '816'],
  MT: ['406'],
  NE: ['308', '402', '531'],
  NV: ['702', '725', '775'],
  NH: ['603'],
  NJ: ['201', '551', '609', '732', '848', '856', '862', '908', '973'],
  NM: ['505', '575'],
  NY: ['212', '315', '347', '516', '518', '585', '607', '631', '646', '716', '718', '845', '914', '917', '929'],
  NC: ['252', '336', '704', '743', '828', '910', '919', '980', '984'],
  ND: ['701'],
  OH: ['216', '220', '234', '330', '380', '419', '440', '513', '567', '614', '740', '937'],
  OK: ['405', '539', '580', '918'],
  OR: ['458', '503', '541', '971'],
  PA: ['215', '267', '272', '412', '484', '570', '610', '717', '724', '814', '878'],
  RI: ['401'],
  SC: ['803', '843', '854', '864'],
  SD: ['605'],
  TN: ['423', '615', '629', '731', '865', '901', '931'],
  TX: ['210', '214', '254', '281', '325', '346', '361', '409', '430', '432', '469', '512', '682', '713', '726', '737', '806', '817', '830', '832', '903', '915', '936', '940', '956', '972', '979'],
  UT: ['385', '435', '801'],
  VT: ['802'],
  VA: ['276', '434', '540', '571', '703', '757', '804'],
  WA: ['206', '253', '360', '425', '509', '564'],
  WV: ['304', '681'],
  WI: ['262', '414', '534', '608', '715', '920'],
  WY: ['307'],
  DC: ['202'],
};

// Fallback area codes when no leads exist yet (top real estate markets)
const FALLBACK_AREA_CODES = [
  '404', '470',  // Atlanta GA
  '407', '954',  // Orlando / Ft Lauderdale FL
  '704', '980',  // Charlotte NC
  '214', '469',  // Dallas TX
  '713', '832',  // Houston TX
  '313', '586',  // Detroit MI
  '614', '380',  // Columbus OH
  '803', '864',  // South Carolina
  '615', '901',  // Nashville / Memphis TN
  '312', '773',  // Chicago IL
];

/**
 * Analyse the operator's leads to build a weighted area code list
 * that matches their geographic market.
 */
async function buildAreaCodeListFromLeads(userId, needed) {
  // Count leads by state
  const { data: leads } = await supabase
    .from('leads')
    .select('property_state')
    .eq('user_id', userId)
    .not('property_state', 'is', null)
    .limit(10000);

  if (!leads?.length) {
    // No leads yet — use fallback top markets
    console.log('[NumberProvisioning] No leads found — using top-market fallback area codes');
    const codes = [];
    for (let i = 0; i < needed; i++) codes.push(FALLBACK_AREA_CODES[i % FALLBACK_AREA_CODES.length]);
    return codes;
  }

  // Count leads per state
  const stateCounts = {};
  for (const l of leads) {
    const st = (l.property_state || '').toUpperCase().trim();
    if (st.length === 2) stateCounts[st] = (stateCounts[st] || 0) + 1;
  }

  // Sort states by lead count (most leads first)
  const rankedStates = Object.entries(stateCounts)
    .sort((a, b) => b[1] - a[1]);

  const totalLeads = leads.length;
  console.log(`[NumberProvisioning] Lead distribution:`, rankedStates.map(([s, c]) => `${s}:${c}`).join(', '));

  // Build proportional area code list
  // Each state gets numbers proportional to its share of leads
  const areaCodes = [];
  for (const [state, count] of rankedStates) {
    const stateACs = STATE_AREA_CODES[state];
    if (!stateACs?.length) continue;

    // How many numbers should this state get?
    const proportion = count / totalLeads;
    const numbersForState = Math.max(1, Math.round(proportion * needed));

    // Add area codes for this state, cycling through them
    for (let i = 0; i < numbersForState; i++) {
      areaCodes.push(stateACs[i % stateACs.length]);
    }
  }

  // Trim or pad to exactly `needed`
  while (areaCodes.length > needed) areaCodes.pop();
  while (areaCodes.length < needed) {
    // Fill remaining with more of the top state
    const topState = rankedStates[0]?.[0];
    const topACs   = STATE_AREA_CODES[topState] || FALLBACK_AREA_CODES;
    areaCodes.push(topACs[areaCodes.length % topACs.length]);
  }

  return areaCodes;
}

// Derive the US state for an area code (for DB storage / local-presence matching).
function stateForAreaCode(areaCode) {
  return Object.entries(STATE_AREA_CODES).find(([, codes]) =>
    codes.includes(String(areaCode))
  )?.[0] || null;
}

/**
 * Buy a LOCAL number from Twilio in the given area code and import it into Vapi.
 *
 * This is the uncapped cold-calling path: Twilio owns the number (no Vapi
 * per-account number/concurrency cap), Vapi just dials through it via the
 * provider:'twilio' import. Used whenever Twilio creds are present.
 *
 * Falls back to a nearby/any US local number if the exact area code is sold out,
 * so provisioning never hard-fails on a single unavailable area code.
 *
 * @returns {Promise<{number, state, area_code, vapi_phone_number_id}>}
 * @throws if Twilio can't find/buy a number or Vapi import fails
 */
async function buyLocalTwilioNumber(userId, areaCode, label) {
  const twilioSid   = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  if (!twilioSid || !twilioToken) throw new Error('Twilio credentials not configured');

  const twilio = require('twilio')(twilioSid, twilioToken);

  // 1. Search for an available local number in the requested area code.
  let candidates = [];
  try {
    candidates = await twilio.availablePhoneNumbers('US').local.list({
      areaCode:     parseInt(areaCode, 10),
      voiceEnabled: true,
      limit:        5,
    });
  } catch (e) {
    console.warn(`[NumberProvisioning][Twilio] area-code ${areaCode} search failed: ${e.message}`);
  }

  // 2. Fallback — any voice-capable US local number (keeps provisioning moving
  //    when a specific area code is exhausted).
  if (!candidates.length) {
    candidates = await twilio.availablePhoneNumbers('US').local.list({ voiceEnabled: true, limit: 5 });
  }
  if (!candidates.length) throw new Error(`No available Twilio local numbers for ${areaCode}`);

  const chosen = candidates[0].phoneNumber; // E.164, e.g. +13055551234

  // 3. Buy it on Twilio.
  const purchased = await twilio.incomingPhoneNumbers.create({
    phoneNumber:  chosen,
    friendlyName: label,
  });
  const number = purchased.phoneNumber || chosen;

  // 4. Import into Vapi (provider:'twilio'). Reuses the single Vapi import point.
  const { importToVapi } = require('./poolService');
  const vapiId = await importToVapi(number, label);
  if (!vapiId) throw new Error('Vapi import returned no id (check VAPI_API_KEY)');

  // Wire the number for inbound (assistant-request mode). Non-fatal — outbound
  // works regardless; this just lets sellers call the number back into Veori.
  await require('./vapiService').configureInboundNumber(vapiId).catch((e) =>
    console.warn(`[NumberProvisioning] inbound wiring failed for ${number}: ${e.message}`));

  // 5. Derive the real area code from the purchased number (fallback path may
  //    have changed it) and persist.
  const boughtAreaCode = number.replace(/\D/g, '').slice(1, 4);
  const numberState    = stateForAreaCode(boughtAreaCode);

  await supabase.from('phone_numbers').insert([{
    id:                   uuidv4(),
    user_id:              userId,
    number,
    friendly_name:        label,
    area_code:            boughtAreaCode,
    state:                numberState,
    vapi_phone_number_id: vapiId,
    provider:             'twilio',
    is_toll_free:         false,
    verified_status:      'verified',
    health_status:        'healthy',
    is_active:            true,
    daily_call_limit:     60,
    spam_score:           100,
    purchased_at:         new Date().toISOString(),
  }]);

  return { number, state: numberState, area_code: boughtAreaCode, vapi_phone_number_id: vapiId };
}

/**
 * Buy a US TOLL-FREE number from Twilio and import it into Vapi.
 *
 * Mirrors buyLocalTwilioNumber but searches Twilio's toll-free inventory
 * (800/833/844/855/866/877/888). Toll-free bypasses A2P 10DLC and gives the
 * operator a stable inbound / "call us back" line. Inserted with
 * is_toll_free:true so health math + rotation treat it correctly.
 *
 * @returns {Promise<{number, area_code, vapi_phone_number_id, is_toll_free:true}>}
 * @throws if Twilio can't find/buy a toll-free number or Vapi import fails
 */
async function buyTollFreeTwilioNumber(userId, label) {
  const twilioSid   = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  if (!twilioSid || !twilioToken) throw new Error('Twilio credentials not configured');

  const twilio = require('twilio')(twilioSid, twilioToken);

  // 1. Search Twilio's toll-free inventory (voice-capable).
  let candidates = [];
  try {
    candidates = await twilio.availablePhoneNumbers('US').tollFree.list({
      voiceEnabled: true,
      limit:        5,
    });
  } catch (e) {
    console.warn(`[NumberProvisioning][Twilio] toll-free search failed: ${e.message}`);
  }
  if (!candidates.length) throw new Error('No available Twilio toll-free numbers');

  const chosen = candidates[0].phoneNumber; // E.164, e.g. +18335551234

  // 2. Buy it on Twilio.
  const purchased = await twilio.incomingPhoneNumbers.create({
    phoneNumber:  chosen,
    friendlyName: label,
  });
  const number = purchased.phoneNumber || chosen;

  // 3. Import into Vapi (provider:'twilio'). Reuses the single Vapi import point.
  const { importToVapi } = require('./poolService');
  const vapiId = await importToVapi(number, label);
  if (!vapiId) throw new Error('Vapi import returned no id (check VAPI_API_KEY)');

  // 4. Wire inbound (assistant-request mode). Non-fatal.
  await require('./vapiService').configureInboundNumber(vapiId).catch((e) =>
    console.warn(`[NumberProvisioning] inbound wiring failed for ${number}: ${e.message}`));

  const boughtPrefix = number.replace(/\D/g, '').slice(1, 4);

  await supabase.from('phone_numbers').insert([{
    id:                   uuidv4(),
    user_id:              userId,
    number,
    friendly_name:        label,
    area_code:            boughtPrefix,
    state:                null,            // toll-free is not geographic
    vapi_phone_number_id: vapiId,
    twilio_phone_number_sid: purchased.sid || null,  // PNxxxx — needed to submit toll-free SMS verification
    provider:             'twilio',
    is_toll_free:         true,
    pool_status:          'assigned',
    verified_status:      'verified',
    health_status:        'healthy',
    is_active:            true,
    daily_call_limit:     40,              // toll-free runs a lower health cap
    spam_score:           100,
    purchased_at:         new Date().toISOString(),
  }]);

  return { number, area_code: boughtPrefix, vapi_phone_number_id: vapiId, is_toll_free: true };
}

/**
 * Provision a single cold-calling number for the given area code.
 *
 * Dispatcher:
 *   - Twilio creds present  → buy a LOCAL Twilio number + import to Vapi (uncapped).
 *   - Twilio creds missing  → fall back to a Vapi-owned number (provider:'vapi',
 *     capped) so provisioning still works before Twilio is connected.
 */
async function provisionSingleNumber(userId, areaCode, label) {
  // Preferred path: local Twilio number imported into Vapi (no Vapi caps).
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    return buyLocalTwilioNumber(userId, areaCode, label);
  }

  // Fallback path: Vapi-owned number (capped ~10/account). Keeps the system
  // working until Twilio creds are set on Railway.
  const vapiKey    = process.env.VAPI_API_KEY;
  const webhookUrl = process.env.VAPI_WEBHOOK_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/vapi/webhook`
      : null);

  if (!vapiKey) throw new Error('VAPI_API_KEY not configured');

  const { data: vapiNumber } = await axios.post('https://api.vapi.ai/phone-number', {
    provider:              'vapi',
    numberDesiredAreaCode: String(areaCode),
    name:                  label,
    ...(webhookUrl ? { serverUrl: webhookUrl } : {}),
  }, {
    headers:  { Authorization: `Bearer ${vapiKey}`, 'Content-Type': 'application/json' },
    timeout:  30000,
  });

  const resolvedNumber = vapiNumber.number || vapiNumber.phoneNumber || vapiNumber.id;
  const numberState    = stateForAreaCode(areaCode);

  // Wire the Vapi-owned number for inbound too. Non-fatal.
  await require('./vapiService').configureInboundNumber(vapiNumber.id).catch((e) =>
    console.warn(`[NumberProvisioning] inbound wiring failed for ${resolvedNumber}: ${e.message}`));

  await supabase.from('phone_numbers').insert([{
    id:                   uuidv4(),
    user_id:              userId,
    number:               resolvedNumber,
    friendly_name:        label,
    area_code:            String(areaCode),
    state:                numberState,
    vapi_phone_number_id: vapiNumber.id,
    provider:             'vapi',
    is_toll_free:         false,
    health_status:        'healthy',
    is_active:            true,
    daily_call_limit:     60,
    spam_score:           100,
    purchased_at:         new Date().toISOString(),
  }]);

  return { number: resolvedNumber, state: numberState, area_code: areaCode };
}

/**
 * Provision the full number pool for a plan.
 *
 * The plan total is split into { tollFree, local } (see splitNumberCounts):
 *   - LOCAL numbers are geographically matched to the operator's lead distribution
 *     (the bulk — best answer rates on outbound).
 *   - TOLL-FREE numbers are a small fixed count (stable inbound / call-back line).
 *
 * Idempotent: counts existing toll-free and local SEPARATELY and only buys the
 * shortfall of each type. Safe to call multiple times (purchase + upgrade + manual).
 */
async function provisionNumberPool(userId, plan) {
  const { total, tollFree: tollFreeTarget, local: localTarget } = splitNumberCounts(plan);
  if (!total) {
    console.log(`[NumberProvisioning] Unknown plan: ${plan} — skipping`);
    return { provisioned: 0, already_had: 0, target: 0 };
  }

  // Count active numbers already owned, split by type so each target is honored.
  const baseFilter = (q) => q
    .eq('user_id', userId)
    .eq('is_active', true)
    .is('released_at', null);

  const { count: existingTotal } = await baseFilter(
    supabase.from('phone_numbers').select('*', { count: 'exact', head: true })
  );
  const { count: existingTollFree } = await baseFilter(
    supabase.from('phone_numbers').select('*', { count: 'exact', head: true })
  ).eq('is_toll_free', true);

  const alreadyHad      = existingTotal || 0;
  const haveTollFree    = existingTollFree || 0;
  const haveLocal       = Math.max(0, alreadyHad - haveTollFree);

  const tollFreeNeeded  = Math.max(0, tollFreeTarget - haveTollFree);
  const localNeeded     = Math.max(0, localTarget - haveLocal);

  if (tollFreeNeeded === 0 && localNeeded === 0) {
    console.log(`[NumberProvisioning] User ${userId} already has ${alreadyHad}/${total} numbers for ${plan} (TF ${haveTollFree}/${tollFreeTarget}, local ${haveLocal}/${localTarget})`);
    return { provisioned: 0, already_had: alreadyHad, target: total, tollFree: 0, local: 0 };
  }

  console.log(`[NumberProvisioning] Provisioning for ${userId} (${plan}): ${tollFreeNeeded} toll-free + ${localNeeded} local`);

  let provisioned        = 0;
  let tollFreeProvisioned = 0;
  let localProvisioned    = 0;
  const errors           = [];

  // 1. Toll-free first (Twilio-only — needs Twilio creds; skipped cleanly if absent).
  const canBuyTwilio = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
  for (let i = 0; i < tollFreeNeeded; i++) {
    const label = `Veori Toll-Free ${haveTollFree + i + 1}`;
    if (!canBuyTwilio) {
      errors.push({ type: 'toll_free', error: 'Twilio credentials not configured — toll-free skipped' });
      break;
    }
    try {
      const result = await buyTollFreeTwilioNumber(userId, label);
      console.log(`[NumberProvisioning] ✅ toll-free ${result.number}`);
      provisioned++; tollFreeProvisioned++;
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      console.error(`[NumberProvisioning] ❌ toll-free: ${err.message}`);
      errors.push({ type: 'toll_free', error: err.message });
    }
  }

  // 2. Local numbers matched to lead geography (the bulk).
  if (localNeeded > 0) {
    const areaCodes = await buildAreaCodeListFromLeads(userId, localNeeded);
    for (let i = 0; i < localNeeded; i++) {
      const areaCode = areaCodes[i];
      const label    = `Veori Line ${haveLocal + i + 1} (${areaCode})`;
      try {
        const result = await provisionSingleNumber(userId, areaCode, label);
        console.log(`[NumberProvisioning] ✅ ${result.number} — ${result.state || areaCode}`);
        provisioned++; localProvisioned++;
        if (i < localNeeded - 1) await new Promise(r => setTimeout(r, 1500));
      } catch (err) {
        console.error(`[NumberProvisioning] ❌ Area code ${areaCode}: ${err.message}`);
        errors.push({ type: 'local', areaCode, error: err.message });
      }
    }
  }

  console.log(`[NumberProvisioning] Complete — ${provisioned}/${tollFreeNeeded + localNeeded} provisioned for ${userId} (TF ${tollFreeProvisioned}, local ${localProvisioned})`);
  return { provisioned, already_had: alreadyHad, target: total, tollFree: tollFreeProvisioned, local: localProvisioned, errors };
}

// Health math: each number safely handles this many calls/day before spam risk.
// Must match DAILY_MAX in phoneRotation.js — the enforced rotation cap.
const CALLS_PER_NUMBER_PER_DAY = 60;
// Safety clamp so a single huge import can't drain the whole shared pool at once.
const MAX_AUTO_ASSIGN = 80;

/**
 * Ensure an operator holds enough toll-free numbers to call their callable leads
 * while keeping each number healthy (≤40 calls/day). Sizes to ACTUAL callable lead
 * volume, then assigns the shortfall instantly from the shared pool.
 *
 * Pure DB + pool assignment — no Twilio/Vapi API call, so it works even when keys
 * are unavailable. Idempotent: recounts each call, only assigns what's missing.
 *
 * @param {string} userId
 * @returns {Promise<{callableLeads:number, currentNumbers:number, needed:number, shortfall:number, assigned:number, pool_remaining:number}>}
 */
async function ensureCapacity(userId) {
  const { assignFromPool } = require('./poolService');

  // 1. Count callable leads — not on DNC, has a phone number.
  const { count: callableLeads } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_on_dnc', false)
    .not('phone', 'is', null);

  const callable = callableLeads || 0;

  // 2. Count active numbers the operator already holds.
  const { count: currentNumbers } = await supabase
    .from('phone_numbers')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_active', true)
    .is('released_at', null);

  const current = currentNumbers || 0;

  // 3. Health math — numbers needed for this call volume, clamped to the safety cap.
  const needed    = Math.min(Math.ceil(callable / CALLS_PER_NUMBER_PER_DAY), MAX_AUTO_ASSIGN);
  const shortfall = Math.max(0, needed - current);

  if (shortfall === 0) {
    console.log(`[EnsureCapacity] ${userId} — ${callable} callable leads, has ${current}/${needed} numbers — no assignment needed`);
    return { callableLeads: callable, currentNumbers: current, needed, shortfall: 0, assigned: 0, pool_remaining: null };
  }

  // 4. Assign the shortfall instantly from the shared pool.
  const result = await assignFromPool(userId, shortfall);

  if (result.assigned < shortfall) {
    console.warn(`[EnsureCapacity] ${userId} — pool short: needed ${shortfall}, assigned ${result.assigned}, ${result.pool_remaining} left in pool. REFILL POOL.`);
  } else {
    console.log(`[EnsureCapacity] ${userId} — assigned ${result.assigned} number(s) for ${callable} callable leads (${result.pool_remaining} left in pool)`);
  }

  return {
    callableLeads:  callable,
    currentNumbers: current,
    needed,
    shortfall,
    assigned:       result.assigned,
    pool_remaining: result.pool_remaining,
  };
}

/**
 * Handle plan activation / upgrade
 */
async function handlePlanUpgrade(userId, newPlan) {
  try {
    const result = await provisionNumberPool(userId, newPlan);
    console.log(`[NumberProvisioning] Upgrade complete for ${userId}:`, result);
    return result;
  } catch (err) {
    console.error(`[NumberProvisioning] Upgrade failed for ${userId}:`, err.message);
    return { error: err.message };
  }
}

module.exports = {
  provisionNumberPool,
  provisionSingleNumber,
  buyLocalTwilioNumber,
  buyTollFreeTwilioNumber,
  splitNumberCounts,
  handlePlanUpgrade,
  ensureCapacity,
  PLAN_NUMBER_COUNTS,
  PLAN_TOLLFREE_COUNTS,
  STATE_AREA_CODES,
};
