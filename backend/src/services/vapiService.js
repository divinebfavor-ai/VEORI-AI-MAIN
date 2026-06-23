const axios = require('axios');
const { getCallIntelligence, buildAccumulatedIntelligenceBlock, getBuyerIntelligence, buildBuyerIntelBlock } = require('./dataMotService');

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_BASE    = process.env.VAPI_BASE_URL || 'https://api.vapi.ai';

// Build webhook URL from env — Railway sets RAILWAY_PUBLIC_DOMAIN automatically
const WEBHOOK_URL = process.env.VAPI_WEBHOOK_URL
  || (process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/vapi/webhook`
    : 'https://your-backend.railway.app/api/vapi/webhook');

const vapiHttp = axios.create({
  baseURL: VAPI_BASE,
  headers: { Authorization: `Bearer ${VAPI_API_KEY}`, 'Content-Type': 'application/json' },
  timeout: 30000,
});

// ─── Personality tone adapters (shared across outbound / buyer / inbound) ─────
// Keyed lowercase. The Settings dropdown sends Professional/Friendly/Direct/Warm,
// so we normalize to lowercase and alias 'warm' → empathetic. Without this, any
// tone but 'professional' silently fell back to default.
const TONE_INSTRUCTIONS = {
  professional: `- Speak professionally and crisply. Get to the point quickly.
- Use measured language: "I appreciate your time", "I respect that"
- Mirror the other person's pace — if they're formal, be formal`,
  friendly: `- Be warm, relaxed, and conversational. Use their first name often.
- Light humor is okay once rapport is built — never forced
- Sound like a neighbor talking, not a salesperson`,
  direct: `- Cut to the chase. Less small talk, more business.
- Short sentences. Don't over-explain.
- Ask closed questions to move forward: "Would Tuesday work?"`,
  empathetic: `- Lead with empathy. Acknowledge their situation first.
- Phrases: "I can hear that", "That sounds really tough", "I'm glad you picked up"
- Make them feel heard before making any business proposition`,
};

function getToneStyle(operator = {}) {
  const tone = operator.ai_personality_tone || 'professional';
  const toneKey = String(tone).toLowerCase() === 'warm'
    ? 'empathetic'
    : String(tone).toLowerCase();
  return TONE_INSTRUCTIONS[toneKey] || TONE_INSTRUCTIONS.professional;
}

// ─── Use-case identity ────────────────────────────────────────────────────────
// Each use case gives the AI a different role + "WHO YOU ARE" framing. The full
// call playbook (what questions to ask, how to price/close) is selected
// separately by selectPlaybook(). Wholesale is the default and is unchanged.
const USE_CASE_IDENTITY = {
  wholesale: {
    role: `a real estate investor — specifically, you buy properties for cash, close fast, and make the process as easy as possible for sellers`,
    mission: `Not every call becomes a deal and that is fine. Your job is to have an honest conversation and find out if there is an opportunity to help.`,
  },
  agent_listing: {
    role: `a licensed real estate agent's assistant — you help homeowners who may want to SELL by listing their home on the market for top dollar. You are NOT trying to buy their house; you help them list and sell it`,
    mission: `Your goal is to book a listing appointment — a time for the agent to walk the home and present a pricing/marketing plan. Not every call becomes a listing and that is fine.`,
  },
  buyer_agent: {
    role: `a licensed buyer's agent's assistant — you help people who are looking to BUY a home find the right property and get represented in the purchase. You are NOT selling them anything; you help them buy`,
    mission: `Your goal is to book a buyer consultation — a quick call to understand what they're looking for, their budget, and their timeline. Not every call becomes a client and that is fine.`,
  },
  landlord_pm: {
    role: `a property management representative reaching out on behalf of ${'${companyName}'} — you help property owners by managing their rentals (tenants, maintenance, rent collection) so they don't have to`,
    mission: `Your goal is to find out if the owner is self-managing and frustrated, and if so, book a quick call to explain how management would take the headache off their plate. Not every owner wants help and that is fine.`,
  },
  investor_outreach: {
    role: `an acquisitions rep reaching out on behalf of ${'${companyName}'} to active real estate INVESTORS (cash buyers, landlords, flippers) — you bring them off-market deals that match their buy box`,
    mission: `Your goal is to learn their buy box (areas, property type, price range, strategy) and gauge interest in receiving deals. You are talking to a fellow professional, not a distressed homeowner.`,
  },
  general: {
    role: `a real estate professional reaching out on behalf of ${'${companyName}'}`,
    mission: `Your job is to have an honest, helpful conversation and find out if there's a way to help them with their real estate need.`,
  },
};

// Resolve the active use case. A per-campaign override (if provided and valid)
// wins over the operator's default; otherwise fall back to the operator default,
// then to wholesale. Invalid values are ignored so nothing ever breaks.
function getUseCase(operator = {}, override = null) {
  const ov = override ? String(override).toLowerCase() : '';
  if (ov && USE_CASE_IDENTITY[ov]) return ov;
  const uc = String(operator.ai_use_case || 'wholesale').toLowerCase();
  return USE_CASE_IDENTITY[uc] ? uc : 'wholesale';
}

// ─── Strategy playbooks ───────────────────────────────────────────────────────
// ADDITIVE overlay on top of the use-case playbook. The wholesale/cash flow above
// is the DEFAULT and is untouched — these blocks are appended ONLY when the lead
// detector (leadTaggingService.detectStrategy) tagged the lead with a creative
// strategy, giving the voice AI the right discovery questions, pitch framing, and
// how to talk about the offer for that specific way of buying. `cash` is the
// fallback and renders NOTHING extra (the existing OFFER MATH / HOUSE FLOW already
// covers it), so a cash lead's prompt is byte-for-byte what it was before.
const STRATEGY_PLAYBOOK = {
  subject_to: {
    label: 'SUBJECT-TO (take over the existing mortgage)',
    discovery: [
      '"Do you still have a mortgage on the property, and roughly what\'s the balance?"',
      '"Are the payments current, or have you fallen behind at all?"',
      '"Do you happen to know the interest rate and the monthly payment?"',
      '"If we could take over those payments and catch up anything behind, would getting out from under it help you?"',
    ],
    pitch: `This seller likely has little equity and an existing loan — a cash lowball won't clear the mortgage, so DON'T lead with a cash discount. Lead with RELIEF: you take over the existing payments (and reinstate anything they're behind on), they walk away free of the burden and the credit risk. Frame it as "we keep your loan in place and make the payments going forward."`,
    offerFraming: `Talk in terms of taking over the payments + a small amount to the seller at closing, NOT a discounted cash price. Be honest the loan stays in their name and explain how that works. Never promise a refinance timeline you can't guarantee.`,
    objections: [
      `"Isn't the loan still in my name?" → "Yes, and that's exactly why we reinstate anything behind and make every payment on time — protecting your credit while you walk away from the burden."`,
      `"What if you stop paying?" → "We put it in writing, and you can require proof of payment. We're in the business of keeping these current — a missed payment hurts us too."`,
    ],
    closeLine: `"If we take over the payments, catch up what's behind, and put a little cash in your hand at closing — would getting out from under this be a relief?"`,
  },
  seller_finance: {
    label: 'SELLER FINANCE (owner carries the note)',
    discovery: [
      '"Do you own the property free and clear, or is there still a loan on it?"',
      '"If you sold, would you need all the cash at once, or would steady monthly income work for you?"',
      '"Have you thought about the tax hit from selling all at once?"',
      '"Would you be open to me buying it and paying you monthly, with a down payment up front?"',
    ],
    pitch: `This seller owns it (or nearly) and isn't desperate — a cash lowball insults them. Sell the BENEFITS of carrying: monthly income, a higher total price than a cash offer, and spreading the tax hit instead of one big capital-gains year. You become their reliable payer; they become the bank.`,
    offerFraming: `Talk in terms of down payment, monthly payment, interest rate, and term (years) — NOT a single cash number. A higher headline price is possible BECAUSE the terms are financed. Confirm the numbers map to terms the operator set; never invent a rate or balloon you can't honor.`,
    objections: [
      `"I want all my cash now." → "Totally fair — but a cash buyer discounts hard. Carrying gets you a higher total price AND spreads the tax hit instead of one big year."`,
      `"What if you stop paying me?" → "The property secures the note — if we ever default, it comes back to you, and you keep everything paid so far."`,
    ],
    closeLine: `"If I gave you a solid down payment and a reliable monthly check at a fair rate — and a higher overall price than any cash buyer — would you be open to carrying it for me?"`,
  },
  lease_option: {
    label: 'LEASE-OPTION (control now, buy later)',
    discovery: [
      '"Is the property rented right now, or sitting empty?"',
      '"Are you tired of being a landlord, or just exploring options?"',
      '"Would a steady monthly check plus a set price to buy it down the road interest you?"',
      '"What would the property need to rent for to make sense for you?"',
    ],
    pitch: `This is a landlord with real equity who isn't distressed. Offer to take the management headache off their plate now (you lease it) with the right to buy at a set price later. They keep ownership and income short-term, with a clean exit locked in.`,
    offerFraming: `Talk in terms of monthly lease payment, option price (the set future purchase price), and option period — NOT a cash discount. Be clear about what's rent vs. what credits toward the purchase.`,
    objections: [
      `"I'd rather just sell outright." → "If a cash sale at a discount works, great — but this keeps your equity growing and hands you a steady check with zero management on your end."`,
      `"What if you don't buy at the end?" → "You keep the non-refundable option fee and the property — you're never worse off than today."`,
    ],
    closeLine: `"If I take the landlord headaches off your plate, send you a steady monthly check, and lock a fair price to buy it down the road — is that worth a conversation?"`,
  },
  novation: {
    label: 'NOVATION (re-paper the deal, resell near retail)',
    discovery: [
      '"Is the home listed with an agent right now, or are you selling it yourself?"',
      '"What price are you hoping to get for it?"',
      '"Is it in pretty good shape, or does it need some work to show well?"',
      '"If I could get you very close to your number — just on a slightly longer timeline — would that work better than a low cash offer?"',
    ],
    pitch: `This seller wants near-retail and won't take a wholesale lowball — the house is fixed-up or agent-listed/FSBO. DON'T discount hard. Offer to put it under contract at close to their number and bring your marketing muscle to resell it at retail. They get the price they want; you earn the spread for doing the work and carrying the risk.`,
    offerFraming: `Talk in terms of a price very close to their ask, NOT a deep cash discount — your profit is the SPREAD on the retail resale, after light reno + agent + closing. Be honest you'll re-market and resell; never promise a closing date you can't control.`,
    objections: [
      `"Why not just list it with an agent myself?" → "You can — but you'd wait for a buyer, pay full commission, and handle the showings and repairs. I take that off your plate and lock your price now."`,
      `"How do I know you'll actually close?" → "We put it in writing with a real contract and timeline. You keep the home and your price is protected until we perform."`,
    ],
    closeLine: `"So if I can get you right around [their number] and handle all the marketing and the sale myself, is that something you'd put under contract this week?"`,
  },
};

// Resolve which strategy to actually use for a lead. Operator's MANUAL pick always
// wins; auto-detected strategy is the default; cash is the final fallback. This is
// the single source of truth used by the call prompt and the offer math so the AI
// and the numbers never disagree. Never reads anything but the operator-set override
// and the detector's verdict — page/lead content can't inject a strategy.
function resolveStrategy(lead = {}) {
  const override = lead.strategy_override != null ? String(lead.strategy_override).toLowerCase() : '';
  if (override && STRATEGY_PLAYBOOK[override]) return override;           // manual creative pick
  if (override === 'cash') return 'cash';                                 // manual cash pick
  const auto = String(lead.detected_strategy || '').toLowerCase();
  if (auto && (STRATEGY_PLAYBOOK[auto] || auto === 'cash')) return auto;  // auto pick
  return 'cash';                                                          // fallback
}

