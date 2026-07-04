/**
 * Custom SMS Service - operator-authored SMS copy, guard-railed to wholesale real estate.
 *
 * Operators can write (or AI-generate) their OWN outreach text instead of being limited
 * to the built-in per-tag templates. This module owns the three pieces that make that
 * safe and personal:
 *
 *   1. renderTemplate(body, lead, operatorName) - swaps {first_name} / {address} / {city}
 *      / {operator} / {county} placeholders for this lead's real values at send time, so
 *      one saved template personalizes per lead (same fields the built-in templates use).
 *
 *   2. moderateTemplate(text) - the guardrail. A cheap deterministic fraud/off-topic
 *      pre-filter runs first (free, no token call); only text that clears it goes to a
 *      GPT-4o-mini classifier that confirms it is legitimate WHOLESALE REAL-ESTATE
 *      outreach. Returns { allowed, reason }. Used at BOTH save-time and generate-time so
 *      nothing off-topic can ever be stored or blasted.
 *
 *   3. generateTemplate({ leadType, angle, operatorName }) - AI writes a compliant
 *      wholesale-RE SMS for a given lead type, then self-moderates it before returning.
 *      The operator REVIEWS the draft; nothing here sends anything.
 *
 * This module never sends an SMS and never bypasses DNC, outreach credits, or TCPA
 * quiet-hours - those gates remain entirely in smsService/smsFirstWorkflow at send time.
 * It only decides WHAT the body says and WHETHER that body is allowed.
 */

const axios = require('axios');

// ── Placeholder tokens operators can use in custom copy ──────────────────────
// Maps a {token} to a function that pulls the value off the lead (with safe
// fallbacks identical to the built-in templates), so a custom template reads like
// the hardcoded ones and never renders an empty hole.
const TOKENS = {
  first_name: (lead) => lead.first_name || 'there',
  address:    (lead) => lead.property_address || 'your property',
  street:     (lead) => (lead.property_address || '').split(',')[0] || 'your property',
  city:       (lead) => lead.property_city || 'your area',
  county:     (lead) => lead.county || 'your county',
  state:      (lead) => lead.property_state || 'your state',
};

/**
 * Render a saved custom template for one lead: swap {tokens} for real values.
 * Unknown tokens are left untouched (operator sees their typo, nothing crashes).
 * {operator} resolves to the operator's AI caller name passed in by the caller.
 * @param {string} body          the saved template text with {tokens}
 * @param {object} lead          the lead row
 * @param {string} operatorName  the operator's signing name (ai_caller_name)
 * @returns {string} personalized SMS body
 */
function renderTemplate(body, lead = {}, operatorName = 'Alex') {
  if (!body) return '';
  return String(body).replace(/\{(\w+)\}/g, (match, token) => {
    if (token === 'operator') return operatorName || 'Alex';
    const fn = TOKENS[token];
    return fn ? fn(lead) : match; // leave unknown {tokens} verbatim
  });
}

// ── Deterministic fraud / off-topic pre-filter ───────────────────────────────
// Free, instant, runs BEFORE the AI classifier so we never spend a token call on
// obvious garbage. Two checks:
//   • RED_FLAGS - terms that have no place in legitimate wholesale outreach
//     (scams, payment-harvesting, unrelated verticals). Any hit → blocked.
//   • RE_INTENT - the text must show at least one real-estate/wholesale signal,
//     so a blank or wholly-unrelated message can't slip through.
const RED_FLAGS = [
  // financial-fraud / phishing / payment harvesting
  'wire transfer', 'gift card', 'bitcoin', 'crypto', 'btc', 'usdt', 'western union',
  'social security number', 'ssn', 'routing number', 'account number', 'pin number',
  'password', 'verification code', 'one-time code', 'otp', 'login', 'bank login',
  'click this link', 'claim your prize', 'you have won', 'lottery', 'inheritance fund',
  'nigerian prince', 'irs', 'arrest warrant', 'suspended account', 'reactivate',
  // clearly off-topic verticals
  'viagra', 'casino', 'forex', 'weight loss', 'crypto investment', 'adult',
];

const RE_INTENT = [
  'property', 'properties', 'house', 'home', 'real estate', 'land', 'parcel', 'lot',
  'sell', 'selling', 'buy', 'buyer', 'buying', 'cash offer', 'offer', 'close', 'closing',
  'foreclosure', 'pre-foreclosure', 'probate', 'inherited', 'mortgage', 'equity',
  'as-is', 'as is', 'wholesale', 'investor', 'landlord', 'rental', 'vacant', 'tenant',
  'acre', 'acres', 'deed', 'title', 'fsbo', 'realtor', 'agent',
];

/**
 * Cheap pre-filter. Returns { ok:boolean, reason:string }.
 *   ok=false, reason='fraud'    → a red-flag term is present (hard block).
 *   ok=false, reason='off_topic'→ no real-estate intent detected.
 *   ok=true                     → clears the pre-filter; send to AI classifier.
 */
function prefilter(text) {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return { ok: false, reason: 'empty' };
  for (const term of RED_FLAGS) {
    if (t.includes(term)) return { ok: false, reason: 'fraud', term };
  }
  const hasIntent = RE_INTENT.some(term => t.includes(term));
  if (!hasIntent) return { ok: false, reason: 'off_topic' };
  return { ok: true };
}

