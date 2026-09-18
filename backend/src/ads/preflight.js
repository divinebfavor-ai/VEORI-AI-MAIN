// ─── Market Intelligence Pre-Flight ──────────────────────────────────────────
// Nothing in the ads system runs without a live brief for the market. The brief
// is the only place market facts live; every other ads agent reads it and is
// forbidden from forming its own view of the market. requireBrief() is the gate:
// if there is no live, unexpired brief, the caller gets PREFLIGHT_REQUIRED and
// stops. There is no flag that turns this off.

const supabase = require('../config/supabase');
const { defineAgent } = require('../intelligence/agentKit');
const { claim, STATUS } = require('../intelligence/provenance');
const marketPulse = require('./marketPulse');
const { DRIVERS, ANGLES, SATURATED, driver, angle } = require('./catalog');
const learning = require('./learning');

const BRIEF_TTL_DAYS = Number(process.env.ADS_PREFLIGHT_TTL_DAYS) || 14;

// ── Operator voice ──────────────────────────────────────────────────────────
// Only what the operator told us. Nothing is inferred about how they speak.
function voiceOf(profile) {
  const v = profile?.voice && typeof profile.voice === 'object' ? profile.voice : {};
  const captured = ['tone', 'phrases_they_use', 'phrases_to_avoid', 'reading_level', 'signs_off_as'].filter(k => {
    const x = v[k];
    return Array.isArray(x) ? x.length > 0 : !!x;
  });
  return {
    captured: captured.length > 0,
    fields: v,
    source: profile?.voice_source || null,
    extracted_at: profile?.voice_extracted_at || null,
    status: captured.length ? STATUS.USER_PROVIDED : STATUS.UNKNOWN,
    instruction: captured.length
      ? 'Write in the operator’s recorded voice. Where it conflicts with a rule below, the rule wins.'
      : 'No voice has been captured for this operator. Copy is written in plain, direct language with short sentences and no slogan. Veori does not invent a personality for someone it has not heard.',
  };
}

const PROFILE_FIELDS = ['business_years', 'markets', 'property_types', 'price_min', 'price_max', 'exit_strategies', 'monthly_ad_budget', 'target_leads_per_month', 'good_lead_definition', 'bad_lead_definition', 'biggest_frustration', 'has_call_team'];

function profileCompleteness(profile) {
  if (!profile) return { pct: 0, missing: PROFILE_FIELDS, note: 'No ad profile exists for this operator.' };
  const missing = PROFILE_FIELDS.filter(f => {
    const v = profile[f];
    return v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);
  });
  return { pct: Math.round(((PROFILE_FIELDS.length - missing.length) / PROFILE_FIELDS.length) * 100), missing, note: null };
}

// How much real signal stands behind any creative built on this brief.
function creativeIntelligenceScore({ pulse, completeness, voice, learnedPoints }) {
  const top = pulse.angle_ranking[0];
  const evidence = !top ? 0 : top.evidence_strength === 'strong' ? 100 : top.evidence_strength === 'moderate' ? 60 : 25;
  const learned = Math.min(100, (learnedPoints / 30) * 100);
  const parts = [
    { id: 'market_data', weight: 35, score: pulse.data_confidence, why: 'How much of the market score could actually be measured, and on how many leads.' },
    { id: 'angle_evidence', weight: 25, score: evidence, why: top ? `The leading angle rests on ${top.leads} leads (${top.evidence_strength}).` : 'No angle has any evidence behind it.' },
    { id: 'operator_profile', weight: 20, score: completeness.pct, why: 'Targeting and offer language need the operator’s own parameters.' },
    { id: 'operator_voice', weight: 10, score: voice.captured ? 100 : 0, why: voice.captured ? 'A voice is on file.' : 'No voice captured, so copy stays neutral.' },
    { id: 'performance_history', weight: 10, score: learned, why: `${learnedPoints} comparable results across the network inform what tends to work. 30 or more counts as full.` },
  ];
  const score = Math.round(parts.reduce((s, p) => s + p.score * p.weight, 0) / 100);
  return { score, parts, meaning: score >= 70 ? 'Enough is known to spend against this.' : score >= 40 ? 'Enough to test with a small budget. Treat the result as the real research.' : 'Too little is known. Anything produced here is a starting point, not a plan.' };
}

