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

// Numbers needed per plan
const PLAN_NUMBER_COUNTS = {
  founding_member: 3,
  starter:         3,
  growth:          6,
  pro:             12,
  scale:           23,
  enterprise:      38,
};

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

/**
 * Provision a single Vapi number with the given area code
 */
async function provisionSingleNumber(userId, areaCode, label) {
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

  // Derive state from area code for DB storage
  const numberState = Object.entries(STATE_AREA_CODES).find(([, codes]) =>
    codes.includes(String(areaCode))
  )?.[0] || null;

  await supabase.from('phone_numbers').insert([{
    id:                   uuidv4(),
    user_id:              userId,
    number:               resolvedNumber,
    friendly_name:        label,
    area_code:            String(areaCode),
    state:                numberState,
    vapi_phone_number_id: vapiNumber.id,
    health_status:        'healthy',
    is_active:            true,
    daily_call_limit:     40,
    spam_score:           100,
    purchased_at:         new Date().toISOString(),
  }]);

  return { number: resolvedNumber, state: numberState, area_code: areaCode };
}

/**
 * Provision the full number pool for a plan.
 * Numbers are geographically matched to the operator's lead distribution.
 * Safe to call multiple times — only provisions what's missing.
 */
async function provisionNumberPool(userId, plan) {
  const target = PLAN_NUMBER_COUNTS[plan];
  if (!target) {
    console.log(`[NumberProvisioning] Unknown plan: ${plan} — skipping`);
    return { provisioned: 0, already_had: 0, target: 0 };
  }

  // Count active numbers already owned
  const { count: existing } = await supabase
    .from('phone_numbers')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_active', true)
    .is('released_at', null);

  const alreadyHad = existing || 0;
  const needed     = Math.max(0, target - alreadyHad);

  if (needed === 0) {
    console.log(`[NumberProvisioning] User ${userId} already has ${alreadyHad}/${target} numbers for ${plan}`);
    return { provisioned: 0, already_had: alreadyHad, target };
  }

  console.log(`[NumberProvisioning] Provisioning ${needed} numbers for user ${userId} (${plan})`);

  // Build area code list matched to operator's lead geography
  const areaCodes = await buildAreaCodeListFromLeads(userId, needed);

  let provisioned = 0;
  const errors    = [];

  for (let i = 0; i < needed; i++) {
    const areaCode = areaCodes[i];
    const label    = `Veori Line ${alreadyHad + i + 1} (${areaCode})`;
    try {
      const result = await provisionSingleNumber(userId, areaCode, label);
      console.log(`[NumberProvisioning] ✅ ${result.number} — ${result.state || areaCode}`);
      provisioned++;
      // Stagger to avoid Vapi rate limits
      if (i < needed - 1) await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      console.error(`[NumberProvisioning] ❌ Area code ${areaCode}: ${err.message}`);
      errors.push({ areaCode, error: err.message });
    }
  }

  console.log(`[NumberProvisioning] Complete — ${provisioned}/${needed} provisioned for ${userId}`);
  return { provisioned, already_had: alreadyHad, target, errors };
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
  handlePlanUpgrade,
  ensureCapacity,
  PLAN_NUMBER_COUNTS,
  STATE_AREA_CODES,
};
