// ─── AI Service — Claude Haiku 4.5 ────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL  = 'claude-haiku-4-5-20251001';

/**
 * Analyze a completed call transcript
 */
async function analyzeCallTranscript(transcript, lead = {}) {
  const prompt = `You are an expert real estate wholesale analyst. Analyze this seller call transcript and extract structured data.

LEAD CONTEXT:
- Name: ${lead?.first_name} ${lead?.last_name}
- Property: ${lead?.property_address}
- Estimated Value: $${lead?.estimated_value?.toLocaleString() || 'Unknown'}

TRANSCRIPT:
${transcript}

Respond with ONLY valid JSON (no markdown, no explanation):
{
  "motivation_score": <0-100 integer>,
  "seller_personality": "<Analytical|Emotional|Skeptical|Motivated|Neutral>",
  "key_signals": ["<signal1>", "<signal2>"],
  "objections": ["<objection1>", "<objection2>"],
  "outcome": "<not_home|not_interested|callback_requested|appointment|offer_made|verbal_yes|voicemail>",
  "offer_made": <number or null>,
  "ai_summary": "<2-3 sentence plain English summary>",
  "recommended_action": "<specific next action>",
  "estimated_arv": <number or null>,
  "repair_estimate": <number or null>
}

SCORING GUIDE:
- 80-100: Extremely motivated — financial pressure, urgency, desperate to sell
- 60-79: Motivated — open to selling, timeline in mind, has reasons
- 40-59: Interested — open to offers, no urgency
- 20-39: Mildly interested — skeptical, no urgency
- 0-19: Not interested, angry, or not relevant`;

  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = msg.content[0].text.trim();
    return JSON.parse(text);
  } catch (err) {
    console.error('[AI] analyzeCallTranscript error:', err.message);
    return { motivation_score: 0, outcome: 'not_home', ai_summary: 'Analysis unavailable', key_signals: [], objections: [] };
  }
}

/**
 * Score motivation from partial transcript (real-time)
 */
async function scoreMotivation(transcript, leadId) {
  const prompt = `Analyze this real estate seller call transcript and return ONLY a JSON object with the current motivation score.

TRANSCRIPT (so far):
${transcript.slice(-3000)}

Return ONLY: {"score": <0-100>, "signals": ["<signal1>"], "emotion": "<Calm|Anxious|Interested|Resistant|Motivated>"}`;

  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 100,
      messages: [{ role: 'user', content: prompt }],
    });
    return JSON.parse(msg.content[0].text.trim());
  } catch {
    return { score: 0, signals: [], emotion: 'Calm' };
  }
}

/**
 * Calculate offer based on property analysis
 */
async function analyzePropertyOffer({ address, city, state, sellerDescription, estimatedValue }) {
  const prompt = `You are an expert real estate wholesale analyst. Calculate a cash offer for this property.

PROPERTY: ${address}, ${city}, ${state}
SELLER DESCRIPTION: ${sellerDescription || 'Not provided'}
ESTIMATED VALUE: $${estimatedValue?.toLocaleString() || 'Unknown'}

Based on the seller description, estimate repairs:
- Move-in ready: $0
- Light updates: $5,000-$15,000
- Moderate: $15,000-$40,000
- Heavy: $40,000-$80,000
- Gut rehab: $80,000-$150,000

Calculate:
- ARV (after repair value)
- Repair estimate
- MAO = ARV × 0.70 - repairs
- Negotiation offer = MAO - 10% (room to negotiate up)

Return ONLY valid JSON:
{
  "estimated_arv": <number>,
  "repair_estimate": <number>,
  "repair_category": "<move_in_ready|light|moderate|heavy|gut_rehab>",
  "mao": <number>,
  "negotiation_offer": <number>,
  "confidence": "<high|medium|low>",
  "reasoning": "<brief explanation>"
}`;

  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    });
    return JSON.parse(msg.content[0].text.trim());
  } catch (err) {
    console.error('[AI] analyzePropertyOffer error:', err.message);
    return null;
  }
}

/**
 * Get coaching suggestions for operator takeover
 */
async function getCoachingSuggestions(transcript) {
  const lastLines = transcript.split('\n').slice(-10).join('\n');
  const prompt = `You are a real estate wholesale coach. The operator just took over a live call.

LAST 10 LINES OF CONVERSATION:
${lastLines}

Give the operator immediate coaching. Return ONLY valid JSON:
{
  "suggested_next_lines": ["<line1>", "<line2>", "<line3>"],
  "objection_responses": ["<response1>", "<response2>"],
  "negotiation_tips": ["<tip1>", "<tip2>"],
  "offer_recommendation": "<specific offer advice or null>"
}`;

  try {
    const msg = await client.messages.create({ model: MODEL, max_tokens: 400, messages: [{ role: 'user', content: prompt }] });
    return JSON.parse(msg.content[0].text.trim());
  } catch {
    return { suggested_next_lines: [], objection_responses: [], negotiation_tips: [] };
  }
}