function doNotUse(pulse) {
  return {
    phrases: SATURATED,
    note: 'This is the fixed floor: language the whole industry runs. Market-specific saturation would need the Meta Ad Library or Google Ads Transparency Center, neither of which is connected, so Veori does not claim to know what your particular competitors are running.',
    market_specific_available: false,
  };
}

function marketAssumptionsBan(pulse) {
  const unknown = pulse.data_gaps.map(g => g.capability);
  return {
    rule: 'No ads agent may state a market fact that is not in this brief.',
    explicitly_unknown: unknown,
    forbidden: [
      'search volume, cost-per-click or keyword competition for any term',
      'how many competitors advertise in this market, or what they say',
      'days on market, inventory, or median price movement',
      'any demographic figure about the audience',
      'a cost-per-lead presented as what this operator will pay',
    ],
    if_needed: 'Say it is unknown, name the source that would answer it, and continue without it.',
  };
}

const declaration = {
  id: 'market_preflight',
  name: 'Market Intelligence Pre-Flight',
  domain: 'advertising',
  version: '1.0.0',
  last_knowledge_update: '2026-09-18',
  capabilities: ['market_pulse', 'opportunity_scoring', 'angle_ranking', 'audience_prioritisation', 'creative_readiness'],
  required_inputs: ['market'],
  outputs: ['market_preflight_brief'],
  tools: ['leads_history', 'deals_history', 'operator_ad_profile', 'cross_operator_learnings'],
  knowledge_sources: ['operator_workspace_data', 'veori_creative_catalogue'],
  handoff_agents: [],
  permissions: 'READ',
  risk_level: 'low',
  jurisdiction_aware: true,
};

