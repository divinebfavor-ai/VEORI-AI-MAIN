const express  = require('express');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ─── Lesson catalog ────────────────────────────────────────────────────────────
const LESSONS = [
  // ── SECTION 1: Foundations ─────────────────────────────────────────────────
  {
    id: 'lesson-01', order: 1, section: 'Foundations of Real Estate Wealth', difficulty: 'beginner',
    title: 'How Real Estate Builds Wealth',
    body: 'Real estate is one of the most proven vehicles for building long-term wealth. Unlike stocks, it produces multiple income streams simultaneously: appreciation (value growth), cash flow (rental income), tax advantages (depreciation, 1031 exchanges), and equity buildup (tenants pay down your mortgage). Even a single property purchased correctly can change a family\'s financial trajectory.',
    takeaways: ['Real estate generates 4 streams of return simultaneously', 'Leverage (using borrowed money) amplifies returns', 'Time in the market beats timing the market — start small, scale'],
    example: 'A $150,000 rental property purchased with 20% down ($30,000) generates $600/month net cash flow and appreciates 4%/year. After 10 years: $66,000 in appreciation + $72,000 in cash flow = $138,000 return on a $30,000 investment.',
    quiz: { question: 'Which is NOT one of the four wealth streams in real estate?', options: ['Appreciation', 'Cash flow', 'Stock dividends', 'Tax advantages'], answer: 2 },
    section_link: '/calculator', duration_minutes: 8,
  },
  {
    id: 'lesson-02', order: 2, section: 'Foundations of Real Estate Wealth', difficulty: 'beginner',
    title: 'The Real Estate Wealth Ladder',
    body: 'The wealth ladder describes a progression most successful investors follow: Start with wholesaling to learn deals and build capital with no money down. Move to fix-and-flip to build larger lump sums. Invest in buy-and-hold rentals for passive income. Scale with multifamily and commercial. At each rung, knowledge and capital compound.',
    takeaways: ['Wholesaling = fastest way to learn deal analysis and earn capital', 'Fix-and-flip = higher per-deal profits, more risk and capital needed', 'Buy-and-hold = true passive wealth over time'],
    example: 'Marcus starts with 3 wholesale deals earning $45,000 in 12 months. He uses that capital as a down payment on a duplex that earns $800/month. He then flips a house for $38,000 profit and buys 2 more rentals.',
    quiz: { question: 'What is the primary goal of wholesaling on the wealth ladder?', options: ['Long-term passive income', 'Building a rental portfolio immediately', 'Learning deals and building capital with no money down', 'Tax sheltering'], answer: 2 },
    section_link: '/academy', duration_minutes: 7,
  },
  {
    id: 'lesson-03', order: 3, section: 'Foundations of Real Estate Wealth', difficulty: 'beginner',
    title: 'Understanding Property Values and ARV',
    body: 'After Repair Value (ARV) is the estimated market value of a property after all repairs are completed. It is the foundation of every real estate investment calculation. ARV is determined by analyzing comparable sales (comps) — recently sold similar properties within 0.5 miles, same bed/bath count, within 20% size. Getting ARV wrong is the most expensive mistake investors make.',
    takeaways: ['ARV = what the property is worth fully fixed up', 'Use 3-5 comps within 0.5 miles, sold in last 90 days', 'Price per square foot helps normalize comparisons'],
    example: 'A 3-bed/2-bath 1,400 sqft house in Phoenix. 4 comps: $175k, $182k, $171k, $178k. Average = $176,500 ARV. Price per sqft = $126. Use this to calculate your offer.',
    quiz: { question: 'What does ARV stand for?', options: ['Annual Rental Valuation', 'After Repair Value', 'Assessed Real Value', 'Average Renovation Value'], answer: 1 },
    section_link: '/calculator', duration_minutes: 10,
  },

  // ── SECTION 2: Wholesaling ─────────────────────────────────────────────────
  {
    id: 'lesson-04', order: 4, section: 'Wholesaling', difficulty: 'beginner',
    title: 'What is Real Estate Wholesaling?',
    body: 'Real estate wholesaling is the process of finding deeply discounted properties, getting them under contract, then selling your contractual rights to a cash buyer for a profit called an assignment fee — without ever owning the property yourself. No money, no credit, no license needed in most states. It is the fastest entry point into real estate and the best education in deal analysis.',
    takeaways: ['You never take title to the property', 'Your profit is the assignment fee between seller and buyer prices', 'Speed and motivated sellers are your edge'],
    example: 'A seller in financial distress accepts $95,000 for a home worth $160,000. You assign the contract to a cash buyer for $110,000. Assignment fee: $15,000 — closed in 14 days.',
    quiz: { question: 'What do you sell in a wholesale deal?', options: ['The property itself', 'Your contractual rights to buy the property', 'A mortgage', 'Repair services'], answer: 1 },
    section_link: '/leads', duration_minutes: 8,
  },
  {
    id: 'lesson-05', order: 5, section: 'Wholesaling', difficulty: 'beginner',
    title: 'The 70% Rule and Maximum Allowable Offer',
    body: 'The Maximum Allowable Offer (MAO) is the highest price you can pay for a property while still profiting. The classic formula: MAO = (ARV × 0.70) − Repair Costs. The 70% factor reserves 30% for investor profit, closing costs, and risk buffer. Your assignment fee must come on top of this — so you offer even less than MAO.',
    takeaways: ['MAO = (ARV × 0.70) − Repairs', 'Your offer should be MAO minus your desired assignment fee', 'Never skip estimating repairs — it kills deals and relationships'],
    example: 'ARV: $200,000. Repairs: $25,000. MAO = ($200,000 × 0.70) − $25,000 = $115,000. You want a $15k assignment fee, so offer $100,000.',
    quiz: { question: 'Using the 70% rule, what is MAO for a property with ARV $180,000 and $20,000 repairs?', options: ['$106,000', '$146,000', '$126,000', '$160,000'], answer: 0 },
    section_link: '/calculator', duration_minutes: 10,
  },
  {
    id: 'lesson-06', order: 6, section: 'Wholesaling', difficulty: 'beginner',
    title: 'Finding and Talking to Motivated Sellers',
    body: 'Motivated sellers are homeowners who need to sell quickly due to financial hardship, divorce, probate, foreclosure, tax delinquency, job loss, or property condition. They accept below-market prices in exchange for speed and certainty. Your job is not to pressure — it is to solve their problem. Lead with empathy, uncover their timeline and situation, then present your offer as a solution.',
    takeaways: ['Motivation comes from life events — not property condition', 'Ask open questions: "What would an ideal solution look like for you?"', 'Never reveal your ARV or buyer price — negotiate from their need'],
    example: 'A seller says "I just need this gone — I moved to Florida 6 months ago." That is a highly motivated seller. Her motivation score from Veori AI: 87/100. You open with empathy and close in one call.',
    quiz: { question: 'What is the best first question to ask a seller?', options: ['"How much do you want for the property?"', '"What repairs does it need?"', '"What would an ideal outcome look like for you?"', '"Do you have another offer?"'], answer: 2 },
    section_link: '/leads', duration_minutes: 9,
  },
  {
    id: 'lesson-07', order: 7, section: 'Wholesaling', difficulty: 'intermediate',
    title: 'Building a Cash Buyers List',
    body: 'Your cash buyers list is your most valuable business asset. Without buyers, you cannot close deals. Cash buyers are investors who purchase without financing: fix-and-flippers, landlords, developers, and hedge funds. Build your list by attending REIA meetings, posting on Facebook Marketplace ("I have off-market deals — are you buying?"), searching county deed records for recent cash purchases, and letting Veori AI qualify inbound buyer interest.',
    takeaways: ['A deep buyer pool means faster, more competitive assignments', 'Know each buyer\'s buy box: area, price, bed/bath, condition', 'Repeat buyers > one-time buyers — serve them well'],
    example: 'A buyers list of 200 pre-qualified investors. When you get a deal in Phoenix at 65 cents on the dollar, you email your list and get 4 offers in 2 hours. You pick the highest and fastest.',
    quiz: { question: 'Why is knowing a buyer\'s "buy box" important?', options: ['To negotiate a lower assignment fee', 'To match the right deal to the right buyer quickly', 'To skip the title process', 'To avoid TCPA compliance'], answer: 1 },
    section_link: '/buyers', duration_minutes: 8,
  },
  {
    id: 'lesson-08', order: 8, section: 'Wholesaling', difficulty: 'intermediate',
    title: 'Contracts, Assignment Clauses, and Double-Closes',
    body: 'Every wholesale deal starts with a Purchase and Sale Agreement (PSA) that includes an assignment clause allowing you to transfer your buyer rights to a third party. An assignment of contract is then signed when you bring in your end buyer. A double-close is an alternative: you actually purchase (A-to-B) and immediately resell (B-to-C) on the same day — used when sellers or buyers object to seeing assignment fees, or when state law requires it.',
    takeaways: ['Always use a contract with an assignment clause', 'Double-close requires transactional (flash) funding — usually 1 day', 'Some states require disclosure that you may assign the contract'],
    example: 'You get a house under contract for $90,000 with an assignment clause. Your buyer wants it for $108,000. You do an assignment, sign over your rights, and collect $18,000 at closing.',
    quiz: { question: 'What does an assignment clause in a contract allow you to do?', options: ['Extend the closing date', 'Transfer your buyer rights to another investor', 'Reduce the purchase price', 'Skip the inspection'], answer: 1 },
    section_link: '/pipeline', duration_minutes: 11,
  },

  // ── SECTION 3: Fix & Flip ──────────────────────────────────────────────────
  {
    id: 'lesson-09', order: 9, section: 'Fix & Flip', difficulty: 'intermediate',
    title: 'Fix and Flip 101: The Process',
    body: 'Fix-and-flip is the strategy of buying a distressed property, renovating it, and selling it at or near ARV for a profit. The profit equation: Profit = Sale Price − Purchase Price − Renovation Costs − Holding Costs − Closing Costs. Flipping is faster wealth than wholesaling per deal but requires capital (or hard money loans), contractor management, and risk tolerance for unexpected repairs.',
    takeaways: ['Budget 20-30% above your renovation estimate for unknowns', 'Every extra month you hold = more holding costs (mortgage, utilities, insurance)', 'Focus on cosmetic renovations — kitchens, bathrooms, curb appeal — for best ROI'],
    example: 'Purchase: $95,000. Renovations: $35,000. Holding (4 months): $8,000. Selling costs: $12,000. Sale price: $185,000. Profit: $35,000 in 5 months.',
    quiz: { question: 'Which renovation typically yields the best ROI in fix-and-flip?', options: ['Adding a pool', 'Converting a basement', 'Kitchen and bathroom updates', 'Solar panels'], answer: 2 },
    section_link: '/calculator', duration_minutes: 10,
  },
  {
    id: 'lesson-10', order: 10, section: 'Fix & Flip', difficulty: 'intermediate',
    title: 'Financing Your Flip: Hard Money and Private Money',
    body: 'Most flippers use hard money loans (short-term, high-interest loans from private lenders) to fund purchases and renovations. Hard money lenders focus on the deal quality (ARV and LTV), not your credit score. They typically lend 65-75% of ARV or 90% of purchase + 100% of renovation costs. Private money lenders are individuals (friends, family, networks) who lend at negotiated rates — often cheaper than hard money.',
    takeaways: ['Hard money: 10-14% interest, 1-3 points, 6-12 month terms', 'Points = upfront fee (1 point = 1% of loan)', 'Use leverage wisely — overleveraging kills flip profits'],
    example: 'ARV: $200,000. Lender gives 70% of ARV = $140,000 loan. Your purchase is $95,000 + renovation $35,000 = $130,000. Lender covers it all. You bring 0 down but pay ~$14,000 in interest and points.',
    quiz: { question: 'What do hard money lenders primarily evaluate?', options: ['Your credit score', 'Your W-2 income', 'The deal quality and ARV', 'Your bank balance'], answer: 2 },
    section_link: '/buyers', duration_minutes: 9,
  },

  // ── SECTION 4: Rentals & Buy-and-Hold ─────────────────────────────────────
  {
    id: 'lesson-11', order: 11, section: 'Rental Properties & Buy-and-Hold', difficulty: 'intermediate',
    title: 'Buy-and-Hold: Building Passive Income',
    body: 'Buy-and-hold is purchasing property to rent out long-term. It generates monthly cash flow (rent minus expenses), equity buildup (mortgage paydown), appreciation, and tax advantages. The key metric is Cash-on-Cash Return: annual cash flow divided by total cash invested. A strong rental deal generates 8-12%+ cash-on-cash. The BRRRR strategy (Buy, Rehab, Rent, Refinance, Repeat) lets you recycle capital to buy multiple rentals.',
    takeaways: ['Cash-on-Cash Return = Annual Cash Flow ÷ Total Cash Invested', 'Target 1% rule: monthly rent ≥ 1% of purchase price (rough screen)', 'BRRRR recycles your down payment — potentially buying infinite rentals'],
    example: '$120,000 house, 20% down ($24,000). Rent: $1,300/month. Expenses (mortgage, insurance, taxes, PM fee): $900/month. Cash flow: $400/month = $4,800/year. Cash-on-Cash: $4,800/$24,000 = 20%.',
    quiz: { question: 'What does BRRRR stand for?', options: ['Buy, Renovate, Rent, Refinance, Repeat', 'Buy, Rehab, Rent, Refinance, Repeat', 'Buy, Repair, Rent, Reinvest, Repeat', 'Bid, Rehab, Rent, Resell, Restart'], answer: 1 },
    section_link: '/buyers', duration_minutes: 10,
  },
  {
    id: 'lesson-12', order: 12, section: 'Rental Properties & Buy-and-Hold', difficulty: 'intermediate',
    title: 'Property Management: Running Your Portfolio',
    body: 'As your rental portfolio grows, property management becomes critical. You can self-manage or hire a property management company (typically 8-12% of monthly rent). Key PM responsibilities: tenant screening (credit, background, income verification), lease management, maintenance coordination, rent collection, and eviction handling. Effective PM is the difference between passive income and a second job.',
    takeaways: ['Screen tenants thoroughly — a bad tenant costs $5,000-$15,000', 'Build a maintenance reserve: set aside 1% of property value per year', 'Property management software pays for itself in time saved'],
    example: 'A 3-unit portfolio self-managed earns $1,200/month net. The same portfolio with a 10% PM fee earns $1,020/month — but frees 10+ hours/month. At $50/hour, that is $500 in time value. Often worth it.',
    quiz: { question: 'What is the typical range for property management fees?', options: ['1-3%', '8-12%', '15-20%', '25-30%'], answer: 1 },
    section_link: '/buyers', duration_minutes: 8,
  },
  {
    id: 'lesson-13', order: 13, section: 'Rental Properties & Buy-and-Hold', difficulty: 'advanced',
    title: 'Multifamily Investing: Scaling Up',
    body: 'Multifamily properties (duplexes, triplexes, apartment buildings) scale rental income faster than single-family homes. Commercial multifamily (5+ units) is valued by NOI (Net Operating Income) rather than comps — making it possible to force appreciation by raising rents or cutting expenses. A 5-cap property with $100,000 NOI is worth $2,000,000. Increase NOI to $120,000 and value jumps to $2,400,000.',
    takeaways: ['Multifamily: one roof, multiple income streams', 'Commercial valuation = NOI ÷ Cap Rate (e.g., $100,000 / 0.05 = $2,000,000)', 'Force appreciation by increasing NOI — raising rents, adding laundry, reducing vacancies'],
    example: 'A 12-unit apartment building at a 6% cap rate with $80,000 NOI is worth $1.33M. Add coin-op laundry and raise rents 8% → NOI = $95,000 → Value = $1.58M. Forced appreciation of $250,000.',
    quiz: { question: 'How is commercial multifamily property typically valued?', options: ['By comparable sales like single-family homes', 'By NOI divided by cap rate', 'By number of units × $100,000', 'By the square footage only'], answer: 1 },
    section_link: '/buyers', duration_minutes: 12,
  },

  // ── SECTION 5: REITs & Passive Investing ──────────────────────────────────
  {
    id: 'lesson-14', order: 14, section: 'REITs & Passive Real Estate Investing', difficulty: 'beginner',
    title: 'REITs: Investing in Real Estate Without Owning Property',
    body: 'A Real Estate Investment Trust (REIT) is a company that owns income-producing real estate. Investors buy shares like stocks — getting exposure to real estate without the landlord responsibilities. REITs are required to distribute 90% of taxable income as dividends, making them high-yield. Types include: Equity REITs (own properties), Mortgage REITs (own mortgages), and Hybrid REITs.',
    takeaways: ['REITs distribute 90%+ of income as dividends', 'Publicly traded REITs are liquid — buy and sell like stocks', 'Private REITs and real estate crowdfunding offer higher returns with less liquidity'],
    example: 'A $10,000 investment in a diversified REIT paying 5% annual dividend = $500/year. Reinvested over 20 years with 7% total return: $38,700. Fully passive — no tenants, no toilets.',
    quiz: { question: 'What percentage of taxable income must REITs distribute to shareholders?', options: ['50%', '70%', '90%', '100%'], answer: 2 },
    section_link: '/academy', duration_minutes: 7,
  },
  {
    id: 'lesson-15', order: 15, section: 'REITs & Passive Real Estate Investing', difficulty: 'intermediate',
    title: 'Real Estate Crowdfunding and Fractional Ownership',
    body: 'Real estate crowdfunding platforms let investors pool money to buy properties, earning proportional income and appreciation. Fractional ownership — like Veori Credits — takes this further: you can own a percentage of a specific property starting with any amount. This democratizes access to real estate wealth that was previously reserved for wealthy investors with large down payments.',
    takeaways: ['Crowdfunding pools small investors to buy large properties', 'Fractional ownership gives you cash flow + appreciation on a fraction of a property', 'Veori Credits will allow any Veori user to participate in deals generated on the platform'],
    example: 'A $500,000 apartment building splits into 1,000 shares at $500 each. Own 2 shares = 0.2% ownership. Monthly rent of $4,000 = $8 passive income/month. Property appreciates 5% = $5 gain per share per year.',
    quiz: { question: 'What is the primary advantage of real estate crowdfunding?', options: ['Zero risk', 'Low minimum investment with real estate exposure', 'No taxes on returns', 'Government-guaranteed returns'], answer: 1 },
    section_link: '/academy', duration_minutes: 8,
  },

  // ── SECTION 6: Compliance & Legal ─────────────────────────────────────────
  {
    id: 'lesson-16', order: 16, section: 'Compliance & Legal Foundations', difficulty: 'beginner',
    title: 'TCPA Compliance: Calling and Texting Sellers Legally',
    body: 'The Telephone Consumer Protection Act (TCPA) governs how you can contact sellers. Violations carry $500-$1,500 per call or text — and class action lawsuits can bankrupt a business overnight. Key rules: never call numbers on the National DNC Registry unless they opted in within 18 months. Obtain express written consent before sending automated texts. Always identify yourself on calls. Honor opt-outs immediately. Veori AI handles DNC scrubbing automatically.',
    takeaways: ['DNC violations = $500-$1,500 per call/text', 'Always scrub leads against the DNC list before outreach', 'Veori AI auto-flags DNC numbers and requires manual override with consent documentation'],
    example: 'A marketing company sends 1,000 unscrubbed texts. 200 were on DNC. Penalty: up to $300,000. One class-action later: business closed. With Veori, DNC scrubbing runs automatically on every lead.',
    quiz: { question: 'What is the penalty range per TCPA violation?', options: ['$50-$100', '$500-$1,500', '$5,000-$15,000', '$50,000+'], answer: 1 },
    section_link: '/compliance', duration_minutes: 9,
  },
  {
    id: 'lesson-17', order: 17, section: 'Compliance & Legal Foundations', difficulty: 'intermediate',
    title: 'State-Specific Wholesaling Laws',
    body: 'Wholesaling laws vary significantly by state. Some states require a real estate license to market properties for sale. Others require specific contract language, disclosure to all parties, or restrict assignment fees. States with notable requirements include Illinois (prohibits assignments on residential unless licensed), Texas (limits marketing rights), and South Carolina (assignment disclosure required). Veori AI flags your state\'s requirements in the Compliance tab.',
    takeaways: ['Know your state\'s wholesaling laws before your first deal', 'Assignment disclosure protects you legally in most states', 'When in doubt, get a real estate attorney to review your contracts'],
    example: 'An investor in Illinois markets a property with a contract but no license. The deal falls apart when the title company flags the issue. With Veori Compliance, state-specific restrictions are flagged before outreach begins.',
    quiz: { question: 'What is the safest legal protection when wholesaling?', options: ['Verbal agreements only', 'Working without contracts to stay informal', 'Using contracts with assignment clauses reviewed by a real estate attorney', 'Hiding the assignment from the seller'], answer: 2 },
    section_link: '/compliance', duration_minutes: 10,
  },
];

