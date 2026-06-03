/**
 * Number Pool Auto-Provisioning
 *
 * When an operator subscribes or upgrades, this service provisions the right
 * number of phone numbers for their plan so they can start calling immediately.
 *
 * Numbers needed per plan (based on 40 calls/number/day, 22 working days/month):
 *   Founding / Starter  (3,000 dials)  →  6 calling numbers
 *   Growth              (7,000 dials)  → 12 calling numbers
 *   Pro                (15,000 dials)  → 25 calling numbers
 *   Scale              (30,000 dials)  → 50 calling numbers
 *   Enterprise         (50,000 dials)  → 80 calling numbers
 *
 * Area codes used: diverse set covering top real estate markets so geographic
 * matching works out of the box for new operators.
 */

const axios    = require('axios');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');

// Number of calling numbers per plan
const PLAN_NUMBER_COUNTS = {
  founding_member: 6,
  starter:         6,
  growth:          12,
  pro:             25,
  scale:           50,
  enterprise:      80,
};

// Diverse area codes covering top US real estate markets
// Ordered so geographic rotation hits common markets first
const AREA_CODE_POOL = [
  // Southeast (highest wholesaling activity)
  '404', '470', '678', '770',  // Atlanta GA
  '407', '321', '689',          // Orlando FL
  '305', '786', '954', '561',  // Miami / Ft Lauderdale FL
  '704', '980',                 // Charlotte NC
  '803', '864',                 // South Carolina
  '901', '615',                 // Memphis / Nashville TN
  // Texas
  '214', '469', '972',          // Dallas TX
  '713', '832', '281',          // Houston TX
  '210', '726',                 // San Antonio TX
  // Midwest
  '313', '586',                 // Detroit MI
  '614', '380',                 // Columbus OH
  '312', '773',                 // Chicago IL
  '314', '636',                 // St Louis MO
  // Mid-Atlantic / Northeast
  '215', '267',                 // Philadelphia PA
  '443', '667',                 // Baltimore MD
  '757', '804',                 // Virginia
  // Southwest / West
  '602', '480', '623',          // Phoenix AZ
  '702', '725',                 // Las Vegas NV
  '720', '303',                 // Denver CO
];

/**
 * Provision a single Vapi number with a given area code
 */
async function provisionSingleNumber(userId, areaCode, index) {
  const vapiKey    = process.env.VAPI_API_KEY;
  const webhookUrl = process.env.VAPI_WEBHOOK_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/vapi/webhook`
      : null);

  if (!vapiKey) throw new Error('VAPI_API_KEY not configured');

  const { data: vapiNumber } = await axios.post('https://api.vapi.ai/phone-number', {
    provider:              'vapi',
    numberDesiredAreaCode: String(areaCode),
    name:                  `Veori Line ${index + 1} (${areaCode})`,
    ...(webhookUrl ? { serverUrl: webhookUrl } : {}),
  }, {
    headers:  { Authorization: `Bearer ${vapiKey}`, 'Content-Type': 'application/json' },
    timeout:  30000,
  });

  const resolvedNumber = vapiNumber.number || vapiNumber.phoneNumber || vapiNumber.id;

  // Save to DB
  await supabase.from('phone_numbers').insert([{
    id:                   uuidv4(),
    user_id:              userId,
    number:               resolvedNumber,
    friendly_name:        `Veori Line ${index + 1}`,
    area_code:            areaCode,
    vapi_phone_number_id: vapiNumber.id,
    health_status:        'healthy',
    is_active:            true,
    daily_call_limit:     40,
    spam_score:           100,
    purchased_at:         new Date().toISOString(),
    is_primary:           index === 0,
  }]);

  return resolvedNumber;
}

/**
 * Provision the full number pool for a plan.
 * Only provisions numbers up to the plan target — never removes existing ones.
 * Safe to call multiple times (idempotent).
 */
async function provisionNumberPool(userId, plan) {
  const target = PLAN_NUMBER_COUNTS[plan];
  if (!target) {
    console.log(`[NumberProvisioning] Unknown plan: ${plan} — skipping`);
    return { provisioned: 0, already_had: 0, target: 0 };
  }

  // Count how many active numbers the user already has
  const { count: existing } = await supabase
    .from('phone_numbers')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_active', true)
    .is('released_at', null);

  const alreadyHad = existing || 0;
  const needed     = Math.max(0, target - alreadyHad);

  if (needed === 0) {
    console.log(`[NumberProvisioning] User ${userId} already has ${alreadyHad} numbers (plan: ${plan}, target: ${target})`);
    return { provisioned: 0, already_had: alreadyHad, target };
  }

  console.log(`[NumberProvisioning] Provisioning ${needed} numbers for user ${userId} (plan: ${plan})`);

  let provisioned = 0;
  const errors    = [];

  // Rotate through area codes — spread numbers across markets
  for (let i = 0; i < needed; i++) {
    const areaCode = AREA_CODE_POOL[i % AREA_CODE_POOL.length];
    try {
      const num = await provisionSingleNumber(userId, areaCode, alreadyHad + i);
      console.log(`[NumberProvisioning] ✅ Provisioned ${num} (${areaCode})`);
      provisioned++;
      // Stagger provisioning — avoid hitting Vapi rate limits
      if (i < needed - 1) await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      console.error(`[NumberProvisioning] ❌ Failed to provision number ${i + 1} (area code ${areaCode}):`, err.message);
      errors.push({ areaCode, error: err.message });
    }
  }

  console.log(`[NumberProvisioning] Done — ${provisioned}/${needed} provisioned for user ${userId}`);
  return { provisioned, already_had: alreadyHad, target, errors };
}

/**
 * Handle plan upgrade — provision additional numbers to meet new plan target
 */
async function handlePlanUpgrade(userId, newPlan) {
  try {
    const result = await provisionNumberPool(userId, newPlan);
    console.log(`[NumberProvisioning] Plan upgrade complete for ${userId}:`, result);
    return result;
  } catch (err) {
    console.error(`[NumberProvisioning] Upgrade failed for ${userId}:`, err.message);
    return { error: err.message };
  }
}

module.exports = {
  provisionNumberPool,
  handlePlanUpgrade,
  PLAN_NUMBER_COUNTS,
};