const agent = defineAgent({
  declaration,
  async analyze(ctx) {
    const market = String(ctx.inputs?.market || '').trim();
    const pulse = await marketPulse.pulse(ctx.userId, market);
    const { data: profile } = await supabase.from('operator_ad_profile').select('*').eq('user_id', ctx.userId).maybeSingle();
    const completeness = profileCompleteness(profile);
    const voice = voiceOf(profile);
    const network = await learning.networkGuidance({ angles: pulse.angle_ranking.map(a => a.angle) });
    const cis = creativeIntelligenceScore({ pulse, completeness, voice, learnedPoints: network.data_points });

    const top = pulse.angle_ranking[0] || null;
    const primaryAngle = top ? top.angle : null;
    const primaryDriver = top ? (angle(top.angle)?.drivers[0] || null) : null;

    const findings = [
      { label: 'Market opportunity score', claim: claim(pulse.opportunity_score, pulse.opportunity_status === 'measured' ? STATUS.CALCULATED : STATUS.UNKNOWN, { source: 'veori_workspace_data', source_tier: 'operator', basis: pulse.opportunity_basis, confidence: pulse.data_confidence }) },
      { label: 'Leads held in this market', claim: claim(pulse.lead_sample, STATUS.VERIFIED, { source: 'veori_workspace_data', source_tier: 'operator', basis: 'Counted directly.' }) },
      { label: 'Leading situation', claim: top ? claim(top.name, STATUS.CALCULATED, { source: 'veori_workspace_data', source_tier: 'operator', basis: top.evidence, confidence: top.evidence_strength === 'strong' ? 85 : top.evidence_strength === 'moderate' ? 60 : 30 }) : claim(null, STATUS.UNKNOWN, { note: 'No situation in this market has any evidence behind it yet.' }) },
      { label: 'Competitive density', claim: claim(null, STATUS.UNKNOWN, { note: 'No advertising-transparency source is connected. This is not estimated.' }) },
    ];

    const missing = [
      ...pulse.data_gaps.map(g => ({ item: g.capability.replace(/_/g, ' '), why_it_matters: g.what_veori_does_instead, how_to_get: g.how_to_close_it || 'Connect a provider for this capability.' })),
      ...(completeness.missing.length ? [{ item: 'Operator ad profile', why_it_matters: 'Targeting, budget pacing and offer language all come from the operator’s own parameters. Without them Veori writes to nobody in particular.', how_to_get: `Fill in: ${completeness.missing.join(', ')}.` }] : []),
      ...(voice.captured ? [] : [{ item: 'Operator voice', why_it_matters: 'Copy in a borrowed voice reads like every other investor ad.', how_to_get: 'Record how you speak to sellers: tone, the phrases you use, the ones you never use.' }]),
    ];

    const recommendations = [];
    if (pulse.opportunity_status !== 'measured') {
      recommendations.push({ action: 'Build lead history in this market before spending on ads', why: `Only ${pulse.lead_sample} leads are held here. Below ${marketPulse.MIN_LEADS_FOR_SCORE} there is nothing to aim at, and an ad budget would be buying the research that sourcing gives you cheaper.`, urgency: 'high', assigned_to: 'operator' });
    } else if (top) {
      recommendations.push({ action: `Lead with "${top.name}" using the ${driver(primaryDriver)?.name || primaryDriver} driver`, why: `${top.evidence} That is the only situation in this market with volume behind it.`, urgency: 'high', assigned_to: 'operator' });
    }
    for (const seg of pulse.audience_matrix.filter(s => s.tier === 'second').slice(0, 2)) {
      recommendations.push({ action: `Hold "${seg.name}" as the second test`, why: seg.why, urgency: 'medium', assigned_to: 'operator' });
    }

    const brief = {
      generated_for: pulse.market,
      market_pulse: {
        opportunity_score: pulse.opportunity_score, status: pulse.opportunity_status, basis: pulse.opportunity_basis,
        components: pulse.components, lead_sample: pulse.lead_sample, deal_sample: pulse.deal_sample,
        seasonality: pulse.seasonality,
      },
      angle_ranking: pulse.angle_ranking,
      angles_without_evidence: pulse.angles_without_evidence,
      audience_priority_matrix: pulse.audience_matrix,
      operator: {
        profile_present: !!profile, completeness: completeness.pct, missing_fields: completeness.missing,
        parameters: profile ? {
          markets: profile.markets, property_types: profile.property_types,
          price_min: profile.price_min, price_max: profile.price_max,
          exit_strategies: profile.exit_strategies, monthly_ad_budget: profile.monthly_ad_budget,
          target_leads_per_month: profile.target_leads_per_month,
          good_lead: profile.good_lead_definition, bad_lead: profile.bad_lead_definition,
          biggest_frustration: profile.biggest_frustration, has_call_team: profile.has_call_team,
        } : null,
        voice,
      },
      drivers: DRIVERS,
      do_not_use: doNotUse(pulse),
      network_guidance: network,
      creative_intelligence_score: cis,
      no_agent_may_assume: marketAssumptionsBan(pulse),
      read_protocol: 'Every ads agent loads this brief by id before it produces anything, quotes the brief for any market fact it uses, and refuses to run if the brief has expired.',
    };

    return {
      output_type: 'market_preflight_brief',
      status: pulse.opportunity_status === 'measured' ? 'complete' : 'insufficient_data',
      summary: pulse.opportunity_status === 'measured'
        ? `${pulse.market}: opportunity ${pulse.opportunity_score}/100 on ${pulse.lead_sample} leads. Lead with ${top ? top.name.toLowerCase() : 'no angle yet'}. Creative intelligence ${cis.score}/100.`
        : `${pulse.market}: not enough data to score. ${pulse.lead_sample} leads held, ${marketPulse.MIN_LEADS_FOR_SCORE} needed. No creative can be built on this yet.`,
      findings, recommendations, missing,
      confidence: {
        score: pulse.data_confidence,
        reasoning: `${pulse.data_confidence_basis} Competitive density, search demand and MLS statistics are unavailable and were excluded rather than estimated.`,
      },
      sources: [
        { source: 'Veori workspace leads and deals', tier: 'operator', rows: pulse.lead_sample + pulse.deal_sample },
        ...(network.data_points ? [{ source: 'Cross-operator anonymised results', tier: 'secondary', rows: network.data_points }] : []),
      ],
      data: { pulse_market: pulse.market, target_zips: pulse.target_zips, primary_angle: primaryAngle, primary_driver: primaryDriver, creative_intelligence_score: cis.score, brief },
    };
  },
});