const GLOSSARY = [
  { term: 'Cash-on-Cash Return', definition: 'Annual cash flow divided by total cash invested. Measures how efficiently your capital generates income. Target 8-12%+ for a strong rental deal.', section: '/calculator' },
  { term: 'BRRRR', definition: 'Buy, Rehab, Rent, Refinance, Repeat — a strategy where you recycle your down payment by refinancing after renovation, enabling you to buy multiple rentals from the same capital.', section: '/buyers' },
  { term: 'Cap Rate', definition: 'Capitalization Rate = NOI ÷ Property Value. Used to value commercial/multifamily properties. A 6% cap = $100,000 NOI → $1.67M property value.', section: '/calculator' },
  { term: 'NOI', definition: 'Net Operating Income = Gross Rental Income − Operating Expenses (excluding mortgage). Used to value multifamily and commercial properties.', section: '/calculator' },
  { term: 'Hard Money Loan', definition: 'Short-term, high-interest loans from private lenders used by fix-and-flip investors. Focused on deal quality (ARV/LTV), not borrower credit score.', section: '/buyers' },
  { term: 'REIT', definition: 'Real Estate Investment Trust — a company that owns income-producing real estate and is required to distribute 90%+ of income to shareholders as dividends.', section: '/academy' },
  { term: 'Fractional Ownership', definition: 'Owning a proportional share of a specific property — receiving proportional cash flow and appreciation. Veori Credits will enable fractional ownership starting at any dollar amount.', section: '/academy' },
  { term: '1031 Exchange', definition: 'A tax strategy allowing investors to defer capital gains taxes by reinvesting proceeds from a property sale into a like-kind property within specific timeframes.', section: '/calculator' },
  { term: 'Depreciation', definition: 'The IRS allows landlords to deduct a property\'s cost over 27.5 years (residential) as a non-cash expense — often eliminating taxable rental income on paper.', section: '/calculator' },
  { term: 'Force Appreciation', definition: 'Increasing a property\'s value by increasing NOI — raising rents, reducing vacancies, adding revenue streams (laundry, parking). Most powerful in commercial multifamily.', section: '/buyers' },
  { term: 'Buy Box', definition: 'An investor\'s specific purchasing criteria — property type, location, price range, condition, bed/bath count. Matching deals to buyer buy boxes accelerates assignments.', section: '/buyers' },
  { term: 'Holding Costs', definition: 'Costs incurred while you own a property before selling: mortgage, taxes, insurance, utilities, HOA. Every extra month holding a flip eats into profit.', section: '/calculator' },
  { term: 'LTV', definition: 'Loan-to-Value ratio = Loan Amount ÷ Property Value. Hard money lenders typically lend up to 65-75% LTV. Lower LTV = less risk for lender.', section: '/calculator' },

  { term: 'ARV', definition: 'After Repair Value — the estimated market value of a property after all repairs and renovations are completed.', section: '/calculator' },
  { term: 'MAO', definition: 'Maximum Allowable Offer — the highest price you can offer while still maintaining your profit margin. Formula: MAO = (ARV × 0.70) − Repair Costs.', section: '/calculator' },
  { term: 'Assignment Fee', definition: 'The profit earned by a wholesaler for assigning their purchase contract to a cash buyer. The difference between the buyer price and the seller contract price.', section: '/pipeline' },
  { term: 'Double-Close', definition: 'A real estate transaction involving two simultaneous closings — the wholesaler purchases from the seller and immediately sells to the buyer.', section: '/pipeline' },
  { term: 'Earnest Money', definition: 'A deposit paid by the buyer to show good faith. In wholesale deals, this is typically kept low ($100-$500).', section: '/pipeline' },
  { term: 'Motivated Seller', definition: 'A property owner who needs to sell quickly, often due to financial hardship, divorce, probate, or property condition.', section: '/leads' },
  { term: 'Proof of Funds', definition: 'Documentation showing a buyer has the financial resources to complete a purchase.', section: '/buyers' },
  { term: 'Transactional Funding', definition: 'Short-term funding used in double-close deals to finance the A-to-B transaction until the B-to-C sale closes on the same day.', section: '/pipeline' },
  { term: 'Absentee Owner', definition: 'A property owner who does not live at the property they own — often more motivated to sell than owner-occupants.', section: '/leads' },
  { term: 'Probate', definition: 'The legal process of administering a deceased person\'s estate, often resulting in properties that heirs want to sell quickly.', section: '/leads' },
  { term: 'Distressed Property', definition: 'A property in poor physical condition, facing foreclosure, or with a financially stressed owner.', section: '/leads' },
  { term: 'Free-and-Clear', definition: 'A property with no mortgage or liens — the owner has 100% equity.', section: '/leads' },
  { term: 'Cash Buyer', definition: 'An investor who can purchase property without financing, enabling fast closings.', section: '/buyers' },
  { term: 'BRRRR', definition: 'Buy, Rehab, Rent, Refinance, Repeat — an investment strategy for building a rental portfolio.', section: '/buyers' },
  { term: 'Fix-and-Flip', definition: 'Purchasing a distressed property, renovating it, and selling it for a profit.', section: '/buyers' },
  { term: 'Buy-and-Hold', definition: 'Purchasing property to rent out long-term, generating passive rental income.', section: '/buyers' },
  { term: 'Cap Rate', definition: 'Capitalization Rate — annual net operating income divided by property value. Measures investment return.', section: '/calculator' },
  { term: 'NOI', definition: 'Net Operating Income — gross rental income minus operating expenses (excluding mortgage payments).', section: '/calculator' },
  { term: 'Title Insurance', definition: 'Insurance protecting against losses from title defects, liens, or ownership disputes.', section: '/title-companies' },
  { term: 'Escrow', definition: 'A neutral third party holds funds and documents until all conditions of a real estate transaction are met.', section: '/title-companies' },
  { term: 'Closing Costs', definition: 'Fees paid at the closing of a real estate transaction — including title insurance, attorney fees, and transfer taxes.', section: '/title-companies' },
  { term: 'Contingency', definition: 'A condition that must be met for a real estate contract to become binding — e.g., inspection contingency, financing contingency.', section: '/pipeline' },
  { term: 'Inspection Period', definition: 'A defined time window during which the buyer can inspect the property and potentially cancel the contract.', section: '/pipeline' },
  { term: 'PSA', definition: 'Purchase and Sale Agreement — the binding contract between buyer and seller specifying all terms of the transaction.', section: '/pipeline' },
  { term: 'Assignment of Contract', definition: 'The legal transfer of a buyer\'s rights in a purchase contract to a third party (the end buyer in wholesale).', section: '/pipeline' },
  { term: 'DNC', definition: 'Do Not Call — a registry of numbers that cannot be contacted for commercial purposes without explicit consent.', section: '/compliance' },
  { term: 'TCPA', definition: 'Telephone Consumer Protection Act — federal law regulating phone and text marketing. Violations carry $500-$1,500 penalties per call.', section: '/compliance' },
  { term: 'Motivation Score', definition: 'Veori AI\'s 0-100 score indicating how likely a seller is to sell. Scores 60+ are escalated to the deal pipeline automatically.', section: '/leads' },
  { term: 'Velocity Score', definition: 'Veori AI\'s prediction of the probability a deal closes within 30 days, based on motivation, deal stage, and buyer pool depth.', section: '/pipeline' },
  { term: 'Buyer-Seller Match Score', definition: 'Veori AI\'s score indicating how well a buyer\'s buy box matches a specific deal. Used to prioritize buyer outreach.', section: '/buyers' },
  { term: 'Subleasing', definition: 'Renting a property you are leasing to someone else — not the same as wholesaling.', section: '/academy' },
  { term: 'Equity', definition: 'The difference between a property\'s market value and the amount owed on it.', section: '/calculator' },
  { term: 'Lien', definition: 'A legal claim against a property, typically for unpaid debt. Liens must be cleared before title can transfer.', section: '/title-companies' },
  { term: 'Due Diligence', definition: 'The process of investigating a property and deal before committing — includes inspections, title search, and market analysis.', section: '/pipeline' },
  { term: 'Wholesale Contract', definition: 'A purchase contract that includes an assignment clause, allowing the buyer to transfer rights to an end buyer.', section: '/pipeline' },
  { term: 'Skip Tracing', definition: 'The process of locating a property owner\'s contact information using public records and data services.', section: '/leads' },
  { term: 'Ringless Voicemail', definition: 'A voicemail delivered directly to a phone without ringing — used for non-intrusive seller outreach.', section: '/leads' },
  { term: 'Deal Velocity', definition: 'The speed at which a deal moves through the pipeline stages toward closing.', section: '/pipeline' },
  { term: 'Seller Personality', definition: 'Veori AI classifies sellers into 4 types: Analytical, Emotional, Skeptical, and Motivated — adapting its approach accordingly.', section: '/leads' },
  { term: 'Veori Credits', definition: 'Veori\'s upcoming fractional real estate ownership product — allowing anyone to invest in real estate starting at any amount.', section: '/academy' },
  { term: 'Fractional Ownership', definition: 'Owning a proportional share of a property and its returns — rental income and appreciation.', section: '/academy' },
  { term: 'AI Command Log', definition: 'Veori\'s complete audit trail of every AI action — SMS sent, call initiated, contract generated, stage changed, follow-up scheduled.', section: '/dashboard' },
  { term: 'Pulse Notification', definition: 'Veori\'s real-time alert system for important events — new replies, deals at risk, title confirmations, market hotspots.', section: '/dashboard' },
  { term: 'Deal Brief', definition: 'A 5-sentence AI-generated summary of a deal\'s current status, seller motivation, last action, next step, and risk level.', section: '/pipeline' },
  { term: 'Seller Segment', definition: 'The category a seller falls into based on their situation — absentee, probate, distressed, free-and-clear, or other.', section: '/leads' },
  { term: 'Assignment Disclosure', definition: 'A written notice to all parties that the buyer intends to assign their contract rights — required in many states.', section: '/compliance' },
  { term: 'Closing Date', definition: 'The scheduled date on which a real estate transaction is completed and ownership transfers.', section: '/pipeline' },
  { term: 'Closing Period', definition: 'The number of days between contract signing and the closing date — typically 14-30 days in wholesale.', section: '/pipeline' },
  { term: 'Market Hotspot', definition: 'A geographic area where Veori AI detects rising seller motivation scores (15%+ month-over-month) — a strong buying opportunity.', section: '/analytics' },
  { term: 'Net Sheet', definition: 'A financial summary of all costs and proceeds in a transaction — shows what each party actually nets.', section: '/calculator' },
  { term: 'Hard Money Loan', definition: 'Short-term, high-interest loans from private lenders — often used by fix-and-flip investors who need fast funding.', section: '/buyers' },
  { term: 'LTV', definition: 'Loan-to-Value ratio — the loan amount as a percentage of the property\'s value. High LTV = more risk.', section: '/calculator' },
  { term: 'Comparable Sales (Comps)', definition: 'Recent sales of similar properties used to estimate a subject property\'s market value.', section: '/calculator' },
  { term: 'Days on Market (DOM)', definition: 'The number of days a property has been listed for sale — high DOM often indicates a motivated seller.', section: '/leads' },
  { term: 'Occupancy Status', definition: 'Whether a property is owner-occupied, tenant-occupied, or vacant — affects motivation and timeline.', section: '/leads' },
  { term: 'Wholesaling License', definition: 'Some states require a real estate license to wholesale. Veori AI flags this requirement in state compliance settings.', section: '/compliance' },
  { term: 'Earnest Money Deposit (EMD)', definition: 'Same as Earnest Money — the good faith deposit included in a purchase contract.', section: '/pipeline' },
  { term: 'Offer Price', definition: 'The price you submit in your purchase contract to the seller — should be at or below your MAO.', section: '/calculator' },
  { term: 'Profit Margin', definition: 'The difference between revenue and costs — your assignment fee minus any deal expenses.', section: '/calculator' },
];