/**
 * Generate follow-up email
 */
async function generateFollowUpEmail({ lead, callHistory, tone = 'friendly' }) {
  const prompt = `Write a follow-up email to a seller after a real estate wholesale call.

SELLER: ${lead.first_name} ${lead.last_name}
PROPERTY: ${lead.property_address}
CALL SUMMARY: ${callHistory?.[0]?.ai_summary || 'We spoke about your property.'}
TONE: ${tone}

Write a short, personal, non-pushy follow-up email. Return ONLY valid JSON:
{"subject": "<subject line>", "body": "<email body — plain text, no HTML>"}`;

  try {
    const msg = await client.messages.create({ model: MODEL, max_tokens: 400, messages: [{ role: 'user', content: prompt }] });
    return JSON.parse(msg.content[0].text.trim());
  } catch {
    return { subject: `Following up on ${lead.property_address}`, body: `Hi ${lead.first_name}, just following up on our conversation. Please reach out anytime.` };
  }
}

/**
 * Operator AI Assistant — knows your business
 */
async function operatorAssistant(message, history = [], context = {}) {
  const systemPrompt = `You are an expert wholesale real estate advisor with 15 years of experience. You are assisting a Veori AI operator manage their real estate acquisitions business.

You have access to their current business data:
HOT LEADS (score 70+): ${JSON.stringify(context.hot_leads?.slice(0, 5) || [])}
RECENT CALLS: ${JSON.stringify(context.recent_calls?.slice(0, 5) || [])}
ACTIVE DEALS: ${JSON.stringify(context.active_deals?.slice(0, 5) || [])}

Be direct. Be specific. Give actionable answers using their actual data when relevant.
You know: MAO calculations, deal analysis, seller psychology, negotiation, wholesale strategy, how to talk to motivated sellers, how to find buyers, how to close deals.
When someone asks a calculation question, show your math.
Keep responses concise but complete. No fluff.`;

  const messages = [
    ...history.slice(-20).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ];

  const msg = await client.messages.create({ model: MODEL, max_tokens: 600, system: systemPrompt, messages });
  return msg.content[0].text;
}

/**
 * Aria — Free public real estate chatbot
 */
async function ariaChatbot(message, history = []) {
  const systemPrompt = `You are Aria, a friendly and knowledgeable free AI real estate advisor available on the Veori AI website.

You help people learn about real estate investing — specifically wholesale real estate.

You CAN help with:
- How wholesale real estate works
- How to calculate ARV and MAO (70% rule)
- General deal evaluation advice
- How to talk to motivated sellers
- What to look for in distressed properties
- Basic negotiation advice
- How to find cash buyers
- Explaining real estate terms

You CANNOT do for free (require Veori AI platform signup):
- Running live comps on specific properties
- Analyzing specific deals with real numbers from MLS
- Generating actual offer amounts for real addresses
- Accessing market data for specific cities
- Managing leads, campaigns, or making calls

When someone asks for something that requires the platform, say:
"That's a great question! To get specific numbers on real properties and run live comps, you'd need access to Veori AI. It takes about 2 minutes to sign up and your first week is free. Want me to walk you through it?"

PERSONALITY: Warm, knowledgeable, encouraging. You celebrate when someone finds a good deal. You make investing feel accessible. Plain language — no jargon unless the user uses it first.

IMPORTANT: Never make up specific property values, specific comps, or specific market data. You give educational guidance, not data analysis.`;

  const messages = [
    ...history.slice(-20).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ];

  const msg = await client.messages.create({ model: MODEL, max_tokens: 500, system: systemPrompt, messages });
  return msg.content[0].text;
}

/**
 * Generate daily report/morning briefing
 */
async function generateDailyReport({ stats, hotLeads }) {
  const prompt = `You are an AI business advisor for a real estate wholesale company.

YESTERDAY'S STATS:
${JSON.stringify(stats)}

HOT LEADS (score 70+):
${hotLeads.map(l => `- ${l.first_name} ${l.last_name} | Score: ${l.motivation_score} | ${l.property_address}`).join('\n')}

Write a concise morning briefing (under 200 words). Include:
1. Yesterday's performance summary
2. Top 3 priorities for today
3. Which hot leads to call first and why

Be direct and actionable. This is read by a busy real estate operator.`;

  try {
    const msg = await client.messages.create({ model: MODEL, max_tokens: 400, messages: [{ role: 'user', content: prompt }] });
    return msg.content[0].text;
  } catch {
    return 'Daily report unavailable. Check your Anthropic API key.';
  }
}

module.exports = { analyzeCallTranscript, scoreMotivation, analyzePropertyOffer, getCoachingSuggestions, generateFollowUpEmail, operatorAssistant, ariaChatbot, generateDailyReport };