// ── Storage ─────────────────────────────────────────────────────────────────
// One live brief per market per operator. Generating a new one supersedes the old
// one rather than deleting it, so a creative can always be traced to the brief it
// was built on.
async function generate(userId, market, { actorUserId = null } = {}) {
  const out = await agent.run({ userId, actorUserId, command: 'ads.preflight', inputs: { market } });
  if (out.status === 'error') throw Object.assign(new Error(out.summary), { status: 502 });
  const d = out.data;
  const expires = new Date(Date.now() + BRIEF_TTL_DAYS * 86400000).toISOString();

  await supabase.from('market_preflight_brief').update({ superseded: true }).eq('user_id', userId).eq('market', d.pulse_market).eq('superseded', false);
  const { data, error } = await supabase.from('market_preflight_brief').insert({
    user_id: userId, market: d.pulse_market, target_zips: d.target_zips || [],
    expires_at: expires, data_confidence: out.confidence.score,
    opportunity_score: d.brief.market_pulse.opportunity_score,
    creative_intelligence_score: d.creative_intelligence_score,
    primary_angle: d.primary_angle, primary_driver: d.primary_driver,
    brief: d.brief, sources: out.sources,
    data_gaps: out.missing, superseded: false,
  }).select('*').single();
  if (error) throw error;
  return { brief: data, agent_output: out };
}

async function live(userId, market) {
  const label = marketPulse.resolveMarket(market).label;
  const { data, error } = await supabase.from('market_preflight_brief')
    .select('*').eq('user_id', userId).eq('market', label).eq('superseded', false)
    .order('generated_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { ...data, expired: new Date(data.expires_at).getTime() < Date.now() };
}

// The gate. Every ads agent calls this first and there is no way past it.
async function requireBrief(userId, market) {
  const b = await live(userId, market);
  if (!b) {
    throw Object.assign(new Error(`No market pre-flight brief exists for ${marketPulse.resolveMarket(market).label}. Run the pre-flight first: nothing in the ads system is allowed to form its own view of a market.`), { status: 409, code: 'PREFLIGHT_REQUIRED' });
  }
  if (b.expired) {
    throw Object.assign(new Error(`The pre-flight brief for ${b.market} expired on ${new Date(b.expires_at).toISOString().slice(0, 10)}. Market facts older than ${BRIEF_TTL_DAYS} days are not reused. Run the pre-flight again.`), { status: 409, code: 'PREFLIGHT_EXPIRED' });
  }
  if (b.opportunity_score == null) {
    throw Object.assign(new Error(`The pre-flight for ${b.market} could not be scored: there is not enough lead history in that market. Building creative on it would mean inventing the market.`), { status: 409, code: 'PREFLIGHT_INSUFFICIENT' });
  }
  return b;
}

async function history(userId, { market = null, limit = 20 } = {}) {
  let q = supabase.from('market_preflight_brief')
    .select('id,market,generated_at,expires_at,superseded,data_confidence,opportunity_score,creative_intelligence_score,primary_angle,primary_driver')
    .eq('user_id', userId).order('generated_at', { ascending: false }).limit(Math.min(100, Number(limit) || 20));
  if (market) q = q.eq('market', marketPulse.resolveMarket(market).label);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

module.exports = { agent, declaration, generate, live, requireBrief, history, voiceOf, profileCompleteness, creativeIntelligenceScore, BRIEF_TTL_DAYS };
