// ─── Wealth Playbook Service ───────────────────────────────────────────────────
const Anthropic = require('@anthropic-ai/sdk');
const supabase  = require('../config/supabase');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Strategy content library ─────────────────────────────────────────────────
const STRATEGIES = {
  heloc_ladder: {
    id: 'heloc_ladder',
    name: 'The HELOC Ladder',
    tag: 'BEGINNER',
    risk_level: 'MEDIUM',
    estimated_timeline: '3–6 months to access capital',
    potential_return: '$162–$680+/month cash flow per property',
    headline: 'Turn the equity sitting in your home into a rental property portfolio',
    what_it_is: 'A Home Equity Line of Credit lets you borrow against the equity you\'ve already built in your home. You pay interest only on what you draw. The money can be used to fund down payments on investment properties, wholesale deal earnest money, or renovation costs.',
    how_it_works: [
      { step: 1, title: 'Calculate Your Available Equity', detail: 'Take your home value minus your mortgage balance. Most lenders let you borrow up to 80–85% of your home value.' },
      { step: 2, title: 'Apply for a HELOC', detail: 'Apply with a bank or credit union. You typically need a credit score above 680, at least 20% equity remaining after the HELOC, and a debt-to-income ratio below 43%.' },
      { step: 3, title: 'Fund Your Down Payment', detail: 'Draw from your HELOC to fund the down payment on an investment property — typically 20–25% of the purchase price.' },
      { step: 4, title: 'Finance the Remainder', detail: 'Finance the remaining 75–80% with a conventional investment property loan or DSCR loan.' },
      { step: 5, title: 'Repeat the Cycle', detail: 'Use rental income from the investment property to pay down the HELOC. Repeat with the next property.' },
    ],
    real_example: 'Home value $320,000. Mortgage balance $200,000. Available equity $120,000. HELOC at 80% LTV gives $56,000 available credit. Uses $45,000 as down payment on a $220,000 Memphis rental. Finances remaining $175,000 at 7.5% on a 30-year loan. Monthly mortgage payment $1,224. Monthly rent $1,650. Monthly HELOC interest on $45,000 at 7.04% equals $264. Monthly cash flow after both payments equals $162. Property appreciation over 5 years at 4% annually adds $48,000 in equity.',
    veori_connection: 'Veori Acquire finds the investment property. Veori Lending connects to HELOC and investment property lenders. Veori Tenant places and manages the tenant. The entire pipeline runs automatically.',
    risks: ['HELOC rates are variable — rising rates increase your carrying cost', 'Your home is collateral — default risk if rental income drops', 'Requires sufficient equity and strong credit score', 'Investment property loans require larger down payments than primary residence loans'],
    action_label: 'Find Properties to Fund with Your HELOC',
    action_path: '/pipeline',
    veori_products: ['Veori Acquire', 'Veori Lending', 'Veori Tenant'],
  },
  brrrr_method: {
    id: 'brrrr_method',
    name: 'The BRRRR Method',
    tag: 'INTERMEDIATE',
    risk_level: 'HIGH',
    estimated_timeline: '6–18 months per cycle',
    potential_return: '$334+/month cash flow + original capital recycled',
    headline: 'Buy distressed, force equity, recycle your capital — repeat until wealthy',
    what_it_is: 'Buy, Rehab, Rent, Refinance, Repeat. The method professional investors use to build large portfolios with limited starting capital. You buy distressed below market, renovate to increase value, rent to generate income, then refinance at the new higher value to pull your original capital back out.',
    how_it_works: [
      { step: 1, title: 'Find a Distressed Property', detail: 'Target properties where the after-repair value is at least 1.4x the purchase price plus renovation cost.' },
      { step: 2, title: 'Renovate Strategically', detail: 'Focus on kitchens, bathrooms, flooring, and curb appeal. These generate the highest value increase per dollar spent.' },
      { step: 3, title: 'Place a Tenant', detail: 'Get the property cash flowing at market rent before the refinance.' },
      { step: 4, title: 'Cash-Out Refinance', detail: 'Refinance at 75–80% of the new appraised value. If the numbers work you pull out most or all of your original capital.' },
      { step: 5, title: 'Repeat', detail: 'Take the pulled capital and repeat the process on the next property.' },
    ],
    real_example: 'Purchase price $85,000. Renovation cost $25,000. Total invested $110,000. After repair value $165,000. Refinance at 75% of $165,000 equals $123,750. Capital returned $123,750 minus $110,000 equals $13,750 pulled out plus original capital back. Monthly rent $1,200. Monthly mortgage on $123,750 at 7.5% $866. Monthly cash flow $334.',
    veori_connection: 'Veori Acquire finds the distressed property and negotiates the purchase. Veori Develop coordinates the renovation. Veori Tenant places the renter. Veori Lending handles the refinance.',
    risks: ['Renovation costs frequently exceed estimates', 'Refinance appraisal may come in below expectations', 'Requires significant upfront capital and credit for the purchase and rehab', 'Construction timelines create holding costs'],
    action_label: 'Find a BRRRR Candidate',
    action_path: '/leads',
    veori_products: ['Veori Acquire', 'Veori Develop', 'Veori Tenant', 'Veori Lending'],
  },
  debt_snowball: {
    id: 'debt_snowball',
    name: 'Debt Snowball into Real Estate',
    tag: 'BEGINNER',
    risk_level: 'LOW',
    estimated_timeline: '12–36 months',
    potential_return: '$365+/month passive income after 36 months',
    headline: 'Convert your debt payments into real estate income — dollar by dollar',
    what_it_is: 'Use a low-rate HELOC or personal loan to pay off high-interest debt. The monthly savings from lower interest payments go directly into real estate investment. Over time debt converts to wealth.',
    how_it_works: [
      { step: 1, title: 'List All Debts with Interest Rates', detail: 'Credit cards often charge 20–28%. Personal loans 12–18%.' },
      { step: 2, title: 'Consolidate with Lower-Rate Debt', detail: 'If you own a home, use a HELOC at 7–9% to pay off the highest-rate debt first. The interest rate reduction is immediate.' },
      { step: 3, title: 'Calculate Monthly Savings', detail: 'If you were paying $800/month on credit cards at 24% and now pay $350/month on a HELOC at 7%, you save $450/month.' },
      { step: 4, title: 'Invest the Difference', detail: 'Invest that $450/month directly into Veori Credits. At 15–25% annual returns that $450 monthly grows significantly over time.' },
      { step: 5, title: 'Scale into Direct Property', detail: 'As the HELOC is paid down, use the freed-up credit to fund direct property investments.' },
    ],
    real_example: '$25,000 in credit card debt at 22% average. Monthly minimum payments $750. Refinanced into HELOC at 7.04%. New monthly payment $291. Monthly savings $459. Invest $459/month into Veori Credits at 20% annual return. After 36 months Veori Credits balance is approximately $22,000 generating roughly $365/month in passive income.',
    veori_connection: 'Veori Lending connects users to HELOC and debt consolidation lenders. Veori Credits receives the monthly investment automatically. The Wealth Playbook tracks debt reduction and portfolio growth in one dashboard.',
    risks: ['Requires discipline to actually invest the savings rather than spend them', 'Variable HELOC rates can increase over time', 'Puts home equity at risk if income changes'],
    action_label: 'Start Investing Monthly in Deals',
    action_path: '/marketplace',
    veori_products: ['Veori Lending', 'Veori Credits'],
  },
  subject_to: {
    id: 'subject_to',
    name: 'Subject-To Acquisition',
    tag: 'ADVANCED',
    risk_level: 'MEDIUM',
    estimated_timeline: '30–90 days per deal',
    potential_return: '$476+/month extra cash flow from below-market financing',
    headline: 'Acquire properties with 3% mortgages that no longer exist at any bank',
    what_it_is: 'Buying a property subject to the existing mortgage means you take ownership while the seller\'s mortgage stays in place. You make the payments on their loan. This is how investors access 3–4% mortgages from 2020–2021 that would be impossible to get today.',
    how_it_works: [
      { step: 1, title: 'Find a Motivated Seller with a Favorable Mortgage', detail: 'Look for sellers who need to sell quickly and have an assumable mortgage with a favorable rate.' },
      { step: 2, title: 'Negotiate the Subject-To Agreement', detail: 'The seller deeds the property to you. The mortgage stays in their name but you make the payments.' },
      { step: 3, title: 'Document Everything Properly', detail: 'Any default affects the seller\'s credit, so this arrangement requires trust and proper legal documentation.' },
      { step: 4, title: 'Rent at Market Rate', detail: 'The difference between the below-market mortgage payment and market rent is your cash flow.' },
      { step: 5, title: 'Exit When Ready', detail: 'Refinance into your own loan when rates improve or sell the property at a profit.' },
    ],
    real_example: 'Seller has a $180,000 mortgage at 3.25% from 2021. Monthly payment $783. Current market rent $1,500. Monthly cash flow before expenses $717. To get a new loan today at 7.5% on $180,000 the payment would be $1,259. Subject-to saves $476/month in financing costs. Over 5 years that is $28,560 in additional cash flow from the favorable financing alone.',
    veori_connection: 'Veori Acquire\'s AI identifies motivated sellers with favorable existing mortgages and flags them automatically. Veori Title handles the transfer documentation. Veori Tenant manages the rental.',
    risks: ['Due-on-sale clause — lenders can technically call the loan due upon transfer', 'Seller\'s credit at risk if you miss payments', 'Complex legal documentation required', 'Requires experienced real estate attorney'],
    action_label: 'Find Motivated Sellers',
    action_path: '/leads',
    veori_products: ['Veori Acquire', 'Veori Title', 'Veori Tenant'],
  },
  exchange_1031: {
    id: 'exchange_1031',
    name: 'The 1031 Exchange Autopilot',
    tag: 'INTERMEDIATE',
    risk_level: 'LOW',
    estimated_timeline: '45 days to identify, 180 days to close',
    potential_return: '$26,000+ in deferred taxes reinvested and compounding',
    headline: 'Never pay capital gains taxes again — roll profits into bigger properties forever',
    what_it_is: 'When you sell an investment property you normally pay capital gains tax of 15–20% or more on your profit. A 1031 exchange lets you defer that entire tax bill by reinvesting into another like-kind property within 180 days. Wealthy investors use this to compound their portfolio indefinitely.',
    how_it_works: [
      { step: 1, title: 'Set Up a Qualified Intermediary Before Selling', detail: 'Notify a neutral third party who will hold the sale proceeds. This must happen before the sale closes.' },
      { step: 2, title: 'Close the Sale — Proceeds Go to the Intermediary', detail: 'The moment proceeds go to you personally, the tax deferral is lost.' },
      { step: 3, title: 'Identify Replacement Properties Within 45 Days', detail: 'You can identify up to three potential replacement properties in writing.' },
      { step: 4, title: 'Close on a Replacement Within 180 Days', detail: 'Use the held proceeds to close on one of the identified properties.' },
      { step: 5, title: 'Repeat', detail: 'The capital gains tax defers to the future sale, where you can do another 1031.' },
    ],
    real_example: 'Sell a rental property for $280,000 with a cost basis of $150,000. Capital gain $130,000. Tax at 20% would be $26,000. With 1031 exchange the full $280,000 goes into a replacement property. The $26,000 that would have gone to taxes stays invested and compounding. Over 10 years at 7% annual appreciation that $26,000 becomes $51,000 of additional equity.',
    veori_connection: 'Veori monitors every property in a user\'s portfolio and alerts them before any planned sale that they may qualify for a 1031 exchange. Veori\'s AI immediately begins identifying replacement properties that meet the user\'s criteria. The 45-day identification deadline is tracked automatically.',
    risks: ['Strict 45-day and 180-day deadlines — missing them is catastrophic', 'Must use a qualified intermediary — you cannot touch the proceeds', 'Replacement property must be like-kind (real estate to real estate)', 'Not applicable to primary residences'],
    action_label: 'View Your Deal Pipeline',
    action_path: '/pipeline',
    veori_products: ['Veori Acquire', 'Veori Title'],
  },
  dscr_loan: {
    id: 'dscr_loan',
    name: 'The DSCR Loan Portfolio Builder',
    tag: 'INTERMEDIATE',
    risk_level: 'MEDIUM',
    estimated_timeline: '30–60 days per property',
    potential_return: '$311+/month per property — scalable to 10+ properties',
    headline: 'Build a rental portfolio without W2s or tax returns getting in your way',
    what_it_is: 'Debt Service Coverage Ratio loans qualify based on the property\'s rental income rather than the borrower\'s personal income. This is how investors with complex tax situations or multiple properties keep buying when traditional lenders say no.',
    how_it_works: [
      { step: 1, title: 'Find a High-DSCR Property', detail: 'The DSCR ratio is monthly rent ÷ monthly mortgage payment. Most lenders want a DSCR of 1.25 or higher.' },
      { step: 2, title: 'Apply for a DSCR Loan', detail: 'No W2 or tax return verification required. The lender evaluates the property\'s income, not your personal income.' },
      { step: 3, title: 'Close and Rent', detail: 'The rental income services the debt. Property selected correctly = positive cash flow from day one.' },
      { step: 4, title: 'Repeat Without Hitting DTI Limits', detail: 'Because DSCR loans don\'t count against personal debt-to-income ratios the way conventional loans do, investors can acquire many more properties.' },
    ],
    real_example: 'Purchase price $150,000. Down payment 20% = $30,000. Loan $120,000 at 7.5%. Monthly payment $839. Monthly market rent $1,150. DSCR = $1,150 ÷ $839 = 1.37. Qualifies comfortably. Monthly cash flow $311. Repeat this model 10 times building $3,110/month in passive cash flow across the portfolio.',
    veori_connection: 'Veori Acquire identifies high-DSCR properties automatically by analyzing rental income data against purchase prices in every market. Veori Lending connects operators to the best DSCR lenders. The entire underwriting analysis runs automatically on every deal.',
    risks: ['Typically requires 20–25% down payment', 'Interest rates slightly higher than conventional loans', 'Property must actually qualify — low-rent areas may not meet 1.25 DSCR threshold', 'Requires property management discipline'],
    action_label: 'Find High-DSCR Properties',
    action_path: '/leads',
    veori_products: ['Veori Acquire', 'Veori Lending', 'Veori Tenant'],
  },
  wholesale_entry: {
    id: 'wholesale_entry',
    name: 'Wholesale Entry — Your First Assignment Fee',
    tag: 'BEGINNER',
    risk_level: 'LOW',
    estimated_timeline: '30–60 days for first deal',
    potential_return: '$5,000–$20,000 per deal, no money down',
    headline: 'Earn $5,000–$20,000 per deal with no money, no credit, and no property ownership',
    what_it_is: 'Wholesale real estate requires no money down and no credit check. You find a motivated seller, put the property under contract at a below-market price, and sell your contract to a cash buyer for a fee. You never own the property. You never get a loan.',
    how_it_works: [
      { step: 1, title: 'Veori Finds Motivated Sellers Automatically', detail: 'AI finds sellers from public records — pre-foreclosure, tax delinquent, absentee owners.' },
      { step: 2, title: 'AI Calls and Qualifies the Seller', detail: 'The AI agent calls them, qualifies their motivation, and negotiates an offer.' },
      { step: 3, title: 'Contract is Generated Automatically', detail: 'The seller accepts and Veori generates the purchase contract automatically.' },
      { step: 4, title: 'Match to a Cash Buyer', detail: 'Veori matches the contract to cash buyers in its buyer pool and contacts the best-matched buyers automatically.' },
      { step: 5, title: 'Collect Your Assignment Fee', detail: 'The buyer pays the assignment fee to take over the contract. You collect $5,000–$20,000 without ever owning the property.' },
    ],
    real_example: 'Motivated seller accepts $120,000 for a property worth $175,000 after repairs. Cash buyer agrees to $135,000 assignment price. Assignment fee $15,000. Veori transaction fee 1% = $1,500. Net to operator $13,500. Time from lead to close: 18 days. No money required. No credit check. No loan. Just execution.',
    veori_connection: 'This is the core Veori Acquire product. Every step runs automatically. The operator\'s job is to review the deal analysis and approve the offer.',
    risks: ['Assignment fees vary widely by market and deal', 'Requires building a buyer pool or using Veori\'s existing buyers', 'Some states have specific wholesale licensing requirements — check compliance', 'Income is irregular — not passive'],
    action_label: 'Start Your First Campaign',
    action_path: '/campaigns',
    veori_products: ['Veori Acquire', 'Veori Title'],
  },
  credits_investing: {
    id: 'credits_investing',
    name: 'Veori Credits Passive Investing',
    tag: 'BEGINNER',
    risk_level: 'LOW',
    estimated_timeline: 'First returns within 30 days of deals closing',
    potential_return: '47%+ annualized return on invested capital',
    headline: 'Invest as little as $100 and earn from real estate deals without doing any work',
    what_it_is: 'Invest in Veori\'s wholesale deal flow without doing any deals yourself. Your capital funds earnest money deposits and deal costs across multiple simultaneous deals. When deals close you earn a proportional share of the assignment fees.',
    how_it_works: [
      { step: 1, title: 'Deposit into Veori Credits', detail: 'Minimum $100. Your capital is immediately put to work.' },
      { step: 2, title: 'Veori Allocates Automatically', detail: 'Veori automatically allocates your capital across multiple active deals simultaneously.' },
      { step: 3, title: 'Deals Close — You Get Paid', detail: 'When deals close your proportional share of the profit is deposited to your account.' },
      { step: 4, title: 'Reinvest or Withdraw', detail: 'Your choice — compound your returns or withdraw anytime.' },
    ],
    real_example: '$5,000 in Veori Credits. Veori allocates across 10 active deals. 8 of 10 deals close in 45 days generating an average $12,000 assignment fee each. Total deal profit $96,000. Platform keeps 40% ($38,400). Investors split 60% ($57,600) proportionally. $5,000 investment represents 0.5% of total investor pool. Return $288 in 45 days. Annualized return approximately 47%.',
    veori_connection: 'This is the Veori Credits product built directly into the platform. Automatic allocation. Automatic distribution. Full transparency on every deal in the pool.',
    risks: ['Returns depend on deal volume and success rate', 'Not FDIC insured — real estate investment risk', 'Deal timelines vary — not a fixed-return product', 'Liquidity depends on deal cycle completion'],
    action_label: 'Start Investing in Deals',
    action_path: '/marketplace',
    veori_products: ['Veori Credits'],
  },
  shared_equity: {
    id: 'shared_equity',
    name: 'Shared Equity Homeownership',
    tag: 'BEGINNER',
    risk_level: 'LOW',
    estimated_timeline: '30–90 days to get into a home',
    potential_return: '$85,000+ in equity in 5 years on a small initial investment',
    headline: 'Own your first home today even if you don\'t have the full down payment',
    what_it_is: 'For renters who want to own a home but cannot afford a full down payment. Veori Credits investors fund the down payment gap. The aspiring homeowner moves in today and gradually buys out the investors\' stake over time as equity grows.',
    how_it_works: [
      { step: 1, title: 'Identify Your Target Home', detail: 'Find a property you want to own but cannot fully fund the down payment for.' },
      { step: 2, title: 'Veori Structures the Shared Equity Deal', detail: 'Buyer funds what they can. Veori Credits investors fund the gap.' },
      { step: 3, title: 'Move In and Start Building Equity', detail: 'Buyer moves in. Makes monthly payments covering their mortgage portion plus a return to the investors.' },
      { step: 4, title: 'Buy Out Investors Over Time', detail: 'As equity grows through appreciation and paydown, the homeowner gradually buys out the investors\' stake.' },
      { step: 5, title: 'Own 100% of Your Home', detail: 'When fully bought out, the homeowner owns 100% of the property and all its equity.' },
    ],
    real_example: 'Home price $220,000. Down payment needed $44,000. Buyer has $15,000 saved. Gap $29,000 funded by Veori Credits investors. Buyer\'s monthly payment includes mortgage payment plus $290/month to investors (8% annual return on their $29,000). After 5 years of appreciation the home is worth $265,000. Buyer refinances, pays off investors, and owns 100% equity of $265,000 with a $180,000 mortgage. Net equity $85,000.',
    veori_connection: 'Veori identifies the property. Veori Lending structures the financing. Veori Credits investors fund the gap. All automated.',
    risks: ['Monthly payments are higher than renting initially', 'If home value drops, buyout becomes harder', 'Investors share in appreciation — you give up some upside', 'Complex legal agreements required'],
    action_label: 'Explore Homeownership Options',
    action_path: '/marketplace',
    veori_products: ['Veori Lending', 'Veori Credits', 'Veori Title'],
  },
  land_banking: {
    id: 'land_banking',
    name: 'Land Banking',
    tag: 'INTERMEDIATE',
    risk_level: 'MEDIUM',
    estimated_timeline: '3–10 years for full return',
    potential_return: '296%+ over 7 years (22% annualized)',
    headline: 'Buy land cheap today where the city is growing — sell to developers at multiples',
    what_it_is: 'Buy raw or underdeveloped land in the path of growth at today\'s prices. Hold it while the surrounding area develops. Sell at multiples of your original purchase price when development reaches you.',
    how_it_works: [
      { step: 1, title: 'Identify Growth Markets', detail: 'Find markets where population is growing faster than available developed land. Look for areas 10–30 miles from major city centers along infrastructure corridors.' },
      { step: 2, title: 'Purchase Raw Land', detail: 'Buy raw land in those areas at today\'s prices. Raw land costs a fraction of developed property.' },
      { step: 3, title: 'Hold with Minimal Carrying Costs', detail: 'Carrying costs are typically just property taxes — very low compared to improved properties.' },
      { step: 4, title: 'Sell or Develop When Ready', detail: 'As development approaches, either sell to a developer at a significant profit or partner with Veori Develop to develop the land yourself.' },
    ],
    real_example: 'Purchase 5 acres of raw land on the outskirts of a growing metro for $80,000. Annual property tax $1,200. Hold for 7 years as the area develops. Land now worth $350,000. Total invested $80,000 + $8,400 in taxes = $88,400. Profit $261,600. Return 296% over 7 years or approximately 22% annualized.',
    veori_connection: 'Veori Develop\'s AI scans land parcels across all US markets nightly, identifying growth corridors and undervalued land. When Veori flags a land banking opportunity the user can invest through Veori Credits for fractional participation or purchase directly through Veori Acquire.',
    risks: ['Long holding periods — illiquid investment', 'Development may not arrive on expected timeline', 'Zoning changes can work for or against you', 'No cash flow while holding — only appreciation'],
    action_label: 'Explore Land Opportunities',
    action_path: '/leads',
    veori_products: ['Veori Acquire', 'Veori Develop', 'Veori Credits'],
  },
};