/**
 * Guardrail: confirm a template is legitimate WHOLESALE REAL-ESTATE outreach.
 * Pre-filter first (free), then a GPT-4o-mini classifier for the nuanced call.
 * Fail-safe: if OpenAI isn't configured or errors AND the text already cleared the
 * deterministic pre-filter, we ALLOW it (the cheap check already removed fraud and
 * off-topic copy - we don't block legitimate operators on an API outage).
 * @param {string} text  the template body (tokens or rendered, both fine)
 * @returns {Promise<{allowed:boolean, reason:string}>}
 */
async function moderateTemplate(text) {
  const pre = prefilter(text);
  if (!pre.ok) {
    const reason =
      pre.reason === 'fraud'    ? 'Contains terms not allowed in outreach (looks like fraud/spam).' :
      pre.reason === 'off_topic'? 'Message must be about buying/selling real estate (wholesale).' :
      'Message is empty.';
    return { allowed: false, reason };
  }

  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) return { allowed: true, reason: 'prefilter_only' };

  try {
    const res = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You are a compliance classifier for a real-estate wholesaling SMS platform. ' +
            'Decide if a message is a LEGITIMATE outreach text from a real-estate investor/wholesaler ' +
            'to a property owner or buyer (e.g. offering to buy a house, discussing selling, cash offers, ' +
            'foreclosure/probate/inherited property help, or marketing a property to cash buyers). ' +
            'REJECT anything that is: fraud, phishing, payment/credential harvesting, a different industry, ' +
            'harassment, or not about real estate at all. ' +
            'Reply with ONLY a JSON object: {"allowed": true|false, "reason": "<short reason>"}.',
        },
        { role: 'user', content: String(text).slice(0, 1200) },
      ],
      temperature: 0,
      max_tokens: 60,
      response_format: { type: 'json_object' },
    }, {
      headers: { Authorization: `Bearer ${OPENAI_KEY}` },
      timeout: 10000,
    });

    const raw = res.data?.choices?.[0]?.message?.content || '{}';
    let verdict;
    try { verdict = JSON.parse(raw); } catch (_) { verdict = {}; }

    if (verdict.allowed === false) {
      return { allowed: false, reason: verdict.reason || 'Not recognized as wholesale real-estate outreach.' };
    }
    // Default to allow when the classifier says allowed (or is ambiguous) - the
    // deterministic pre-filter already removed fraud/off-topic copy.
    return { allowed: true, reason: verdict.reason || 'ok' };
  } catch (e) {
    console.warn('[CustomSMS] Moderation classifier failed, falling back to pre-filter:', e.message);
    return { allowed: true, reason: 'prefilter_only' };
  }
}

/**
 * AI generator: draft a compliant wholesale-RE SMS for a lead type + angle.
 * Self-moderates the result before returning, so a generated draft is always
 * guard-clean. The operator reviews + saves it; nothing is sent here.
 * @param {object}  opts
 * @param {string}  opts.leadType      e.g. 'pre_foreclosure', 'probate', 'absentee_owner'
 * @param {string}  opts.angle         optional operator instruction ("emphasize speed")
 * @param {string}  opts.operatorName  signing name to use in the draft
 * @returns {Promise<{ body:string, allowed:boolean, reason:string }>}
 */
async function generateTemplate({ leadType = 'default', angle = '', operatorName = 'Alex' } = {}) {
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) {
    return { body: '', allowed: false, reason: 'AI generation unavailable (OpenAI not configured).' };
  }

  const cleanType = String(leadType || 'default').toLowerCase().replace(/[^a-z_]/g, '_') || 'default';

  try {
    const res = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You write SHORT cold-outreach SMS messages for a real-estate wholesaler texting a property owner. ' +
            'Rules: 1-2 sentences, under 320 characters, warm and human, never pushy, never sound like a debt ' +
            'collector. It MUST be about buying their property / helping them sell (cash offer, as-is, close on ' +
            'their timeline). Use these placeholders literally where natural: {first_name}, {street}, {city}, ' +
            '{county}, {operator}. Always sign off with "- {operator}". Output ONLY the message text, no quotes, ' +
            'no preamble.',
        },
        {
          role: 'user',
          content:
            `Lead type: ${cleanType.replace(/_/g, ' ')}.` +
            (angle ? ` Operator's angle: ${angle}.` : '') +
            ` Write one outreach SMS.`,
        },
      ],
      temperature: 0.8,
      max_tokens: 160,
    }, {
      headers: { Authorization: `Bearer ${OPENAI_KEY}` },
      timeout: 12000,
    });

    let body = (res.data?.choices?.[0]?.message?.content || '').trim().replace(/^["']|["']$/g, '');
    if (!body) return { body: '', allowed: false, reason: 'AI returned an empty draft. Try again.' };

    // Self-moderate the draft so the operator never sees a non-compliant suggestion.
    const verdict = await moderateTemplate(body);
    return { body, allowed: verdict.allowed, reason: verdict.reason };
  } catch (e) {
    console.error('[CustomSMS] Generation error:', e.message);
    return { body: '', allowed: false, reason: 'AI generation failed. Try again.' };
  }
}

module.exports = {
  renderTemplate,
  moderateTemplate,
  generateTemplate,
  prefilter,        // exported for tests / route-level fast checks
  TOKENS,
};