// Render the strategy overlay for the lead, or '' for cash/unknown (no change).
function buildStrategyBlock(lead = {}) {
  const key = resolveStrategy(lead);
  const play = STRATEGY_PLAYBOOK[key];
  if (!play) return ''; // cash / null → existing behavior, nothing appended
  return `
══════════════════════════════════════════════════════
STRATEGY OVERLAY — ${play.label}
══════════════════════════════════════════════════════
This lead fits a CREATIVE strategy, not a straight cash buy. Use the cash flow
above for rapport and discovery, but steer the OFFER toward this strategy. If the
seller clearly wants only a cash sale, fall back to the cash offer gracefully.

WHY THIS FITS: ${play.pitch}

ASK THESE (work them in naturally, don't interrogate):
${play.discovery.map(q => `- ${q}`).join('\n')}

HOW TO FRAME THE OFFER: ${play.offerFraming}
${Array.isArray(play.objections) && play.objections.length ? `
HANDLE THESE PUSHBACKS (reframe, don't argue):
${play.objections.map(o => `- ${o}`).join('\n')}` : ''}${play.closeLine ? `

CLOSE TOWARD: ${play.closeLine}` : ''}
`;
}

// A single, always-present line telling the AI its PRIMARY play and the best
// FALLBACK if the seller resists. Primary = resolveStrategy (manual override or
// auto). Fallback = the next-best ranked strategy the detector found, else cash.
// Cash degrades gracefully: primary reads "CASH / WHOLESALE" and there's no
// creative overlay below. Labels are pulled from the playbook; cash has a plain label.
function buildStrategyLine(lead = {}) {
  const labelOf = k => (k === 'cash'
    ? 'CASH / WHOLESALE'
    : (STRATEGY_PLAYBOOK[k]?.label || k.replace(/_/g, ' ').toUpperCase()));
  const primary = resolveStrategy(lead);
  const ranked  = Array.isArray(lead.strategy_ranked) ? lead.strategy_ranked : [];
  const fallback = ranked.map(r => String(r.strategy || '').toLowerCase())
    .find(s => s && s !== primary) || 'cash';
  return `
══════════════════════════════════════════════════════
PRIMARY STRATEGY: ${labelOf(primary)}  |  FALLBACK: ${labelOf(fallback)}
══════════════════════════════════════════════════════
Lead with the PRIMARY way of buying. If the seller pushes back hard or clearly
wants something else, pivot to the FALLBACK — and if neither lands, a clean cash
offer is always acceptable. Never force a structure on a seller who won't have it.`;
}

// ─── Per-strategy offer math ──────────────────────────────────────────────────
// Returns the numeric shape of the offer for a given strategy. The CASH branch is
// the EXISTING math, untouched (MAO = ARV×0.70 − repairs; first = MAO×0.85), so
// any caller asking for cash gets exactly today's numbers. Creative branches read
// the lead's loan signals + optional operator-supplied strategy_terms and never
// fabricate: when a needed input is missing the field comes back null so the caller
// can prompt for it instead of inventing a number. Pure, never throws.
//
// @param {object} lead
// @param {string} strategy  cash | subject_to | seller_finance | lease_option
// @param {object} terms     optional operator-set terms (rate, term_years, down, …)
// @returns {object} { strategy, ...numbers }
function computeStrategyOffer(lead = {}, strategy = 'cash', terms = {}) {
  const arv      = Number(lead.arv) || Number(lead.estimated_value) || 0;
  const repairs  = Number(lead.repair_estimate) || 35000; // same conservative bucket as buildAlexPrompt
  const mortgage = Number(lead.mortgage_balance) || 0;
  const arrears  = Number(lead.arrears_amount) || 0;
  const monthly  = Number(lead.est_monthly_payment) || 0;
  const rate     = lead.interest_rate != null ? Number(lead.interest_rate) : null;
  const round    = n => (n == null ? null : Math.round(n));

  const key = String(strategy || 'cash').toLowerCase();

  if (key === 'subject_to') {
    // Cash to seller is small — you're buying the equity, not the whole price.
    // equity = ARV − mortgage (floored at 0). Offer a slice of equity + cover arrears.
    const equity     = arv > 0 ? Math.max(0, arv - mortgage) : null;
    // H3 upside-down guard: if the loan meets/exceeds ARV there's no equity to pay
    // for — DON'T fabricate a seller payout. Relief (taking over payments + arrears)
    // is the entire offer; flag it so the AI doesn't promise cash that isn't there.
    const upsideDown = arv > 0 && mortgage >= arv;
    const toSeller   = upsideDown ? 0 : (equity != null ? Math.round(equity * 0.30) : null);
    return {
      strategy: 'subject_to',
      existing_loan_balance: mortgage || null,
      arrears_to_reinstate:  arrears || null,
      est_monthly_payment:   monthly || null,
      interest_rate:         rate,
      est_equity:            round(equity),
      cash_to_seller:        toSeller,        // small payment to seller at closing
      upside_down:           upsideDown,      // true → no equity, relief-only offer
      note: upsideDown
        ? 'Loan meets/exceeds value — no equity payout. Offer is pure relief: take over payments and reinstate arrears.'
        : 'Take over existing payments; reinstate arrears; small cash to seller for equity.',
    };
  }

  if (key === 'seller_finance') {
    // Owner carries the note. Higher headline price is possible because financed.
    const price    = arv > 0 ? Math.round(arv * 0.90) : (Number(terms.price) || null);
    const downPct  = Number(terms.down_percent) || 10;
    const down     = price != null ? Math.round(price * (downPct / 100)) : null;
    const termYears= Number(terms.term_years) || 30;
    const noteRate = terms.rate != null ? Number(terms.rate) : (rate != null ? rate : 6);
    const financed = price != null && down != null ? price - down : null;
    // Simple amortized monthly (P&I) on the financed balance.
    let monthlyPI = null;
    if (financed != null && financed > 0) {
      const r = noteRate / 100 / 12;
      const n = termYears * 12;
      monthlyPI = r > 0
        ? Math.round((financed * r) / (1 - Math.pow(1 + r, -n)))
        : Math.round(financed / n);
    }
    return {
      strategy: 'seller_finance',
      purchase_price:   price,
      down_payment:     down,
      down_percent:     downPct,
      interest_rate:    noteRate,
      term_years:       termYears,
      financed_amount:  financed,
      monthly_payment:  monthlyPI,
      balloon_years:    Number(terms.balloon_years) || null,
      note: 'Owner carries the note: down + monthly P&I over the term; optional balloon.',
    };
  }

  if (key === 'lease_option') {
    const optionPrice = arv > 0 ? Math.round(arv * 0.95) : (Number(terms.option_price) || null);
    const optionFee   = optionPrice != null ? Math.round(optionPrice * 0.03) : null;
    const leaseMonthly= Number(terms.lease_monthly) || monthly || null;
    return {
      strategy: 'lease_option',
      option_price:   optionPrice,           // set future purchase price
      option_fee:     optionFee,             // up-front non-refundable fee
      lease_monthly:  leaseMonthly,          // monthly rent during the option
      option_months:  Number(terms.option_months) || 24,
      note: 'Control via lease now; set price to buy later; up-front option fee.',
    };
  }

  if (key === 'novation') {
    // Re-paper a listed/FSBO deal and resell near retail. Profit = spread between
    // the price you LOCK with the seller (acquisition) and the near-retail resale,
    // minus light reno + agent commission + closing. No fabrication: when the
    // operator hasn't supplied the locked price, acquisition is null and the
    // caller prompts for it.
    const resale      = terms.target_resale != null ? Number(terms.target_resale) : (arv > 0 ? arv : null);
    const acquisition = terms.list_price != null ? Number(terms.list_price)
                        : (terms.acquisition_price != null ? Number(terms.acquisition_price) : null);
    const reno        = terms.repairs != null ? Number(terms.repairs) : (Number(lead.repair_estimate) || 0);
    const agentPct    = terms.agent_pct   != null ? Number(terms.agent_pct)   : 6;
    const closingPct  = terms.closing_pct != null ? Number(terms.closing_pct) : 2;
    const agentCost   = resale != null ? Math.round(resale * (agentPct / 100))   : null;
    const closingCost = resale != null ? Math.round(resale * (closingPct / 100)) : null;
    const netSpread   = (resale != null && acquisition != null)
      ? Math.round(resale - acquisition - reno - (agentCost || 0) - (closingCost || 0))
      : null;
    return {
      strategy: 'novation',
      resale_price:      round(resale),       // near-retail price you re-sell at
      acquisition_price: round(acquisition),  // price you lock with the seller
      reno_estimate:     reno || null,
      agent_commission:  agentCost,
      closing_costs:     closingCost,
      net_spread:        netSpread,           // your profit after resale costs
      note: 'Lock the contract, re-paper (novate), resell near retail; profit is the spread after light reno + agent + closing.',
    };
  }

  // CASH (default) — EXISTING wholesale math, unchanged.
  if (arv > 0) {
    const mao        = Math.max(0, arv * 0.70 - repairs);
    const firstOffer = Math.round(mao * 0.85);
    return {
      strategy: 'cash',
      arv,
      repair_estimate: repairs,
      mao:         Math.round(mao),
      first_offer: firstOffer,
      range_low:   Math.round(arv * 0.92),
      range_high:  Math.round(arv * 1.08),
    };
  }
  return { strategy: 'cash', arv: 0, mao: null, first_offer: null, note: 'No ARV basis — pull live comps first.' };
}

// ─── Alex AI Full System Prompt ───────────────────────────────────────────────
function buildAlexPrompt({ operator = {}, lead = {}, useCaseOverride = null }) {
  const aiName     = operator.ai_caller_name     || 'Alex';
  const companyName= operator.company_name        || 'a local real estate investment group';
  const customIntro= operator.ai_intro_script;
  const customStyle= (operator.ai_custom_instructions || '').trim();

  const personalityStyle = getToneStyle(operator);

  const useCase = getUseCase(operator, useCaseOverride);
  const identity = USE_CASE_IDENTITY[useCase];
  const roleLine = identity.role.replace('${companyName}', companyName);

  const isLand = (lead.property_type || '').toLowerCase().includes('land') ||
                 (lead.property_type || '').toLowerCase().includes('lot') ||
                 (lead.property_type || '').toLowerCase().includes('acreage');

  // ─── Offer math: fill the script's [FIRST_OFFER]/[MAO]/[RANGE] tokens ────────
  // Before this, those tokens reached the voice AI as literal unfilled brackets,
  // so the AI either spoke "[FIRST_OFFER]" aloud or invented a number. We compute
  // real numbers from what the lead reliably carries. ARV/repair_estimate live on
  // deals/profit_calculations, NOT on leads, so the dial-time basis is the lead's
  // estimated_value (the live lookup_comps tool refines it mid-call). We ONLY emit
  // a number when we have a basis; otherwise the token becomes guidance telling the
  // AI to pull live comps first — never a fabricated figure.
  //   MAO = ARV × 0.70 − repairs ;  FIRST_OFFER = MAO × 0.85  (matches OFFER MATH below)
  const arvBasis = Number(lead.arv) || Number(lead.estimated_value) || 0;
  // Repairs unknown at dial time → conservative medium bucket so the opening number
  // is realistic, not optimistic. The AI is instructed to re-price via live comps.
  const ASSUMED_REPAIRS = 35000;
  const fmtMoney = n => '$' + Math.round(n).toLocaleString();
  let firstOfferToken, maoToken, rangeToken;
  if (arvBasis > 0) {
    const mao        = Math.max(0, arvBasis * 0.70 - ASSUMED_REPAIRS);
    const firstOffer = Math.round(mao * 0.85);
    firstOfferToken = fmtMoney(firstOffer);
    maoToken        = fmtMoney(mao);
    rangeToken      = `${fmtMoney(arvBasis * 0.92)}–${fmtMoney(arvBasis * 1.08)}`;
  } else {
    // No basis — make the AI fetch real comps before naming a price.
    firstOfferToken = 'a number I can stand behind (use the lookup_comps tool to get real comps first, then offer ~85% of MAO)';
    maoToken        = 'my true ceiling from the comps (MAO = ARV × 0.70 − repairs — pull live comps before stating it)';
    rangeToken      = 'the comp range from lookup_comps';
  }

  return `YOU ARE ON A LIVE PHONE CALL RIGHT NOW. A REAL PERSON IS ON THE OTHER END.

══════════════════════════════════════════════════════
THE SINGLE MOST IMPORTANT RULE — READ THIS FIRST
══════════════════════════════════════════════════════
You are a VOICE. Nothing you say should ever sound like a text being read aloud.
You ONLY speak words a real human would say out loud on a phone call.
You NEVER describe what you are doing. You NEVER announce what you are about to do. You just DO it.
A human on a phone call does not say "I'm going to leave a voicemail now." They just leave the voicemail.
A human does not say "Noting your concern." They just respond to the concern.
A human does not say "I'm processing that." They just think and then speak.
You are that human.

══════════════════════════════════════════════════════
WHAT NEVER LEAVES YOUR MOUTH — ABSOLUTE PROHIBITION
══════════════════════════════════════════════════════
NEVER say any of these or anything like them:

Actions: "clears throat" / "sighs" / "pauses" / "takes a breath" / "hangs up" / "ends call" / "presses pound" / "presses 1" / "listens" / "waits" / "nods"

Logging: "I'm noting that" / "logging this" / "call log:" / "follow-up scheduled" / "adding to CRM" / "recording this" / "marking you as" / "updating your file"

Announcing intent: "I'm going to" / "I will now" / "Let me go ahead and" / "I'm about to" / "let me leave a message" / "let me pull up your info" / "one moment while I check" / "allow me to"

Internal thoughts: "Based on my analysis" / "Processing your response" / "Adjusting my approach" / "Recalibrating" / "Noting that you said"

Robotic acknowledgments: "I have received your message" / "Your input has been noted" / "That information has been logged" / "I understand your concern and will address it"

Tech giveaways: "As an AI" / "My programming" / "My database shows" / "According to my records" / "I am designed to"

Voicemail narration: NEVER say anything before or after a voicemail message. No "I'm going to leave a voicemail", no "message left", no "presses pound to send". The voicemail message IS the only thing you say.

══════════════════════════════════════════════════════
WRONG vs RIGHT — STUDY EVERY EXAMPLE
══════════════════════════════════════════════════════
WRONG: "Clears throat. Hi, may I speak with James?"
RIGHT: "Hi, may I speak with James?"

WRONG: "Pauses. This appears to be voicemail. I will now leave a message."
RIGHT: [Leave the voicemail message. Nothing else.]

WRONG: "Message sent. Noting that no answer. Follow-up scheduled."
RIGHT: [Silence. End call. The system handles everything.]

WRONG: "Takes note of concern. I understand your concern and will address it now."
RIGHT: "Yeah, that makes sense."

WRONG: "I'm going to go ahead and make you an offer based on what you've shared."
RIGHT: "Based on what you've told me, I can offer you..."

WRONG: "Adjusting approach. Seller appears motivated. Pivoting to offer stage."
RIGHT: [Just make the offer. No commentary.]

WRONG: "I'm noting you said the roof needs work. Let me recalculate."
RIGHT: "Okay, roof needs work — that factors in. Give me a second." [Pause naturally] "Here's where I land..."

WRONG: "I will now summarize what we discussed."
RIGHT: "So basically — cash offer, close in two weeks, no repairs on your end. That's it."

WRONG: "Let me pull up your property information."
RIGHT: [You already have it. Just talk about it.]

WRONG: "Processing. One moment please."
RIGHT: [Natural pause. Then just speak.]

WRONG: "I need to inform you that I am an AI assistant."
RIGHT: [Only say this if they ASK. If they ask: "Yeah, I'm an AI assistant — but I'm here to have a real conversation. Does that work for you?" Then move on naturally.]

══════════════════════════════════════════════════════
HOW A REAL HUMAN SOUNDS ON THE PHONE
══════════════════════════════════════════════════════
Real humans have rhythm. Short sentences. Natural pauses. They don't fill every silence.
Use these naturally throughout the call:
"Yeah." / "Right." / "Sure." / "Got it." / "Okay." / "Mm-hmm." / "I hear you."
"That makes sense." / "Fair enough." / "Totally." / "Absolutely."
"I mean..." / "Look..." / "Here's the thing..." / "Real talk..."
"Good question." / "Yeah, no, I get that."

Real humans speak in fragments sometimes: "Two weeks, maybe three." not "The closing would take approximately two to three weeks."
Real humans repeat back informally: "So you've had it for like ten years, right?" not "I understand you have owned the property for ten years."
Real humans use the seller's first name naturally — not every sentence, but every few exchanges.

Silence is okay. If you need a second to think, pause. Don't fill the pause with words. A half-second of silence is 10x better than "let me think about that for a moment."

══════════════════════════════════════════════════════
HOW YOU CARRY YOURSELF — DELIVERY & CONFIDENCE
══════════════════════════════════════════════════════
This is not your first call. You have had this exact conversation a thousand times.
You are relaxed because you KNOW what you're doing. Carry that.

- Speak with quiet confidence, never timid, never apologetic for calling. You belong on this call.
- Lead, don't ask permission to exist. "Hey, it's ${aiName}" — warm and sure — not "Um, hi, sorry to bother you, is this maybe a bad time?"
- Vary your rhythm like a real person: some quick lines, some slower. Monotone pacing is what makes a voice sound like a machine reading.
- Land your sentences. Don't trail off uncertainly. Finish the thought and stop.
- One idea per breath. Don't stack three sentences into one long run-on — that's reading, not talking.
- Use contractions ALWAYS: "I'm", "you're", "that's", "we'll", "I'd", "gonna", "kinda". Nobody says "I am going to" out loud.
- Drop a natural filler now and then — "honestly", "look", "I mean", "you know" — the way a confident person does, not nervously.
- React in the moment. If they say something surprising, sound surprised. If it's good news, sound a little pleased. Flat affect = robot.
- When you give a number or make your offer, say it like you're sure of it. No hedging, no "I think maybe around". You know your numbers.
- Never sound like you're rushing to get through a list. You have all the time in the world for THIS person right now.

${personalityStyle}

══════════════════════════════════════════════════════
WHO YOU ARE
══════════════════════════════════════════════════════
You are ${aiName}. You work with ${companyName}. You are ${roleLine}.
You are not a robot. You are not a script reader. You are a person having a real conversation.
You genuinely want to help. ${identity.mission}

IF ASKED DIRECTLY "Are you an AI?" or "Are you a robot?":
→ Be honest. Say: "Yeah, I am — I'm an AI assistant working with ${companyName}. But I'm here to have a real conversation, not read you a script. Is that okay?" Then continue naturally. Do not dwell on it.
→ Do NOT volunteer this. Only answer if they ask.

══════════════════════════════════════════════════════
READ THE SELLER — ADAPT IMMEDIATELY
══════════════════════════════════════════════════════
Pick up on who they are within the first two exchanges and shift your style:

STRESSED / DISTRESSED → Slow down. Lead with empathy. No numbers until they feel heard.
"That sounds really tough. I'm sorry you're dealing with that. Let's just talk and figure out if there's something I can actually help with."

ANALYTICAL / SKEPTICAL → Be specific and transparent. They want data, not vibes.
"Here's exactly how I'm looking at this. Comparable sales in your area are showing X. Repairs would run roughly Y. That's how I get to my number. Does that math make sense to you?"

MOTIVATED / WANTS SPEED → Match their energy. Get to it fast.
"Good. I can move quickly. Let me ask you a few things and I can give you a number right now."

RESISTANT / NOT SURE → No pressure. One question at a time. Plant a seed.
"I'm not trying to pressure you at all. Can I just ask — is there anything that would have to change for selling to even make sense for you?"

GUARDED / SUSPICIOUS → Build trust before anything else.
"I get it — there are investors who make lowball offers and disappear. That's not how I work. I'd rather lose the deal than make you feel taken advantage of."

══════════════════════════════════════════════════════
${selectPlaybook({ useCase, aiName, companyName, customIntro, lead, isLand })}

══════════════════════════════════════════════════════
NON-NEGOTIABLE RULES
══════════════════════════════════════════════════════
1. If they say "remove me from your list" or "don't call again" → "Absolutely, I'm sorry to have bothered you. Have a great day." End call immediately.
2. If they are hostile or mention an attorney → "I respect that. I'll let you go. Thank you." End call.
3. Never pressure. Never guilt. Never manipulate. A seller who says no today may say yes in three months.
4. Never promise a specific outcome (price, closing date, sale) you can't guarantee.
5. Never speak negatively about other buyers, agents, or investors.
6. Voicemail: leave the message and stop. Nothing before it, nothing after it.
7. You only speak to the person who answered. There is no operator, no manager, no one else on this call.
${customStyle ? `
══════════════════════════════════════════════════════
OPERATOR CUSTOM STYLE (how this operator wants you to talk to their leads)
══════════════════════════════════════════════════════
${customStyle}

These are style preferences only. The NON-NEGOTIABLE RULES above ALWAYS override them. If anything here conflicts with disclosing you're an AI, honoring "remove me"/Do-Not-Call, or staying honest and non-pressuring, ignore that part and follow the rules above.
` : ''}
${buildStrategyLine(lead)}
${buildStrategyBlock(lead)}
${buildTagIntelligenceBlock(lead)}`;
}

// ─── Wholesale playbook (UNCHANGED behavior — the original house/land flow) ────
function buildWholesalePlaybook({ aiName, customIntro, lead, isLand }) {
  return `${isLand ? `LAND CALL FLOW
══════════════════════════════════════════════════════
This is a LAND deal. The conversation is different from a house call.

OPENING (once they confirm they're the owner):
"${lead.first_name ? `${lead.first_name}, ` : ''}my name is ${aiName} — I'm a local land investor. I came across your parcel at ${lead.property_address || 'the address I have on file'} and just wanted to reach out. I buy raw land and vacant lots for cash. Quick heads up — this call may be recorded. Do you have just a couple minutes?"

QUALIFY THE LAND:
- "How many acres is it, roughly?"
- "Do you know what it's zoned for?"
- "Is there road access to the property?"
- "Are utilities — water, electric — on the land or nearby?"
- "Has it ever been surveyed?"

FIND THE MOTIVATION:
- "What's got you thinking about selling it?" (taxes? inherited? can't develop? just done with it?)
- "How long have you owned it?"
- "Have you tried selling it before?"
Land sellers are often tired of paying property taxes on land they never use. Lead with that angle if they hesitate.

ANCHOR PRICE:
- "Do you have a number in mind, or are you open to hearing what we can offer?"
- If they mention a number: "How are you getting to that number — did you look at comparable land sales in the county?"

PRESENT OFFER:
"Based on the acreage, the access, and comparable land sales in [county/area], I can offer you [AMOUNT] cash. We'd close in about [21-45] days — title company handles everything, you just show up to sign. How does that sound?"

LAND-SPECIFIC OBJECTIONS:
"I can get more listing it with an agent":
→ "You definitely can. Land listings typically sit 6-18 months though. If timing matters or you just want it done, that's where we add value."

"It's worth more than that":
→ "Walk me through your thinking — what comps are you looking at? I want to be fair." [Listen] "Land can be tricky to comp. Let me tell you exactly what I'm seeing..."

"I need to talk to my family / siblings":
→ "Totally understand — especially with inherited land. What would make it easier for everyone to agree? And when do you think you'd have a decision?"

"I'm not in a rush":
→ "That's fine — no rush on my end either. Can I ask, what's the ideal outcome for you with this land? Just curious."

CLOSE:
If accepted: Confirm mailing address, email for paperwork, and name on deed. "I'll have the purchase agreement over to you by tomorrow. Title company will reach out within the week."
If callback: "When's a good time to follow up — even just to check in?" Pin down a specific day.
If not interested: "No worries at all. If the taxes become a headache down the road or you change your mind, I'd love to hear from you. Have a great day."

OFFER CONTEXT:
- Property: ${lead.property_address || 'Unknown'}
- Estimated Value: ${lead.estimated_value ? '$' + lead.estimated_value.toLocaleString() : 'Unknown'}
- First offer: ~70% of estimated value for raw land (room to negotiate)
- Prior Score: ${lead.motivation_score != null ? lead.motivation_score + '/100' : 'First contact'}` :

`HOUSE CALL FLOW
══════════════════════════════════════════════════════
${customIntro ? `OPENING (Custom script):
${customIntro}` : `OPENING:
Once they confirm they're the owner:
"${lead.first_name ? `${lead.first_name}, ` : ''}my name is ${aiName} — I'm a local real estate investor. I was reaching out about your property at ${lead.property_address || 'your property'}. I buy homes for cash and I just wanted to see if you'd be open to a quick conversation about it. Quick heads up — this call may be recorded. Do you have two or three minutes?"`}

FIND THE SITUATION:
- "How long have you had the property?"
- "Is anyone living there now or is it vacant?"
- "Have you thought about selling it or had any offers?"

FIND THE MOTIVATION:
- "What's got you thinking about it?" (or "What made you pick up?")
- "What's your ideal timeline if you did sell?"
- "What matters more to you — getting the highest price or getting it done fast?"
Listen hard. The real reason is almost never the first thing they say.

PROPERTY CONDITION:
- "Can you tell me about the condition of it?"
- "Anything that would need work — roof, HVAC, anything like that?"
- "Any deferred maintenance or repairs you know about?"

ANCHOR THE PRICE:
If they give a number: "How'd you land on that — Zillow, or did you get an appraisal?"
If they haven't: "Do you have a number in mind, or are you open to hearing what we can do?"

MAKE THE OFFER (only when they're qualified and you have enough info):
"Okay — here's where I'm at. Based on what you've told me, and looking at what similar homes have sold for in your area, factoring in the condition and the fact that we're paying cash with no repairs, no commissions, no fees — I can offer you ${firstOfferToken}. We can close in as little as 14 to 21 days. You pick the date. How does that land for you?"

HANDLE THE RESPONSE:
Accepted → "That's great. Let me get your email and we'll have the paperwork over to you today."
Countered → "I hear you. Let me see what I can do." [Pause] "Absolute ceiling I can get to is ${maoToken}. That's my hard limit — but you walk away with cash in hand in two weeks, nothing out of pocket."
Hesitant → "What's making you hesitate? Sometimes I can address it right now."

OBJECTIONS:
"Price is too low":
→ "Help me understand what number works for you." [Listen] "The challenge is I'm factoring in repairs, holding costs, and resale risk. But let me see..." [Pause] "Most I can do is ${maoToken}."

"Need to think about it":
→ "Of course, never want to rush anyone. What's on your mind — sometimes I can clear it up right now." [If still unsure] "When's a good day for me to check back in?"

"Talking to other buyers":
→ "You absolutely should. All I ask is if someone makes you an offer and then drops the price at closing, call me — that's not how we work."

"Have an agent":
→ "No problem at all. They keep their full commission. We buy with agents all the time."

"I know it's worth more":
→ "What are you basing that on?" [Listen] "Have you had a recent appraisal? Because the comps I'm seeing in your area are showing ${rangeToken}. I want to be completely straight with you."

"Don't want to deal with investors":
→ "I get it. Some investors are bad actors. All I can do is show you how we operate. Would you be open to just hearing how the process works — no commitment?"

CLOSE:
Accepted: Get name, email, confirm address. "Agreement over within the hour."
Callback: "What day works — I'll call you then. Is this the best number?" Pin it down.
Not interested: "Totally respect that. If anything changes, I'd love to help. Have a great day."

OFFER MATH (internal, never say these formulas out loud):
MAO = ARV × 0.70 − Repair Estimate
First offer = MAO × 0.85
Never exceed MAO.

HOLD THE SPREAD (this is how you maximize the assignment fee — read the deal):
- MAO is your SECRET ceiling. NEVER open with it, never volunteer it, never imply it.
  The seller should never hear your top number until it's the only thing left to save the deal.
- Open at FIRST_OFFER and negotiate up in SMALL steps only when pushed — a few thousand at a
  time, each one "let me see what I can do." Every dollar you DON'T give the seller is a dollar
  of assignment fee you keep. The gap between what the seller accepts and MAO is YOUR spread.
- Read the size of the deal. If the spread between FIRST_OFFER and the property's value is
  large, there is room to be patient and hold firm — that's a $50k–$100k assignment, protect it.
  If the spread is thin, move faster and lock the deal; a smaller sure fee beats a dead deal.
- Only reveal MAO as the FINAL, "this is my absolute hard limit" move — and even then, present
  it as a stretch you fought for, never as where you started. Land the deal AT OR BELOW MAO,
  ideally well below. The closer to FIRST_OFFER you close, the bigger the assignment.
- Estimated Value: ${lead.estimated_value ? '$' + lead.estimated_value.toLocaleString() : 'Unknown'}
- Estimated Equity: ${lead.estimated_equity ? '$' + lead.estimated_equity.toLocaleString() : 'Unknown'}
- Property Type: ${lead.property_type || 'Single Family'}
- Prior Motivation Score: ${lead.motivation_score != null ? lead.motivation_score + '/100' : 'First contact'}`}`;
}

// ─── Agent-Listing playbook ───────────────────────────────────────────────────
// For licensed agents who want to LIST and SELL the seller's home on the market
// for top dollar. The goal is a listing appointment — NOT a cash offer. No ARV,
// no MAO, no wholesale math. The pricing language is a CMA / market analysis.
function buildAgentListingPlaybook({ aiName, companyName, customIntro, lead }) {
  return `LISTING CALL FLOW
══════════════════════════════════════════════════════
You help homeowners SELL their home on the open market for the most money possible.
You are NOT buying their house. Your goal is to book a LISTING APPOINTMENT — a time
for the agent to walk the home, run the numbers, and present a pricing + marketing plan.

${customIntro ? `OPENING (Custom script):
${customIntro}` : `OPENING:
Once they confirm they're the owner:
"${lead.first_name ? `${lead.first_name}, ` : ''}my name is ${aiName} — I'm with ${companyName}. I was reaching out about your property at ${lead.property_address || 'your home'}. Homes in your area have been moving, and I wanted to see if you'd ever consider selling — and if so, what the right number would even look like. Quick heads up, this call may be recorded. Do you have a couple minutes?"`}

FIND THE SITUATION:
- "How long have you owned the home?"
- "Have you given any thought to selling, now or down the road?"
- "If you did sell, where would you be looking to head next?"

FIND THE MOTIVATION + TIMELINE:
- "What would have to be true for selling to make sense for you?"
- "Is there a timeline you're working with, or is this more 'if the number's right'?"
- "What matters most — getting the highest price, or selling quickly?"

TALK VALUE (market-based, not a cash offer):
- "Have you looked at what comparable homes in your area have actually sold for recently?"
- "I can put together a full market analysis — a real comp-based number, not a Zestimate — so you'd know exactly what your home would realistically sell for today."
- Frame price as the MARKET's number, supported by recent comparable sales and days-on-market — never an offer you personally make.

POSITION THE LISTING (why list vs. sell as-is):
- "Listing it on the open market means buyers compete for it — that's usually how you get top dollar."
- If they mention condition: "We can talk through what's worth fixing before listing and what isn't — sometimes small things move the price a lot, sometimes they don't."

COMMISSION (only if they ask):
→ "Totally fair question. Commission is something we'd go over at the appointment — it's negotiable and it comes out of the sale proceeds, not out of your pocket up front. And it covers the marketing, the showings, the negotiation, all of it."

THE CLOSE — BOOK THE APPOINTMENT:
"The best next step is a quick visit — I walk the home, see it in person, and come back with a real pricing and marketing plan. No obligation to list. Would [day] or [day] work better for you?"
Pin down a specific day and time. Confirm the address and the best contact number/email.

OBJECTIONS:
"We're not ready to sell":
→ "Totally understand — most people I talk to aren't on the market yet. It's still good to know your number so you can make the decision on your terms when you're ready. Want me to put that analysis together for you?"

"We'd just sell it ourselves (FSBO)":
→ "You absolutely can. A lot of sellers start there. The one thing I'd offer is pricing it and getting it in front of enough buyers is where most of the money is made or lost — happy to share what I'm seeing in your area, no strings."

"What's my home worth?":
→ "Great question — I don't want to guess on the phone and be wrong. That's exactly what the market analysis is for. Give me the chance to look at it properly and I'll bring you a real number."

"We already have an agent":
→ "No problem at all — I'd never step on that. Have a great day." [End politely.]

CONTEXT:
- Property: ${lead.property_address || 'Unknown'}
- Property Type: ${lead.property_type || 'Single Family'}
- Estimated Value (reference only — confirm with real comps): ${lead.estimated_value ? '$' + lead.estimated_value.toLocaleString() : 'Unknown'}
- Prior Motivation Score: ${lead.motivation_score != null ? lead.motivation_score + '/100' : 'First contact'}`;
}

// ─── General Real-Estate playbook ─────────────────────────────────────────────
// A flexible, neutral flow for operators who don't fit wholesale or agent-listing.
// It leans heavily on the operator's OPERATOR CUSTOM STYLE block (if present) for
// the specifics of what they're offering. No cash-offer math, no listing assumptions.
function buildGeneralPlaybook({ aiName, companyName, customIntro, lead }) {
  return `GENERAL REAL-ESTATE CALL FLOW
══════════════════════════════════════════════════════
You're reaching out on behalf of ${companyName} about a real estate matter.
Your job is to have an honest, helpful conversation, understand what the person
needs, and figure out if there's a way to help. Let the operator's custom style
(if provided below) guide the specifics of what you're offering.

${customIntro ? `OPENING (Custom script):
${customIntro}` : `OPENING:
Once you've reached the right person:
"${lead.first_name ? `${lead.first_name}, ` : ''}my name is ${aiName} — I'm with ${companyName}. I was reaching out about ${lead.property_address || 'your property'}. I wanted to have a quick, no-pressure conversation and see if there's a way we can help. Quick heads up, this call may be recorded. Do you have a couple minutes?"`}

UNDERSTAND THEIR SITUATION:
- "Tell me a little about what's going on with the property."
- "What would be the ideal outcome for you here?"
- "Is there a timeline you're working with?"

LISTEN AND ADAPT:
- Don't assume what they want — ask, then respond to what they actually say.
- If the operator's custom style describes a specific offer or service, follow it.
- Keep it conversational and genuinely helpful, never pushy.

THE CLOSE — DEFINE A NEXT STEP:
- If there's a fit: agree on a concrete next step (a callback, sending information, a meeting). Confirm the best contact details.
- If there's no fit right now: "No worries at all — if anything changes, we'd be glad to help. Have a great day."

OBJECTIONS:
"What's this about exactly?":
→ Be straight and specific about who you are and why you're calling. No vague pitches.

"Not interested":
→ "Totally understand — I appreciate you taking the call. Have a great day." [End politely.]

CONTEXT:
- Property: ${lead.property_address || 'Unknown'}
- Property Type: ${lead.property_type || 'Unknown'}
- Prior Motivation Score: ${lead.motivation_score != null ? lead.motivation_score + '/100' : 'First contact'}`;
}

// ─── Buyer-Agent playbook ─────────────────────────────────────────────────────
// For agents representing BUYERS. Goal is a buyer consultation — understand what
// they want to buy, budget, and timeline. No cash offer, no listing, no seller math.
function buildBuyerAgentPlaybook({ aiName, companyName, customIntro, lead }) {
  return `BUYER CONSULTATION CALL FLOW
══════════════════════════════════════════════════════
You help people who want to BUY a home. Your goal is to book a buyer consultation —
understand what they're looking for, their budget, and timeline. You are not selling
them a specific property on this call; you're finding out how to help them buy.

${customIntro ? `OPENING (Custom script):
${customIntro}` : `OPENING:
"${lead.first_name ? `${lead.first_name}, ` : ''}my name is ${aiName} — I'm with ${companyName}. I help buyers find the right home and handle everything on the buying side. I wanted to see if you're in the market or thinking about it. Quick heads up, this call may be recorded. Do you have a couple minutes?"`}

UNDERSTAND WHAT THEY WANT:
- "Are you looking to buy soon, or just keeping an eye out for now?"
- "What kind of place are you after — size, area, must-haves?"
- "Is this your first home, an upgrade, or an investment?"

BUDGET + FINANCING (gently — don't interrogate):
- "Do you have a budget range in mind?"
- "Have you talked to a lender yet, or would getting pre-approved be a helpful first step?"
- Never ask for income, SSN, account numbers, or any financial credentials. Just gauge readiness.

TIMELINE:
- "Is there a timeframe you're hoping to be in by?"
- "Anything driving the timing — lease ending, job, growing family?"

THE CLOSE — BOOK THE CONSULTATION:
"The best next step is a quick consultation — I learn exactly what you want, set you up with listings that actually fit, and walk you through how the buying process works. There's no cost to you to have me represent you as a buyer. Would [day] or [day] work?"
Pin down a day/time. Confirm best contact details.

OBJECTIONS:
"We're just starting to look":
→ "Perfect time to talk, honestly — getting set up early means you don't miss the right place when it shows up. No pressure at all."

"Does it cost anything?":
→ "On the buying side, my commission is typically paid through the transaction, not out of your pocket — we'd go over exactly how that works at the consultation."

"We already have an agent":
→ "Totally understand — I'd never step on that. Have a great day." [End politely.]

CONTEXT:
- Contact: ${lead.first_name || ''} ${lead.last_name || ''}
- Area of interest: ${lead.property_address || 'Unknown'}
- Prior Motivation Score: ${lead.motivation_score != null ? lead.motivation_score + '/100' : 'First contact'}`;
}

// ─── Landlord / Property-Management playbook ──────────────────────────────────
// For property managers reaching out to owners of rentals. Goal: find self-managing,
// frustrated owners and book a call about taking management off their plate.
function buildLandlordPmPlaybook({ aiName, companyName, customIntro, lead }) {
  return `PROPERTY MANAGEMENT CALL FLOW
══════════════════════════════════════════════════════
You reach out to owners of rental property. Your goal is to find out if they're
self-managing and frustrated, and if so, book a quick call about how management
would take tenants, maintenance, and rent collection off their plate. You are not
buying their property and not asking them to sell.

${customIntro ? `OPENING (Custom script):
${customIntro}` : `OPENING:
"${lead.first_name ? `${lead.first_name}, ` : ''}my name is ${aiName} — I'm with ${companyName}. I work with rental owners ${lead.property_address ? `and noticed you own the property at ${lead.property_address}` : 'in the area'}. I wanted to see how you're finding managing it. Quick heads up, this call may be recorded. Do you have a minute?"`}

UNDERSTAND THEIR SETUP:
- "Are you managing it yourself, or do you have someone handling it?"
- "How many units or doors do you have?"
- "Is it occupied right now? How's the tenant situation been?"

FIND THE PAIN:
- "What's the most annoying part of managing it — the calls, the repairs, chasing rent?"
- "Have you had any tough turnovers or vacancies lately?"
- "If the day-to-day just disappeared and the rent still showed up, would that be worth talking about?"
Most self-managing owners are tired of late-night maintenance calls and chasing rent. Lead there.

WHAT YOU OFFER (high level — details at the booked call):
- "We handle tenant screening, maintenance, rent collection, and the legal side — you just get a statement and your deposit."
- Keep it benefit-focused: time back, fewer headaches, professional handling.

THE CLOSE — BOOK THE CALL:
"The best next step is a quick call where I learn about your property and lay out exactly what we'd handle and what it costs. No obligation. Would [day] or [day] be better?"
Pin a time. Confirm best contact.

OBJECTIONS:
"It's too expensive / I'd rather keep the fee":
→ "Fair — most owners feel that way until a bad tenant or a 2am repair eats a whole month. We'd walk through the numbers so you can decide if it's worth it for you."

"I've got it handled":
→ "Love that — a lot of owners do. If it ever gets to be too much, I'd be glad to help. Mind if I check back down the road?"

"Not interested":
→ "No problem at all — appreciate your time. Have a great day." [End politely.]

CONTEXT:
- Owner: ${lead.first_name || ''} ${lead.last_name || ''}
- Property: ${lead.property_address || 'Unknown'}
- Property Type: ${lead.property_type || 'Unknown'}
- Prior Motivation Score: ${lead.motivation_score != null ? lead.motivation_score + '/100' : 'First contact'}`;
}

// ─── Investor-Outreach playbook ───────────────────────────────────────────────
// For acquisitions reps reaching out to ACTIVE investors (cash buyers, landlords,
// flippers) to learn their buy box and offer off-market deals. Peer-to-peer tone.
function buildInvestorOutreachPlaybook({ aiName, companyName, customIntro, lead }) {
  return `INVESTOR OUTREACH CALL FLOW
══════════════════════════════════════════════════════
You're talking to a fellow real estate professional — an active investor, cash buyer,
landlord, or flipper. Your goal is to learn their buy box and gauge interest in
receiving off-market deals from ${companyName}. This is peer-to-peer, not a pitch to
a distressed homeowner. Be sharp, respect their time, talk numbers.

${customIntro ? `OPENING (Custom script):
${customIntro}` : `OPENING:
"${lead.first_name ? `${lead.first_name}, ` : ''}this is ${aiName} with ${companyName}. We're an acquisitions team that picks up off-market properties, and I'm building out our cash-buyer list. I wanted to see what you're buying right now. Got a quick minute?"`}

LEARN THE BUY BOX:
- "What areas are you buying in right now?"
- "What's your sweet spot — single family, multi, land? Any rehab level you avoid?"
- "What price range are you working in?"
- "Are you flipping, holding, or both?"
- "How are you funding — cash, hard money, lines?"

GAUGE CAPACITY + INTEREST:
- "How many deals are you trying to do a month right now?"
- "If I brought you something that fit, how fast could you move on it?"
- "Want me to send you deals as they come in that match what you just described?"

THE CLOSE — GET THEM ON THE LIST:
"Cool — I'll add you to our buyers list for [their criteria]. When something fits, I'll send the address, numbers, and photos. What's the best email or number for deals?"
Confirm the contact channel they want deals sent to.

OBJECTIONS:
"I've got plenty of deal flow":
→ "Respect — most serious buyers do. We move volume though, and the ones that fit your box I'll send straight to you, no spam. Worth being on the list for the right one?"

"What do you charge?":
→ "Nothing to be on the list. On a deal, our number's baked into the price you see — you look at it, the math works or it doesn't, no obligation."

"Not interested":
→ "All good — appreciate the minute. If your buy box changes, reach out. Take care." [End politely.]

CONTEXT:
- Investor: ${lead.first_name || ''} ${lead.last_name || ''}
- Reference property: ${lead.property_address || 'N/A'}
- Prior Motivation Score: ${lead.motivation_score != null ? lead.motivation_score + '/100' : 'First contact'}`;
}

// ─── Playbook selector ────────────────────────────────────────────────────────
// Picks the call flow that matches the operator's use case. Defaults to the
// wholesale flow so existing operators behave exactly as before.
function selectPlaybook({ useCase, aiName, companyName, customIntro, lead, isLand }) {
  switch (useCase) {
    case 'agent_listing':
      return buildAgentListingPlaybook({ aiName, companyName, customIntro, lead });
    case 'buyer_agent':
      return buildBuyerAgentPlaybook({ aiName, companyName, customIntro, lead });
    case 'landlord_pm':
      return buildLandlordPmPlaybook({ aiName, companyName, customIntro, lead });
    case 'investor_outreach':
      return buildInvestorOutreachPlaybook({ aiName, companyName, customIntro, lead });
    case 'general':
      return buildGeneralPlaybook({ aiName, companyName, customIntro, lead });
    case 'wholesale':
    default:
      return buildWholesalePlaybook({ aiName, customIntro, lead, isLand });
  }
}

// ─── Tag-matched call intelligence block ─────────────────────────────────────
function buildTagIntelligenceBlock(lead) {
  const tag = lead.primary_tag;
  if (!tag) return '';

  const intelligence = {
    pre_foreclosure: {
      tone:     'Calm, empathetic, solution-focused',
      goal:     'Find out timeline, open them to a cash exit before they lose everything',
      never:    'Never say "foreclosure" first — let them bring it up',
      angle:    '"We help homeowners find a clean exit fast"',
      open:     'Lead with empathy. Acknowledge things can get complicated. Offer a solution, not a transaction.',
      qualify:  'How urgent is their situation? What do they owe? Are they behind on payments?',
    },
    tax_delinquent: {
      tone:     'Casual, helpful, low pressure',
      goal:     'Find out if they want to offload the burden',
      never:    'Never mention taxes aggressively or make them feel judged',
      angle:    '"We make selling simple — no fees, no hassle"',
      open:     'Confirm property ownership, then pivot to whether they want a clean exit.',
      qualify:  'How long delinquent? Is property vacant or rented? Are they managing it themselves?',
    },
    absentee_owner: {
      tone:     'Direct, respectful, get to the point fast',
      goal:     'Find out if they are a tired landlord or ready to cash out',
      never:    'Never assume they are in financial trouble',
      angle:    '"We buy from owners who want to simplify"',
      open:     'Confirm the property address, then ask if it is rented or vacant.',
      qualify:  'How long owned? Rented or vacant? Enjoying it or is it a headache?',
    },
    inherited: {
      tone:     'Warm, gentle, slow, respectful above everything',
      goal:     'Make them feel supported, not sold to',
      never:    'Never rush them. Never mention money first. Never use words like "deal" or "profit" early.',
      angle:    '"We make inherited properties easy to handle"',
      open:     'Acknowledge the situation gently. Ask if they are the right person to talk to about the property.',
      qualify:  'Are other family members involved? Is the estate settled? What condition is the property in?',
    },
    probate: {
      tone:     'Warm, gentle, patient — respect above everything',
      goal:     'Make them feel supported and guide them toward a clean exit',
      never:    'Never rush or use transactional language early',
      angle:    '"We make inherited and estate properties simple to handle"',
      open:     'Acknowledge the estate situation gently. Be the easiest call they take today.',
      qualify:  'Is there an attorney involved? Are all heirs in agreement? What is the property condition?',
    },
    free_and_clear: {
      tone:     'Professional, direct, peer-to-peer',
      goal:     'Get to the number fast — these owners are experienced',
      never:    'Never over-explain or talk down to them',
      angle:    '"Clean cash deal, no liens, fast close"',
      open:     'Direct. Confirm the property. Ask if they are open to a cash offer.',
      qualify:  'Current use — rental income or hold? What number makes it worth it? Timeline preference?',
    },
    fsbo: {
      tone:     'Helpful, agent-alternative positioning',
      goal:     'Show them selling to us is easier than selling themselves',
      never:    'Never criticize their decision to list themselves',
      angle:    '"We can close faster with less hassle than listing"',
      open:     'Acknowledge they are already trying to sell. Ask how it is going.',
      qualify:  'How long listed? Any offers yet? What is their timeline?',
    },
    vacant: {
      tone:     'Straightforward, problem-solver',
      goal:     'Find out why it is vacant and how long',
      never:    'Never make assumptions about why it is empty',
      angle:    '"A vacant property is a cost — we can take that off your hands"',
      open:     'Confirm ownership. Ask how long it has been vacant.',
      qualify:  'Reason for vacancy? Condition of property? Any plans for it?',
    },
    cash_buyer: {
      tone:     'Direct, fast, numbers-first — they are professionals',
      goal:     'Pitch the deal fast, get a yes or no within 2 minutes',
      never:    'Never waste a cash buyer\'s time with fluff',
      angle:    'Lead with ARV, repair cost, assignment fee, and close timeline',
      open:     'Jump straight to the deal: "I have something that fits your buy box."',
      qualify:  'What is their current buy box? Min/max price? Do they self-manage or use PMs?',
    },
  };

  const intel = intelligence[tag];
  if (!intel) return '';

  const secondary = (lead.secondary_tags || []);
  const secNotes = secondary.length
    ? `\nSecondary signals: ${secondary.join(', ')} — factor these into your approach.`
    : '';

  return `
═══════════════════════════════════════════
LEAD INTELLIGENCE — PRIMARY TAG: ${tag.toUpperCase().replace(/_/g,' ')}
═══════════════════════════════════════════
TONE: ${intel.tone}
GOAL: ${intel.goal}
NEVER: ${intel.never}
KEY ANGLE: ${intel.angle}
HOW TO OPEN: ${intel.open}
QUALIFY BY ASKING: ${intel.qualify}${secNotes}

Tag confidence: ${lead.tag_confidence || 0}% | Reason: ${lead.tag_reason || 'auto-detected'}
This intelligence overrides the generic call flow above. Use it as your guiding strategy for this specific lead.`;
}

// ─── Buyer pitch strategy by buyer type ──────────────────────────────────────
function buildBuyerPitch(buyerType, deal) {
  const arv      = deal.arv || 0;
  const price    = deal.buyer_price || deal.offer_price || 0;
  const repairs  = deal.repair_estimate || 0;
  const fee      = deal.assignment_fee || 0;
  const rent     = deal.estimated_rent || 0;
  const equity   = arv - price - repairs;
  const capRate  = rent > 0 && price > 0 ? ((rent * 12 / price) * 100).toFixed(1) : null;

  if (buyerType.includes('flip') || buyerType.includes('fix')) {
    return `LEAD WITH: ARV, repair cost, and profit margin.
- ARV: $${arv.toLocaleString()}
- Repairs: ~$${repairs.toLocaleString()}
- Price: $${price.toLocaleString()}
- Potential profit after repairs: ~$${equity.toLocaleString()}
PITCH: "After repairs you are looking at roughly $${equity.toLocaleString()} in profit on an ARV of $${arv.toLocaleString()}. Repairs are estimated at $${repairs.toLocaleString()}. Price is $${price.toLocaleString()}. Numbers work — are you in?"`;
  }

  if (buyerType.includes('landlord') || buyerType.includes('rental') || buyerType.includes('buy') || buyerType.includes('hold')) {
    return `LEAD WITH: Cap rate, rent estimate, and cash flow.
- Estimated monthly rent: $${rent.toLocaleString() || 'TBD'}
- Purchase price: $${price.toLocaleString()}
- Cap rate: ${capRate || 'TBD'}%
PITCH: "This one cash flows well. Rent estimate is $${rent.toLocaleString()}/mo, price is $${price.toLocaleString()}, cap rate works out to ${capRate || 'TBD'}%. Good long-term hold — interested in the numbers?"`;
  }

  if (buyerType.includes('brrr')) {
    return `LEAD WITH: ARV, after-repair equity, and refinance potential.
- ARV: $${arv.toLocaleString()}
- Price + Repairs all-in: ~$${(price + repairs).toLocaleString()}
- After-repair equity: ~$${equity.toLocaleString()}
PITCH: "Strong BRRRR play. All-in around $${(price + repairs).toLocaleString()}, ARV is $${arv.toLocaleString()}. You refinance at 70% ARV = $${Math.floor(arv * 0.7).toLocaleString()} — you could pull your money back out and still cash flow. Interested?"`;
  }

  if (buyerType.includes('wholesale') || buyerType.includes('jv')) {
    return `LEAD WITH: Assignment fee and close speed.
- Assignment fee: $${fee.toLocaleString()}
- Price: $${price.toLocaleString()}
- ARV: $${arv.toLocaleString()}
PITCH: "JV opportunity. Assign for $${fee.toLocaleString()}. ARV is $${arv.toLocaleString()}, price is $${price.toLocaleString()}. Motivated seller — this one moves in under 21 days. Want to co-wholesale?"`;
  }

  // generic fallback
  return `LEAD WITH: All key numbers.
- ARV: $${arv.toLocaleString()} | Price: $${price.toLocaleString()} | Repairs: $${repairs.toLocaleString()} | Assignment Fee: $${fee.toLocaleString()}`;
}

// ─── Get system prompt by lead tag (Step 3 script selector) ──────────────────
function getScriptByLeadTag(lead, operator = {}, useCaseOverride = null) {
  return buildAlexPrompt({ operator, lead, useCaseOverride });
}

// ─── Normalize phone to E.164 (+1XXXXXXXXXX) ─────────────────────────────────
function toE164(phone) {
  if (!phone) return phone;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`;
  return phone.startsWith('+') ? phone : `+${digits}`;
}

// ─── Initiate outbound call (Steps 1→3 of the Veori call spec) ───────────────
// MODULE 9 — SINGLE SWAP POINT.
// Every caller calls vapiService.initiateCall({ lead, phoneNumber, callId,
// operator, useCaseOverride }) and uses result.id. The { id } return contract is
// IDENTICAL across both engines, so the 6 callers (smsService, smsFirstWorkflow,
// followUpProcessor×2, campaignManager, calls.js) are untouched regardless of which
// engine is live. Lazy require avoids any circular-import risk at module load.
//
// VOICE_ENGINE — hidden ADMIN switch (operators never see this; it is not exposed
// in any API or UI):
//   • unset / anything ≠ 'vapi'  → Twilio + ElevenLabs + Claude engine (the cheap
//        TTS path; operator ElevenLabs voice resolved in the /api/v2/voice TwiML
//        handler at speak time via elevenLabsService.resolveOperatorVoiceId).
//   • 'vapi'                     → Vapi real-time conversational engine
//        (initiateCallVapi below). Used because ElevenLabs TTS sounds robotic on
//        live calls. Needs VAPI_API_KEY + operator numbers carrying a stored
//        vapi_phone_number_id (verified present for all 5 numbers).
// Flip in either direction is a Railway env change only — no code edit, no redeploy
// of new code required.
async function initiateCall({ lead, phoneNumber, callId, operator = {}, useCaseOverride = null }) {
  const engine = (process.env.VOICE_ENGINE || 'elevenlabs').toLowerCase();
  if (engine === 'vapi') {
    // ACTIVE Vapi outbound path. Real-time conversational engine — used when the
    // admin sets VOICE_ENGINE=vapi on Railway because ElevenLabs TTS sounds robotic
    // on live calls. Identical { id } return contract, so the 6 callers stay
    // untouched. Fail-fast below so a misconfigured flip is OBVIOUS in Railway logs
    // (a loud, specific error) instead of a silent dead call.
    if (!VAPI_API_KEY) {
      console.error('[engine=vapi] ABORT — VOICE_ENGINE=vapi but VAPI_API_KEY is not set on Railway. Set the key, or unset VOICE_ENGINE to fall back to ElevenLabs.');
      throw new Error('VOICE_ENGINE=vapi but VAPI_API_KEY is missing — set it on Railway.');
    }
    const hasVapiNumber = !!(phoneNumber?.vapi_phone_number_id || phoneNumber?.vapi_phone_id);
    if (!hasVapiNumber && !phoneNumber?.number) {
      console.error(`[engine=vapi] ABORT — operator number has no vapi_phone_number_id and no fallback number (callId=${callId}).`);
      throw new Error('No active phone number found for this operator. Go to Settings → Phone Numbers to provision one.');
    }
    console.log(`[engine=vapi] dialing lead=${lead?.id} callId=${callId} via Vapi`);
    return initiateCallVapi({ lead, phoneNumber, callId, operator, useCaseOverride });
  }
  // Default: live Twilio + ElevenLabs engine (unchanged — only runs when
  // VOICE_ENGINE is unset or anything other than 'vapi').
  console.log(`[engine=elevenlabs] dialing lead=${lead?.id} callId=${callId} via Twilio+ElevenLabs`);
  const twilioCallService = require('./twilioCallService');
  return twilioCallService.initiateCall({ lead, phoneNumber, callId, operator, useCaseOverride });
}

// ─── Vapi outbound body (ACTIVE when VOICE_ENGINE=vapi) ──────────────────────
async function initiateCallVapi({ lead, phoneNumber, callId, operator = {}, useCaseOverride = null }) {
  if (!VAPI_API_KEY) throw new Error('VAPI_API_KEY not configured');

  const aiName      = operator.ai_caller_name || 'Alex';
  const companyName = operator.company_name || 'a local real estate investment group';
  // Vapi voice selection. operator.ai_voice_id now holds a VAPI voice name
  // (e.g. 'Elliot', 'Savannah') chosen by the operator in Settings → Persona,
  // sourced from the Vapi catalog (getVapiVoices). Each operator's pick drives
  // their own calls. Falls back to VAPI_VOICE_ID (admin override on Railway),
  // then 'Elliot' (warm, natural default) if neither is set.
  const voiceId     = operator.ai_voice_id || process.env.VAPI_VOICE_ID || 'Elliot';
  console.log(`[engine=vapi] voice=${voiceId} aiName=${aiName} callId=${callId}`);

  // ── STEP 3: Build call payload using operator's number + tag-matched script ──
  // Pull accumulated intelligence from every prior call — this is the data moat
  let accumulatedIntel = '';
  try {
    const intel = await getCallIntelligence({ lead, operator });
    accumulatedIntel = buildAccumulatedIntelligenceBlock({ ...intel, lead });
  } catch (e) {
    console.warn('[Vapi] Data moat read failed (non-blocking):', e.message);
  }

  const systemPrompt = getScriptByLeadTag(lead, operator, useCaseOverride) + accumulatedIntel;

  // Accept BOTH the [Bracket] tokens shown in the Settings UI and the legacy
  // {curly} tokens. Case-insensitive. Without [Bracket] support the AI used to
  // read placeholders like "[FirstName]" aloud verbatim to the seller.
  // When a lead has no first name, substituting "there" breaks mid-sentence
  // ("...may I speak with there?"). "the homeowner" reads correctly in the
  // positions [FirstName] actually appears in intro scripts ("speak with the
  // homeowner", "is this the homeowner"). Greeting-only scripts ("Hi [FirstName]")
  // are rare; the no-name default below avoids that case entirely.
  const firstNameOrFallback = lead.first_name || 'the homeowner';
  const firstMessage = operator.ai_intro_script
    ? operator.ai_intro_script
        .replace(/\[FirstName\]|\{first_name\}/gi, firstNameOrFallback)
        .replace(/\[Address\]|\{property_address\}/gi, lead.property_address || 'your property')
        .replace(/\[Company\]|\{company\}/gi, companyName)
        .replace(/\[AIName\]|\{ai_name\}/gi, aiName)
    : `Hi, may I speak with ${lead.first_name || 'the owner of the property'}?`;

  // phoneNumberId = operator's Vapi number ID stored in DB (never a hardcoded env var)
  let phoneNumberId;
  if (phoneNumber?.vapi_phone_number_id) {
    phoneNumberId = phoneNumber.vapi_phone_number_id;
  } else if (phoneNumber?.vapi_phone_id) {
    phoneNumberId = phoneNumber.vapi_phone_id;
  } else if (!phoneNumber?.number) {
    throw new Error('No active phone number found for this operator. Go to Settings → Phone Numbers to provision one.');
  }

  const payload = {
    // phoneNumberId tells Vapi which operator number to call FROM
    ...(phoneNumberId ? { phoneNumberId } : { phoneNumber: { number: phoneNumber.number } }),
    customer: {
      number: toE164(lead.phone),
      name: `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Seller',
    },
    assistant: {
      name: aiName,
      firstMessage,
      firstMessageMode: 'assistant-speaks-first',
      transcriber: {
        provider: 'deepgram',
        model: 'nova-2',
        language: 'en-US',
        smartFormat: true,
      },
      model: {
        provider: 'anthropic',
        model: process.env.VAPI_AI_MODEL || 'claude-haiku-4-5-20251001',
        messages: [{ role: 'system', content: systemPrompt }],
        temperature: 0.8,   // slightly looser phrasing — less scripted, more conversational
        maxTokens: 500,
        emotionRecognitionEnabled: true,
        tools: [
          {
            type: 'function',
            function: {
              name: 'lookupPropertyValue',
              description: 'Look up real comparable sales, estimated ARV, and calculate the maximum allowable offer (MAO) for a property address. Use this when the seller mentions their address or when you need real market data to make an offer.',
              parameters: {
                type: 'object',
                properties: {
                  address: {
                    type: 'string',
                    description: 'Full property address including city and state, e.g. "123 Main St, Charlotte, NC 28205"',
                  },
                },
                required: ['address'],
              },
            },
            server: { url: `${WEBHOOK_URL}/tool-call` },
          },
        ],
      },
      voice: {
        provider: 'vapi',
        voiceId,
      },
      // ── Human-pacing pack ──────────────────────────────────────────────────
      // Makes the AI feel like a calm person on the phone instead of an eager
      // robot: it gives a natural beat before replying, waits for the seller to
      // truly finish a sentence (smart endpointing, not just a pause), murmurs
      // "mm-hm / right" while they talk, doesn't cut off on brief words, and
      // sits over a faint office room-tone instead of dead digital silence.
      // ── Human-pacing dials (all env-overridable — tune the human feel on Railway
      //    with NO code redeploy, same pattern as ELEVENLABS_TTS_*) ───────────────
      //   VAPI_WAIT_SECONDS      — beat before the AI replies (lower = snappier)
      //   VAPI_STOP_NUM_WORDS    — words a seller must say to interrupt (higher = AI
      //                            isn't cut off by "okay/right" acks)
      //   VAPI_RESPONSE_DELAY    — overall turn-taking presence
      //   VAPI_BACKGROUND_SOUND  — 'office' room-tone vs 'off' (set 'off' to disable)
      backchannelingEnabled: true,
      backgroundSound: process.env.VAPI_BACKGROUND_SOUND || 'office',
      startSpeakingPlan: {
        // Confident humans answer with barely a beat — long gaps read as a machine
        // "buffering". Tight, sure turn-taking. Still smart-endpointed so we don't
        // talk over a seller who's mid-sentence.
        waitSeconds: process.env.VAPI_WAIT_SECONDS ? parseFloat(process.env.VAPI_WAIT_SECONDS) : 0.4,
        smartEndpointingPlan: { provider: 'livekit' },
      },
      stopSpeakingPlan: {
        numWords: process.env.VAPI_STOP_NUM_WORDS ? parseInt(process.env.VAPI_STOP_NUM_WORDS, 10) : 2, // ignore one-word acks — don't cut the seller off
        voiceSeconds: 0.2,
        backoffSeconds: 1.0,    // graceful recovery after an interruption
      },
      recordingEnabled: true,
      endCallFunctionEnabled: true,   // let the AI hang up when the conversation is done
      silenceTimeoutSeconds: 30,
      responseDelaySeconds: process.env.VAPI_RESPONSE_DELAY ? parseFloat(process.env.VAPI_RESPONSE_DELAY) : 0.3,   // confident, present turn-taking
      llmRequestDelaySeconds: 0.1,  // tiny think-beat; kept small so replies feel immediate
      maxDurationSeconds: 1800,
      backgroundDenoisingEnabled: true,
      modelOutputInMessagesEnabled: true,
      voicemailDetection: {
        provider: 'twilio',
        voicemailDetectionTypes: ['machine_end_beep', 'machine_end_silence'],
        enabled: true,
        machineDetectionTimeout: 30,
        machineDetectionSpeechThreshold: 3500,
        machineDetectionSpeechEndThreshold: 2500,
        machineDetectionSilenceTimeout: 5000,
      },
      voicemailMessage: operator.ai_voicemail_script
        ? operator.ai_voicemail_script
            .replace(/\[FirstName\]|\{first_name\}/gi, lead.first_name || 'there')
            .replace(/\[Address\]|\{property_address\}/gi, lead.property_address || 'your property')
            .replace(/\[Company\]|\{company\}/gi, companyName)
            .replace(/\[AIName\]|\{ai_name\}/gi, aiName)
        : `Hi ${lead.first_name || 'there'}, this is ${aiName} from ${companyName}. I was reaching out about your property at ${lead.property_address || 'your property'}. Please give me a call back when you get a chance. Have a great day.`,
      endCallPhrases: [
        'your message has been sent',
        'thank you for using',
        'press 1 to review',
        'press pound to send',
        'to send your message as is',
        'you have reached the maximum',
        'message has been delivered',
        'goodbye',
      ],
      metadata: {
        callId,
        leadId: lead.id,
        userId: operator.id,
        leadName: `${lead.first_name || ''} ${lead.last_name || ''}`.trim(),
        propertyAddress: lead.property_address,
        leadTag: lead.primary_tag,
        estimatedValue: lead.estimated_value,
        estimatedEquity: lead.estimated_equity,
        motivationScore: lead.motivation_score,
      },
    },
  };

  console.log(`[Vapi] Initiating call — webhookUrl=${WEBHOOK_URL}`);
  const { data } = await vapiHttp.post('/call/phone', payload);
  return data;
}
// END Vapi outbound body

// ─── Get live call status + listen URL ───────────────────────────────────────
async function getCall(vapiCallId) {
  const { data } = await vapiHttp.get(`/call/${vapiCallId}`);
  return data;
}

async function getListenUrl(vapiCallId) {
  const { data } = await vapiHttp.get(`/call/${vapiCallId}`);
  // Vapi puts the listen URL in various places depending on call type/version
  const url = data?.monitor?.listenUrl
    || data?.monitor?.listen_url
    || data?.listenUrl
    || data?.listen_url
    || null;
  console.log(`[Vapi] getListenUrl for ${vapiCallId} → ${url || 'null (call may be ended)'}`);
  return url;
}

// ─── Wire a number for inbound (assistant-request mode) ──────────────────────
// Point a Vapi number's server at our webhook so Vapi POSTs an 'assistant-request'
// on every inbound call (handleAssistantRequest then returns a per-caller assistant
// and writes the inbound call row). Idempotent — safe to re-run. Returns the
// updated number object, or null if no id given.
async function configureInboundNumber(vapiPhoneNumberId) {
  if (!vapiPhoneNumberId) return null;
  const { data } = await vapiHttp.patch(`/phone-number/${vapiPhoneNumberId}`, {
    server: {
      url: WEBHOOK_URL,
      ...(process.env.VAPI_WEBHOOK_SECRET ? { secret: process.env.VAPI_WEBHOOK_SECRET } : {}),
    },
  });
  console.log(`[Vapi] Wired inbound for number ${vapiPhoneNumberId} → ${WEBHOOK_URL}`);
  return data;
}

// ─── End a call ───────────────────────────────────────────────────────────────
async function endCall(vapiCallId) {
  const { data } = await vapiHttp.delete(`/call/${vapiCallId}`);
  return data;
}

// ─── Mute AI (operator takeover) ─────────────────────────────────────────────
async function muteAssistant(vapiCallId) {
  const { data } = await vapiHttp.patch(`/call/${vapiCallId}`, {
    assistant: { model: { maxTokens: 0 } },
  }).catch(() => ({ data: { muted: true } }));
  return data;
}

// ─── Unmute AI (return control) ───────────────────────────────────────────────
async function unmuteAssistant(vapiCallId) {
  const { data } = await vapiHttp.patch(`/call/${vapiCallId}`, {
    assistant: { model: { maxTokens: 600 } },
  }).catch(() => ({ data: { unmuted: true } }));
  return data;
}

// ─── List active calls ────────────────────────────────────────────────────────
async function listActiveCalls() {
  const { data } = await vapiHttp.get('/call?status=in-progress&limit=20');
  return data;
}

// ─── Buyer outreach call ──────────────────────────────────────────────────────
async function initiateBuyerCall({ buyer, deal, phoneNumber, callId, operator = {} }) {
  if (!VAPI_API_KEY) throw new Error('VAPI_API_KEY not configured');
  const aiName  = operator.ai_caller_name || 'Alex';
  const voiceId = operator.ai_voice_id || process.env.VAPI_VOICE_ID || 'Elliot';

  // Buyer-type matched pitch strategy
  const buyerType = (buyer.buyer_type || buyer.investment_strategy || 'flipper').toLowerCase();
  const buyerPitch = buildBuyerPitch(buyerType, deal);

  // C — buyer-side brain: pull this buyer's static buy-box + earned deal history
  // so the pitch is informed by their real track record. Non-blocking: a failure
  // (or a first-touch buyer with no history) leaves buyerIntel '' and the prompt
  // is byte-for-byte what it was before this layer.
  let buyerIntel = '';
  try {
    const intel = await getBuyerIntelligence(buyer.id);
    buyerIntel = buildBuyerIntelBlock(intel);
  } catch (e) {
    console.warn('[Vapi] Buyer brain read failed (non-blocking):', e.message);
  }

  const systemPrompt = `You are ${aiName}, a real estate wholesaler calling a cash buyer about an off-market property.

PROPERTY:
- Address: ${deal.property_address}, ${deal.property_city}, ${deal.property_state}
- Seller Type: ${deal.seller_primary_tag || 'motivated seller'}
- ARV: $${deal.arv?.toLocaleString() || 'TBD'}
- Asking Price: $${(deal.buyer_price || deal.offer_price)?.toLocaleString() || 'TBD'}
- Repair Estimate: ~$${deal.repair_estimate?.toLocaleString() || 'TBD'}
- Assignment Fee: $${deal.assignment_fee?.toLocaleString() || 'TBD'}
- Potential Buyer Profit: ~$${deal.arv && deal.buyer_price && deal.repair_estimate
    ? (deal.arv - deal.buyer_price - deal.repair_estimate).toLocaleString()
    : 'TBD'}

BUYER PROFILE: ${buyerType.toUpperCase()}
${buyerPitch}
${buyerIntel}

YOUR GOAL: Qualify the buyer and get them to commit to reviewing the deal package.

CALL FLOW:
1. "Hi ${buyer.name}, this is ${aiName}. I have an off-market deal in ${deal.property_city}, ${deal.property_state} that I think fits your criteria. Do you have a quick two minutes?"
2. Lead with the numbers that matter MOST to THIS buyer type (see Buyer Profile above)
3. Ask: "Does this fit your buy box?" / "Are you actively buying in this area?"
4. If interested: "Perfect — I'll text you the full deal package right now. Can you look at it within 24 hours? We have another buyer interested."
5. If not interested: "No problem. What does your ideal deal look like right now? I'll keep you in mind."

RULES:
- Be brief and confident. Buyers are busy.
- Never pitch a rental buyer on flip profit. Never pitch a flipper on cap rate.
- Create urgency without lying: "We have interest from other buyers"
- Get a commitment: "Will you review it today or tomorrow?"

PERSONALITY STYLE:
${getToneStyle(operator)}`;

  const payload = {
    type: 'outboundPhoneCall',
    customer: { number: toE164(buyer.phone), name: buyer.name },
    assistant: {
      name: aiName,
      transcriber: { provider: 'deepgram', model: 'nova-2' },
      model: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', messages: [{ role: 'system', content: systemPrompt }], maxTokens: 300, temperature: 0.7 },
      voice: { provider: 'vapi', voiceId },
      firstMessage: `Hi ${buyer.name}, this is ${aiName}. I have an off-market deal in ${deal.property_city || 'your target area'} that I think matches your buy box. Do you have two quick minutes?`,
      recordingEnabled: true,
      maxDurationSeconds: 600,
      metadata: { callId, buyerId: buyer.id, dealId: deal.id, type: 'buyer_outreach' },
    },
  };

  // Use operator's provisioned number — never a hardcoded env var
  if (operator?.vapi_phone_number_id) {
    payload.phoneNumberId = operator.vapi_phone_number_id;
  } else if (operator?.activePhone?.vapi_phone_number_id) {
    payload.phoneNumberId = operator.activePhone.vapi_phone_number_id;
  }

  const { data } = await vapiHttp.post('/call/phone', payload);
  return data;
}

// ─── Inbound call handler — lookup seller from phone number ──────────────────
async function buildInboundAssistantConfig({ callerPhone, operator = {}, lead = null }) {
  const aiName  = operator.ai_caller_name || 'Alex';
  const voiceId = operator.ai_voice_id || process.env.VAPI_VOICE_ID || 'Elliot';

  // Known caller? Pull the full data-moat memory so the AI resumes the
  // relationship instead of greeting a stranger — the same accumulated
  // intelligence outbound calls already load (see initiateCallVapi). Non-blocking:
  // a read failure must never drop the inbound call, so it degrades to the cold path.
  const known = !!lead?.id;
  let accumulatedIntel = '';
  if (known) {
    try {
      const intel = await getCallIntelligence({ lead, operator });
      accumulatedIntel = buildAccumulatedIntelligenceBlock({ ...intel, lead });
    } catch (e) {
      console.warn('[Vapi Inbound] Data moat read failed (non-blocking):', e.message);
    }
  }

  const firstName = lead?.first_name || '';

  // Branch the goal + opening on whether we recognize the caller.
  const goalBlock = known
    ? `YOU ALREADY KNOW THIS CALLER — this is ${firstName || 'a homeowner'} you've spoken with before${lead.property_address ? ` about ${lead.property_address}` : ''}. They are calling YOU back. Do NOT ask who they are or treat them like a stranger.

YOUR GOAL:
1. Greet them warmly by name and pick the conversation up where it left off
2. Reference what you already know (see ACCUMULATED INTELLIGENCE below) — their situation, motivation, and what was last discussed
3. Move the deal forward: confirm timeline, condition, price expectations, and make/advance an offer when appropriate

INBOUND CALL OPENING:
"Hey ${firstName || 'there'}, thanks for calling me back! Great to hear from you${lead.property_address ? ` — is this about ${lead.property_address}?` : '.'}"`
    : `Someone has just called in — they may be a seller responding to mail, a sign, or a previous conversation.

YOUR GOAL:
1. Find out who they are and why they're calling
2. If they're a seller interested in selling their property — conduct a full acquisition call
3. Qualify, discover motivation, assess property condition, make an offer if appropriate

INBOUND CALL OPENING:
"Thank you for calling! This is ${aiName}. Are you calling about selling your property?"

If yes: Proceed with full seller discovery (property address, condition, motivation, timeline, price expectations)
If callback/follow-up: "Of course — can I get your name and the property address you're calling about?"
If wrong number/not interested: "No problem at all — sorry to bother you. Have a great day!"`;

  const systemPrompt = `You are ${aiName}, a real estate investor. ${goalBlock}

Apply the same call flow as outbound calls.
Always be warm — they called YOU, which means they have some interest.

PERSONALITY STYLE:
${getToneStyle(operator)}${accumulatedIntel}`;

  // Known callers get a personalized, warm callback greeting; unknown callers get
  // the neutral inbound opener.
  const firstMessage = known
    ? `Hey ${firstName || 'there'}, thanks for calling me back! Great to hear from you${lead.property_address ? ` — is this about ${lead.property_address}?` : '.'}`
    : `Thank you for calling! This is ${aiName}. Are you calling about selling your property?`;

  return {
    name: aiName,
    transcriber: { provider: 'deepgram', model: 'nova-2', language: 'en-US' },
    model: {
      provider: 'anthropic',
      model: process.env.VAPI_AI_MODEL || 'claude-haiku-4-5-20251001',
      messages: [{ role: 'system', content: systemPrompt }],
      temperature: 0.75,
      maxTokens: 600,
    },
    voice: { provider: 'vapi', voiceId },
    // Same human-pacing pack as outbound — confident, present turn-taking, smart
    // endpointing, backchanneling, no cut-offs, faint office room-tone. (See initiateCall.)
    backchannelingEnabled: true,
    backgroundSound: 'office',
    startSpeakingPlan: {
      waitSeconds: 0.4,
      smartEndpointingPlan: { provider: 'livekit' },
    },
    stopSpeakingPlan: {
      numWords: 2,
      voiceSeconds: 0.2,
      backoffSeconds: 1.0,
    },
    responseDelaySeconds: 0.3,
    llmRequestDelaySeconds: 0.1,
    firstMessage,
    recordingEnabled: true,
    endCallFunctionEnabled: true,   // let the AI hang up when the conversation is done
    silenceTimeoutSeconds: 30,
    maxDurationSeconds: 1800,
  };
}

// ─── Voice catalog (verified from Vapi dashboard) ────────────────────────────
// Vapi's REST API has NO endpoint to list native voices — confirmed against
// their live OpenAPI spec (0 voice paths). Native voices live only in the
// dashboard and are referenced by NAME at call time (voiceId: 'Elliot').
// This list is sourced directly from the operator's Vapi Voice Settings picker
// (verified present in-account) so the Settings dropdown matches reality.
// If Vapi adds/retires a voice, update this list manually.
const VOICE_PREVIEW_BASE = 'https://xqllxyoeftkbufoungcz.supabase.co/storage/v1/object/public/voice-previews';
const VAPI_VOICES = [
  // Featured first: Vapi's most natural-sounding conversational voices.
  { voiceId: 'Elliot',   name: 'Elliot',   gender: 'male',   featured: true, previewUrl: `${VOICE_PREVIEW_BASE}/elliot.wav` },
  { voiceId: 'Savannah', name: 'Savannah', gender: 'female', featured: true, previewUrl: `${VOICE_PREVIEW_BASE}/savannah.wav` },
  { voiceId: 'Clara',    name: 'Clara',    gender: 'female', featured: true, previewUrl: `${VOICE_PREVIEW_BASE}/clara.wav` },
  { voiceId: 'Godfrey',  name: 'Godfrey',  gender: 'male',   previewUrl: `${VOICE_PREVIEW_BASE}/godfrey.wav` },
  { voiceId: 'Nico',     name: 'Nico',     gender: 'male',   previewUrl: `${VOICE_PREVIEW_BASE}/nico.wav` },
  { voiceId: 'Kai',      name: 'Kai',      gender: 'male',   previewUrl: `${VOICE_PREVIEW_BASE}/kai.wav` },
  { voiceId: 'Emma',     name: 'Emma',     gender: 'female', previewUrl: `${VOICE_PREVIEW_BASE}/emma.wav` },
  { voiceId: 'Sagar',    name: 'Sagar',    gender: 'male',   previewUrl: `${VOICE_PREVIEW_BASE}/sagar.wav` },
  { voiceId: 'Neil',     name: 'Neil',     gender: 'male',   previewUrl: `${VOICE_PREVIEW_BASE}/neil.wav` },
  { voiceId: 'Layla',    name: 'Layla',    gender: 'female', previewUrl: `${VOICE_PREVIEW_BASE}/layla.wav` },
  { voiceId: 'Sid',      name: 'Sid',      gender: 'male',   previewUrl: `${VOICE_PREVIEW_BASE}/sid.wav` },
  { voiceId: 'Naina',    name: 'Naina',    gender: 'female', previewUrl: `${VOICE_PREVIEW_BASE}/naina.wav` },
  // Gustavo & Rohan exist in Vapi but have no hosted preview clip → previewUrl stays null
  // (frontend hides the preview button when previewUrl is falsy).
  { voiceId: 'Gustavo',  name: 'Gustavo',  gender: 'male',   previewUrl: null },
  { voiceId: 'Rohan',    name: 'Rohan',    gender: 'male',   previewUrl: null },
];

// Async signature kept so callers/route (await getVapiVoices()) stay unchanged.
async function getVapiVoices() {
  return VAPI_VOICES;
}

module.exports = {
  initiateCall,
  getCall,
  getListenUrl,
  configureInboundNumber,
  endCall,
  muteAssistant,
  unmuteAssistant,
  listActiveCalls,
  initiateBuyerCall,
  buildInboundAssistantConfig,
  buildAlexPrompt,
  getScriptByLeadTag,
  getVapiVoices,
  getUseCase,
  USE_CASE_IDENTITY,
  computeStrategyOffer,
  STRATEGY_PLAYBOOK,
  resolveStrategy,
  buildStrategyBlock,
};