// ─── AI Playbook Generation ────────────────────────────────────────────────────
async function generatePlaybook(assessment) {
  const { home_ownership, equity_position, debt_situation, real_estate_goal, experience_level } = assessment;

  const systemPrompt = `You are the Veori Wealth Playbook AI. Based on the user's assessment answers, generate a personalized real estate wealth-building plan.

Return ONLY a valid JSON object with this exact structure (no markdown, no explanation):
{
  "headline": "One powerful sentence describing their wealth path",
  "summary": "Two to three sentences explaining their specific situation and opportunity",
  "primary_strategy": "the strategy id that is most important for them right now",
  "strategy_ids": ["array", "of", "3-6", "strategy", "ids", "in", "priority", "order"],
  "wealth_projection": {
    "year_1": "What their financial position looks like in 1 year using these strategies",
    "year_3": "What their financial position looks like in 3 years",
    "year_5": "What their financial position looks like in 5 years",
    "key_assumption": "The main assumption behind these projections"
  },
  "first_action": "The single most important thing they should do in the next 7 days — specific and actionable"
}

Available strategy IDs: heloc_ladder, brrrr_method, debt_snowball, subject_to, exchange_1031, dscr_loan, wholesale_entry, credits_investing, shared_equity, land_banking

Selection rules:
- homeowners with equity: always include heloc_ladder
- users with significant debt: always include debt_snowball first
- beginners: include wholesale_entry and/or credits_investing
- renters: include shared_equity and credits_investing
- experienced investors: include brrrr_method, subject_to, exchange_1031
- portfolio builders: include dscr_loan
- always include at least one strategy the user can start immediately
- include 3-6 strategies total, prioritized for their situation

IMPORTANT: Never give specific financial advice. Results vary. Always recommend consulting a financial advisor.`;

  const userPrompt = `Assessment answers:
- Home ownership: ${home_ownership}
- Equity/Income position: ${equity_position}
- Debt situation: ${debt_situation}
- Real estate goal: ${real_estate_goal}
- Experience level: ${experience_level}

Generate their personalized Veori Wealth Playbook.`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const raw = response.content[0].text.trim();
    const parsed = JSON.parse(raw);

    // Enrich with full strategy content from our library
    const strategies = (parsed.strategy_ids || [])
      .filter(id => STRATEGIES[id])
      .map((id, index) => ({
        ...STRATEGIES[id],
        priority: index + 1,
      }));

    return {
      headline: parsed.headline,
      summary: parsed.summary,
      primary_strategy: parsed.primary_strategy,
      strategies,
      wealth_projection: parsed.wealth_projection,
      first_action: parsed.first_action,
    };
  } catch (err) {
    console.error('[WealthService] AI generation failed, using fallback:', err.message);
    return generateFallbackPlaybook(assessment);
  }
}