// GET /api/academy/lessons
router.get('/lessons', async (req, res) => {
  const { data: progress } = await supabase.from('academy_progress')
    .select('lesson_id, completed, quiz_passed').eq('user_id', req.user.id);

  const progressMap = {};
  (progress || []).forEach(p => { progressMap[p.lesson_id] = p; });

  const completedCount = Object.values(progressMap).filter(p => p.completed).length;

  const lessons = LESSONS.map((l, i) => ({
    ...l,
    completed: !!(progressMap[l.id]?.completed),
    quiz_passed: !!(progressMap[l.id]?.quiz_passed),
    locked: i > 0 && !progressMap[LESSONS[i - 1].id]?.completed,
    body: undefined,
    takeaways: undefined,
    example: undefined,
    quiz: undefined,
  }));

  res.json({ success: true, lessons, completed_count: completedCount, total: LESSONS.length });
});

// GET /api/academy/lesson/:id — full lesson content
router.get('/lesson/:id', async (req, res) => {
  const lesson = LESSONS.find(l => l.id === req.params.id);
  if (!lesson) return res.status(404).json({ success: false, error: 'Lesson not found' });

  const { data: progress } = await supabase.from('academy_progress')
    .select('*').eq('user_id', req.user.id).eq('lesson_id', req.params.id).single();

  res.json({ success: true, lesson, progress: progress || null });
});

