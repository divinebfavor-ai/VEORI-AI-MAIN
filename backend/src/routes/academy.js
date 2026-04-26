const express  = require('express');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ─── Lesson catalog ────────────────────────────────────────────────────────────
const LESSONS = [
  {
    id: 'lesson-01', order: 1, title: 'What is Real Estate Wholesaling?',
    body: 'Real estate wholesaling is the process of finding deeply discounted properties, getting them under contract, then selling your contractual rights to a cash buyer for a profit called an assignment fee — without ever owning the property yourself.',
    takeaways: ['You never take title to the property', 'Your profit is the assignment fee between seller and buyer prices', 'Speed and motivated sellers are your edge'],
    example: 'A seller in financial distress accepts $95,000 for a home worth $160,000. Veori AI identifies this as a deal. You assign the contract to a cash buyer for $110,000. Your assignment fee: $15,000.',
    quiz: { question: 'What do you sell in a wholesale deal?', options: ['The property itself', 'Your contractual rights to buy the property', 'A mortgage', 'Repair services'], answer: 1 },
    section_link: '/leads',
  },
  {
    id: 'lesson-02', order: 2, title: 'Understanding ARV and the 70% Rule',
    body: 'ARV (After Repair Value) is what a property will be worth after all repairs are completed. The 70% rule is the formula wholesalers use to determine the maximum they should offer: MAO = 70% × ARV − Repair Costs.',
    takeaways: ['ARV is the fixed point — everything is calculated from it', 'The 70% rule protects your buyer\'s profit margin', 'Going above MAO is a red flag — Veori AI warns you'],
    example: 'ARV = $200,000. Repairs = $30,000. MAO = (0.70 × $200,000) − $30,000 = $110,000. If you offer $120,000, you have exceeded your MAO and your buyer cannot profit.',
    quiz: { question: 'If ARV is $150,000 and repairs cost $20,000, what is the MAO?', options: ['$105,000', '$85,000', '$130,000', '$95,000'], answer: 1 },
    section_link: '/calculator',
  },
  {
    id: 'lesson-03', order: 3, title: 'Finding Motivated Sellers',
    body: 'Motivated sellers are property owners who need to sell quickly, often due to financial hardship, divorce, probate, or property condition. The four primary motivation types are: absentee owners, probate estates, distressed properties, and free-and-clear owners.',
    takeaways: ['Motivation is more important than the property condition', 'Absentee owners may not know local market prices', 'Probate estates often need fast, clean closings'],
    example: 'Veori AI imports a list of absentee owners in Houston, TX. The AI scores each lead 0-100 based on equity, time owned, and property condition signals. Leads scoring 70+ are auto-escalated to your deal pipeline.',
    quiz: { question: 'Which seller type is most likely to have equity but may not know local prices?', options: ['Distressed homeowner', 'Active real estate investor', 'Absentee owner', 'First-time seller'], answer: 2 },
    section_link: '/leads',
  },
  {
    id: 'lesson-04', order: 4, title: 'Talking to Motivated Sellers',
    body: 'The goal of your first conversation is not to make an offer — it is to understand the seller\'s situation, timeline, and true motivation. Ask open-ended questions. Listen more than you talk. Let the seller reveal what matters most to them.',
    takeaways: ['Identify the real problem the seller is trying to solve', 'Never lead with price — lead with empathy and understanding', 'The seller\'s timeline is often more important than their asking price'],
    example: 'Alex, your Veori AI caller, opens with: "Hi, I\'m Alex, an AI assistant from Veori. I noticed your property at 123 Main Street — I wanted to reach out to see if you\'ve considered selling. Is now a good time to talk?" This is transparent, respectful, and compliance-safe.',
    quiz: { question: 'What is the primary goal of your first conversation with a motivated seller?', options: ['Make the lowest possible offer', 'Understand their situation, timeline, and motivation', 'Get them to sign a contract immediately', 'Explain the 70% rule to them'], answer: 1 },
    section_link: '/dialer',
  },
  {
    id: 'lesson-05', order: 5, title: 'Finding and Qualifying Cash Buyers',
    body: 'Cash buyers are investors who can close quickly without financing contingencies. A strong buyer pool means your deals close faster. Buyers are qualified by their target areas, price range, investment strategy (fix-and-flip, buy-and-hold, BRRRR), and proof of funds.',
    takeaways: ['Build your buyer list before you need it', 'A buyer\'s "buy box" tells you exactly what they want', 'Veori AI matches buyers to deals automatically using your buyer database'],
    example: 'You add Marcus, a fix-and-flip investor active in Dallas, to your buyer pool. His buy box: Texas, $80K-$150K, needs-repair properties. When you close a Dallas deal at $95K, Veori AI instantly surfaces Marcus as your top buyer match.',
    quiz: { question: 'What is a "buy box"?', options: ['A physical box for deal documents', 'An investor\'s specific criteria for properties they will purchase', 'The maximum offer price', 'A type of real estate contract'], answer: 1 },
    section_link: '/buyers',
  },
  {
    id: 'lesson-06', order: 6, title: 'Working with Title Companies',
    body: 'A title company handles the closing process — they verify there are no liens or ownership issues, hold escrow funds, and facilitate the transfer of ownership. For wholesale deals, you need a title company familiar with assignment transactions.',
    takeaways: ['Not all title companies accept assignment contracts — vet them first', 'Build relationships with 2-3 reliable title companies in each market', 'Veori AI automatically sends your deal package to your selected title company'],
    example: 'After a seller signs the PSA for 456 Oak Ave, Veori AI sends the signed contract, seller and buyer contacts, and closing date to your trusted title company — automatically.',
    quiz: { question: 'What is the primary role of a title company in a wholesale deal?', options: ['Find motivated sellers', 'Verify ownership and handle the closing', 'Negotiate the purchase price', 'Repair the property'], answer: 1 },
    section_link: '/title-companies',
  },
  {
    id: 'lesson-07', order: 7, title: 'Reading a Purchase and Sale Agreement',
    body: 'A Purchase and Sale Agreement (PSA) is the binding contract between you and the seller. It specifies the purchase price, earnest money, contingencies (inspection, financing, appraisal), closing date, and any special terms. In wholesale, you include an assignment clause that allows you to transfer your rights to a buyer.',
    takeaways: ['The assignment clause is what makes wholesaling possible', 'Earnest money shows good faith — keep it as low as legally acceptable', 'Contingencies give you exit options if the deal falls through'],
    example: 'Veori AI generates your PSA automatically using deal data: seller name, property address, offer price, $100 earnest money, 14-day inspection period, 21-day closing period, and the required state disclosure language for your market.',
    quiz: { question: 'What clause in a PSA allows you to sell your contractual rights to a buyer?', options: ['Contingency clause', 'Assignment clause', 'Earnest money clause', 'Closing clause'], answer: 1 },
    section_link: '/pipeline',
  },
  {
    id: 'lesson-08', order: 8, title: 'What is an Assignment Fee and How Do You Earn One?',
    body: 'An assignment fee is the profit you earn for assigning your purchase contract to a cash buyer. It is the difference between what the buyer pays and what the seller agreed to. Assignment fees typically range from $5,000 to $50,000+ depending on the deal.',
    takeaways: ['Your profit is locked in when the buyer signs the assignment agreement', 'Disclose the assignment fee to all parties where required by state law', 'Veori AI calculates your estimated assignment fee range for every deal'],
    example: 'You contract a property for $85,000. A buyer agrees to pay $105,000. Your assignment fee = $20,000. Veori AI calculated the suggested range as $15,000-$22,000 — you landed in the middle.',
    quiz: { question: 'How is an assignment fee calculated?', options: ['70% of ARV minus repairs', 'The difference between buyer price and seller contract price', 'The earnest money times 10', '5% of the property value'], answer: 1 },
    section_link: '/pipeline',
  },
  {
    id: 'lesson-09', order: 9, title: 'Introduction to Double-Close Deals',
    body: 'A double-close (also called a back-to-back close) involves two separate transactions: you buy the property from the seller, then immediately sell it to the buyer. This hides the assignment fee from both parties but requires transactional funding for the A-to-B transaction.',
    takeaways: ['Double-closes require transactional funding or proof of funds', 'They are more expensive than assignments but offer more privacy', 'Veori AI alerts you when a deal type is double_close and prompts you to confirm funding'],
    example: 'When you create a double-close deal in Veori AI, you receive an immediate alert: "This deal requires transactional funding or proof of funds. Please confirm your funding source before proceeding."',
    quiz: { question: 'What is the main difference between an assignment and a double-close?', options: ['Double-closes have lower fees', 'A double-close involves two transactions and you briefly own the property', 'Assignments require transactional funding', 'Double-closes do not need a title company'], answer: 1 },
    section_link: '/pipeline',
  },
  {
    id: 'lesson-10', order: 10, title: 'TCPA Compliance and Ethical Outreach',
    body: 'The Telephone Consumer Protection Act (TCPA) regulates how businesses can contact people by phone and text. Violations can result in penalties of $500-$1,500 per call. Always check the DNC (Do Not Call) list, respect calling hours, and limit contact attempts.',
    takeaways: ['Never call anyone on the DNC list', 'Respect calling hours: 9am-8pm local time only', 'Veori AI enforces TCPA rules automatically and logs every call'],
    example: 'Veori AI automatically checks every lead against the DNC list before dialing, respects local calling hours based on the property\'s timezone, and limits contact to 3 attempts per week — all without you having to think about it.',
    quiz: { question: 'What does DNC stand for in real estate outreach?', options: ['Deal Not Closed', 'Do Not Call', 'Direct Number Contact', 'Double Negotiation Close'], answer: 1 },
    section_link: '/compliance',
  },
  {
    id: 'lesson-11', order: 11, title: 'State Compliance and Wholesaling Laws',
    body: 'Wholesaling laws vary by state. Some states require a real estate license to wholesale. Others require written disclosures or restrict assignment fees. Veori AI checks state compliance for every deal and injects required disclosure language into your contracts automatically.',
    takeaways: ['Some states restrict wholesaling without a license — always check', 'Written disclosure is required in many states', 'Veori AI flags compliance issues before you generate a contract'],
    example: 'When you create a deal in Texas, Veori AI automatically adds the required Texas disclosure language to your PSA and displays: "In Texas, a written assignment disclosure is required and has been added to your contract."',
    quiz: { question: 'What does Veori AI do when it detects a compliance requirement for a state?', options: ['Blocks the deal from proceeding', 'Adds required disclosure language and warns the operator', 'Hires a local attorney', 'Changes the deal to a double-close'], answer: 1 },
    section_link: '/compliance',
  },
  {
    id: 'lesson-12', order: 12, title: 'Introduction to Fractional Real Estate (Veori Credits Preview)',
    body: 'Veori Credits is the next frontier of Veori AI — fractional real estate ownership that makes property investment accessible to everyone. Instead of buying an entire property, you can invest in a share of a property and earn proportional returns.',
    takeaways: ['Fractional ownership lowers the barrier to real estate investing', 'Veori Credits will allow investments starting at any amount', 'Join the waitlist to be first when Veori Credits launches'],
    example: 'A single-family rental worth $250,000 is tokenized into 1,000 Veori Credits at $250 each. An investor buys 10 Credits ($2,500) and earns 1% of the rental income and 1% of the appreciation when the property sells.',
    quiz: { question: 'What is fractional real estate ownership?', options: ['Owning a fraction of a property\'s debt', 'Owning a proportional share of a property and its returns', 'A type of mortgage loan', 'Renting a room in a property'], answer: 1 },
    section_link: '/academy',
  },
];

const GLOSSARY = [
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