function generateFallbackPlaybook(assessment) {
  const isHomeowner = assessment.home_ownership !== 'No I rent';
  const isBeginner  = assessment.experience_level === 'Complete beginner' || assessment.experience_level === 'I understand the basics';
  const hasDebt     = assessment.debt_situation?.includes('Significant debt') || assessment.debt_situation?.includes('Some credit card');

  let strategyIds = [];
  if (hasDebt)       strategyIds.push('debt_snowball');
  if (isHomeowner)   strategyIds.push('heloc_ladder');
  if (isBeginner)    strategyIds.push('wholesale_entry', 'credits_investing');
  if (!isHomeowner)  strategyIds.push('shared_equity', 'credits_investing');
  if (!isBeginner)   strategyIds.push('brrrr_method', 'dscr_loan');
  strategyIds = [...new Set(strategyIds)].slice(0, 5);

  return {
    headline: isHomeowner
      ? 'Your home equity is the foundation — let\'s turn it into a portfolio'
      : 'Start with zero money down and build your wealth one deal at a time',
    summary: `Based on your situation, you have real pathways to building wealth through real estate${isHomeowner ? ' starting with the equity already in your home' : ' starting with no money required'}. ${isBeginner ? 'We\'ll start with strategies that require no experience and no large capital commitment.' : 'Your experience puts you in position to accelerate with proven portfolio-building strategies.'} Veori automates the execution so you can focus on growing.`,
    primary_strategy: strategyIds[0],
    strategies: strategyIds.filter(id => STRATEGIES[id]).map((id, i) => ({ ...STRATEGIES[id], priority: i + 1 })),
    wealth_projection: {
      year_1: 'First income streams established — $300–$1,500/month depending on strategy selected and execution speed',
      year_3: 'Portfolio of 2–5 assets generating $1,500–$5,000/month in passive income',
      year_5: 'Established investment operation with $5,000–$15,000/month in passive income and growing equity',
      key_assumption: 'Consistent execution of at least one strategy per quarter using Veori\'s automated platform',
    },
    first_action: isBeginner
      ? 'Complete the Veori onboarding and launch your first AI-powered seller outreach campaign this week — your first deal could close within 30 days'
      : 'Run your numbers through the Wealth Calculator and identify the single highest-ROI move available to you right now based on your current capital and credit',
  };
}

