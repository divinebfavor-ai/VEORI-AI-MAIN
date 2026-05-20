/**
 * Run once to create all VEORI Stripe products and prices.
 * Usage:  node scripts/stripe-setup.js
 *
 * Paste the output into your Railway environment variables.
 */

const Stripe = require('stripe');

const KEY = process.env.STRIPE_SECRET_KEY || process.argv[2];
if (!KEY) {
  console.error('Pass your key: node scripts/stripe-setup.js sk_test_...');
  process.exit(1);
}

const stripe = Stripe(KEY);

const plans = [
  {
    env:    'STRIPE_PRICE_FOUNDING',
    name:   'VEORI Founding Operator',
    desc:   '500 AI calls/month. Rate locked at $197/month forever. All future features included free.',
    amount: 19700,
  },
  {
    env:    'STRIPE_PRICE_STANDARD',
    name:   'VEORI Standard',
    desc:   '500 AI calls/month. Standard pricing after beta closes.',
    amount: 29700,
  },
  {
    env:    'STRIPE_PRICE_GRIND',
    name:   'VEORI Grind',
    desc:   '2,000 AI calls/month.',
    amount: 69700,
  },
  {
    env:    'STRIPE_PRICE_EMPIRE',
    name:   'VEORI Empire',
    desc:   '5,000 AI calls/month.',
    amount: 149700,
  },
  {
    env:    'STRIPE_PRICE_DYNASTY',
    name:   'VEORI Dynasty',
    desc:   '15,000 AI calls/month. Enterprise multi-market.',
    amount: 499700,
  },
];

async function run() {
  console.log('\nCreating VEORI Stripe products and prices...\n');
  const results = {};

  for (const plan of plans) {
    const product = await stripe.products.create({
      name:        plan.name,
      description: plan.desc,
    });

    const price = await stripe.prices.create({
      product:     product.id,
      unit_amount: plan.amount,
      currency:    'usd',
      recurring:   { interval: 'month' },
    });

    results[plan.env] = price.id;
    console.log(`✓ ${plan.name.padEnd(28)} $${(plan.amount / 100).toFixed(0)}/mo  →  ${price.id}`);
  }

  console.log('\n\n── Copy these into Railway env vars ─────────────────────────\n');
  for (const [key, val] of Object.entries(results)) {
    console.log(`${key}=${val}`);
  }
  console.log('\nSTRIPE_SECRET_KEY=' + KEY);
  console.log('STRIPE_WEBHOOK_SECRET=<get from Stripe dashboard after adding webhook>');
  console.log('\n─────────────────────────────────────────────────────────────\n');
  console.log('Done. Now add those vars to Railway and redeploy.');
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