// GET /api/academy/progress/:user_id
router.get('/progress/:user_id', async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('academy_progress')
      .select('*').eq('user_id', req.params.user_id);
    if (error) throw error;
    const completedCount = (data || []).filter(p => p.completed).length;
    const percentage = Math.round((completedCount / LESSONS.length) * 100);
    res.json({ success: true, progress: data || [], completed_count: completedCount, percentage, total_lessons: LESSONS.length });
  } catch (err) { next(err); }
});

// POST /api/academy/complete-lesson
router.post('/complete-lesson', async (req, res, next) => {
  try {
    const { lesson_id, quiz_answer } = req.body;
    if (!lesson_id) return res.status(400).json({ success: false, error: 'lesson_id required' });

    const lesson = LESSONS.find(l => l.id === lesson_id);
    if (!lesson) return res.status(404).json({ success: false, error: 'Lesson not found' });

    const quiz_passed = quiz_answer !== undefined ? quiz_answer === lesson.quiz.answer : false;

    const { data, error } = await supabase.from('academy_progress').upsert({
      user_id: req.user.id,
      lesson_id,
      completed: true,
      quiz_passed,
      completed_at: new Date().toISOString(),
    }, { onConflict: 'user_id,lesson_id' }).select().single();

    if (error) throw error;
    res.json({ success: true, progress: data, quiz_passed, correct_answer: lesson.quiz.options[lesson.quiz.answer] });
  } catch (err) { next(err); }
});

// GET /api/academy/glossary
router.get('/glossary', (req, res) => {
  const { search } = req.query;
  let terms = GLOSSARY;
  if (search) {
    const q = search.toLowerCase();
    terms = GLOSSARY.filter(t => t.term.toLowerCase().includes(q) || t.definition.toLowerCase().includes(q));
  }
  res.json({ success: true, terms, total: terms.length });
});

module.exports = router;