// ─── Wealth Score ─────────────────────────────────────────────────────────────
const SCORE_ACTIONS = {
  assessment_completed:    10,
  strategy_read:           5,
  calculator_completed:    10,
  campaign_launched:       20,
  credits_invested:        15,
  deal_closed:             30,
  heloc_strategy_executed: 20,
  exchange_1031_executed:  25,
};

const SCORE_TIERS = [
  { min: 76, max: 100, name: 'Elite',    description: 'Institutional deal flow and Veori Intelligence data' },
  { min: 51, max: 75,  name: 'Investor', description: 'Advanced strategies and priority buyer matching' },
  { min: 26, max: 50,  name: 'Builder',  description: 'Deal analysis tools and basic Credits' },
  { min: 0,  max: 25,  name: 'Learner',  description: 'All educational content' },
];

function getTier(score) {
  return SCORE_TIERS.find(t => score >= t.min && score <= t.max) || SCORE_TIERS[3];
}

async function getOrCreateScore(userId) {
  const { data: existing } = await supabase
    .from('wealth_scores')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (existing) return existing;

  const { data: created } = await supabase
    .from('wealth_scores')
    .insert({ user_id: userId, score: 0, score_tier: 'Learner', actions_completed: [] })
    .select()
    .single();

  return created;
}

async function updateScore(userId, actionType) {
  const points = SCORE_ACTIONS[actionType];
  if (!points) return null;

  const current = await getOrCreateScore(userId);
  const actions = current.actions_completed || [];

  // Prevent duplicate scoring for one-time actions (except strategy_read which can be done per strategy)
  const oneTimeActions = ['assessment_completed', 'calculator_completed', 'deal_closed', 'credits_invested', 'campaign_launched'];
  if (oneTimeActions.includes(actionType) && actions.includes(actionType)) return current;

  const newScore   = Math.min(100, (current.score || 0) + points);
  const tier       = getTier(newScore);
  const newActions = [...actions, actionType];

  const { data: updated } = await supabase
    .from('wealth_scores')
    .update({ score: newScore, score_tier: tier.name, actions_completed: newActions, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .select()
    .single();

  return updated;
}

// ─── Elite Moves Feed ─────────────────────────────────────────────────────────
const EXAMPLE_FEED = [
  { user_initials: 'MJ', user_city: 'Charlotte', user_state: 'NC', strategy_used: 'Wholesale Entry', result_description: 'Earned $14,200 on their first wholesale deal using Veori\'s AI campaign system.', days_to_result: 23, is_example: true },
  { user_initials: 'AT', user_city: 'Atlanta', user_state: 'GA', strategy_used: 'Veori Credits', result_description: 'Invested $2,500 and received their first $180 distribution.', days_to_result: 38, is_example: true },
  { user_initials: 'SK', user_city: 'Memphis', user_state: 'TN', strategy_used: 'HELOC Ladder', result_description: 'Used home equity to fund a down payment on a rental property now generating $680/month cash flow.', days_to_result: 52, is_example: true },
  { user_initials: 'RD', user_city: 'Jacksonville', user_state: 'FL', strategy_used: 'Shared Equity', result_description: 'Purchased their first home after 6 years of renting using the shared equity program.', days_to_result: 67, is_example: true },
  { user_initials: 'TW', user_city: 'Phoenix', user_state: 'AZ', strategy_used: 'BRRRR Method', result_description: 'Recycled $110,000 in capital across 3 BRRRR deals, now holds $495,000 in properties.', days_to_result: 180, is_example: true },
  { user_initials: 'LP', user_city: 'Dallas', user_state: 'TX', strategy_used: 'DSCR Loan', result_description: 'Closed on their 4th rental property using DSCR financing — $1,244/month total cash flow.', days_to_result: 45, is_example: true },
];

// ─── Calculator ───────────────────────────────────────────────────────────────
function calculateProjections(inputs) {
  const { home_value, mortgage_balance, monthly_income, monthly_expenses, current_savings, monthly_investment, investment_goal } = inputs;

  const equity          = Math.max(0, (home_value || 0) - (mortgage_balance || 0));
  const heloc_potential = Math.max(0, (home_value || 0) * 0.8 - (mortgage_balance || 0));
  const disposable      = Math.max(0, (monthly_income || 0) - (monthly_expenses || 0));
  const actualMonthly   = monthly_investment || Math.round(disposable * 0.2);

  // Veori scenario — compound at 20% annual on Credits + property appreciation
  const veoriYear1  = actualMonthly * 12 * 1.20;
  const veoriYear3  = actualMonthly * 36 * 1.20 + (current_savings || 0) * Math.pow(1.20, 3);
  const veoriYear5  = actualMonthly * 60 * 1.20 + (current_savings || 0) * Math.pow(1.20, 5);
  const veoriIncome1 = Math.round(veoriYear1 * 0.015);
  const veoriIncome3 = Math.round(veoriYear3 * 0.015);
  const veoriIncome5 = Math.round(veoriYear5 * 0.015);

  // Savings scenario — 4% APY
  const savingsYear1 = actualMonthly * 12 * 1.04;
  const savingsYear3 = actualMonthly * 36 * 1.04 + (current_savings || 0) * Math.pow(1.04, 3);
  const savingsYear5 = actualMonthly * 60 * 1.04 + (current_savings || 0) * Math.pow(1.04, 5);

  // Monthly income timeline (60 months)
  const income_timeline = Array.from({ length: 60 }, (_, i) => {
    const month = i + 1;
    const portfolio = actualMonthly * month * Math.pow(1.20, month / 12);
    return { month, income: Math.round(portfolio * 0.015) };
  });

  let first_move = 'Start by investing $' + actualMonthly + '/month into Veori Credits to put your savings to work immediately.';
  if (heloc_potential > 20000) first_move = `You have $${Math.round(heloc_potential).toLocaleString()} in HELOC potential. Apply this week and use it as a down payment on your first investment property.`;
  else if ((current_savings || 0) > 10000) first_move = `You have $${(current_savings || 0).toLocaleString()} in savings. Deploy $${Math.min(5000, current_savings).toLocaleString()} into Veori Credits this week to start earning passive income.`;

  return {
    heloc_potential: Math.round(heloc_potential),
    equity: Math.round(equity),
    veori: { year1: Math.round(veoriYear1), year3: Math.round(veoriYear3), year5: Math.round(veoriYear5), income1: veoriIncome1, income3: veoriIncome3, income5: veoriIncome5 },
    savings: { year1: Math.round(savingsYear1), year3: Math.round(savingsYear3), year5: Math.round(savingsYear5) },
    income_timeline,
    first_move,
    monthly_investment: actualMonthly,
  };
}

module.exports = { generatePlaybook, updateScore, getOrCreateScore, getTier, calculateProjections, STRATEGIES, SCORE_ACTIONS, EXAMPLE_FEED };
