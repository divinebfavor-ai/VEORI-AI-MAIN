// ─── Creative Intelligence ───────────────────────────────────────────────────
// Produces a complete creative package for one market: hooks, the image brief
// that any designer or generator can execute, a five-part video script, an
// organic companion, the compliance checklist, and the expected cost labelled
// for what it is.
//
// Three rules hold the whole thing up:
//   1. It cannot run without a live pre-flight brief. Market facts come from the
//      brief and nowhere else.
//   2. Every sentence is composed from an approved fragment and a figure taken
//      from this operator's records. No copy comes from a language model, so
//      nothing can appear that was not written and reviewed in advance.
//   3. Nothing that fails compliance or the non-duplication gate is stored.

const supabase = require('../config/supabase');
const { defineAgent } = require('../intelligence/agentKit');
const { claim, STATUS } = require('../intelligence/provenance');
const preflight = require('./preflight');
const dedupe = require('./dedupe');
const compliance = require('./compliance');
const learning = require('./learning');
const { ANGLE_COPY, HOOK_BUILDERS, VIDEO_PARTS, cap } = require('./copy');
const { angle: angleOf, driver: driverOf, HOOK_STYLES, IMAGE_FORMATS } = require('./catalog');

const MIN_PROOF_EVENTS = 3;    // fewer than this and a proof point is not stated at all

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const money = (n) => '$' + Math.round(Number(n)).toLocaleString('en-US');

// ── Proof: only what the operator has actually done ─────────────────────────
async function proofPoints(userId, market, scope) {
  let q = supabase.from('deals').select('id,status,created_at,updated_at,closing_date,fee_collected_at,seller_agreed_price,offer_price,property_type:property_zip,property_city,property_state,property_zip').eq('user_id', userId).limit(2000);
  if (scope.kind === 'zip') q = q.eq('property_zip', scope.zip);
  else if (scope.kind === 'city') q = q.eq('property_state', scope.state).ilike('property_city', scope.city);
  else q = q.eq('property_state', scope.state);
  const { data, error } = await q;
  if (error) throw error;
  const deals = data || [];
  const closed = deals.filter(d => d.status === 'closed');

  const spans = closed.map(d => {
    const end = d.fee_collected_at || d.closing_date || d.updated_at;
    return end ? Math.round((new Date(end) - new Date(d.created_at)) / 86400000) : null;
  }).filter(v => v != null && v >= 0);
  const prices = closed.map(d => Number(d.seller_agreed_price || d.offer_price)).filter(v => v > 0);

  const point = (value, n, basis, unusableWhy) => ({
    value, events: n, usable: n >= MIN_PROOF_EVENTS && value != null,
    status: n >= MIN_PROOF_EVENTS && value != null ? STATUS.VERIFIED : STATUS.UNKNOWN,
    basis: n >= MIN_PROOF_EVENTS && value != null ? basis : unusableWhy,
  });

  return {
    closings: point(closed.length || null, closed.length, `${closed.length} deals in ${market} are marked closed in this workspace.`, `${closed.length} closed deals here. Veori will not put a number in an ad below ${MIN_PROOF_EVENTS}; the ad speaks to process instead.`),
    median_days: point(median(spans), spans.length, `Median of ${spans.length} closings, measured from the day the deal was created to the day the fee was collected.`, `Only ${spans.length} closings carry both dates, so no timeline is claimed.`),
    price_range: point(prices.length ? [Math.min(...prices), Math.max(...prices)] : null, prices.length, `Across ${prices.length} closings with a recorded price.`, `Only ${prices.length} closings carry a price, so no range is claimed.`),
    deals_in_progress: { value: deals.length - closed.length, events: deals.length - closed.length, usable: false, status: STATUS.VERIFIED, basis: 'Counted, but never used in copy: an open deal is not a result.' },
    rule: `A proof point appears in copy only when it rests on at least ${MIN_PROOF_EVENTS} real closings in this market. Otherwise the ad describes the process, which is always true.`,
  };
}

// ── Choosing the driver ─────────────────────────────────────────────────────
// The angle's own candidates, ranked by the blend of this operator's results and
// the network's. With no results on either side it falls to the catalogue order,
// and says so.
function chooseDriver(angleId, requested, network, model) {
  const a = angleOf(angleId);
  const candidates = a ? a.drivers : [];
  if (requested) {
    if (!candidates.includes(requested)) {
      throw Object.assign(new Error(`The ${requested} driver is not one Veori will pair with "${a ? a.name : angleId}". Allowed: ${candidates.join(', ')}. Each pairing exists because the driver fits the situation; the system does not mix them on request.`), { status: 400, code: 'DRIVER_NOT_ALLOWED' });
    }
    return { driver: requested, basis: 'Chosen by the operator, from the drivers allowed for this situation.', weights: null };
  }
  const weights = learning.blend(model?.data_points || 0);
  const netRank = new Map((network.by_driver || []).map((d, i) => [d.value, { rank: i, label: d.label, cpl: d.median_cpl, results: d.results }]));
  const own = model?.best_converting_angle === angleId ? null : null;
  const scored = candidates.map(id => {
    const n = netRank.get(id);
    return {
      id,
      network_position: n ? n.rank + 1 : null, network_label: n ? n.label : null, network_results: n ? n.results : 0,
      score: n ? 100 - n.rank * 10 : 50,
    };
  }).sort((x, y) => y.score - x.score);
  const pick = scored[0];
  const basis = pick.network_position
    ? `${driverOf(pick.id).name} is the best-performing driver for this situation across ${pick.network_results} recorded results in the network (${pick.network_label}). Your own results carry ${weights.own_weight}% of the weight and the network ${weights.network_weight}%.`
    : `No recorded results exist for any driver on this situation, so Veori uses the catalogue order for "${a.name}" and takes ${driverOf(pick.id).name} first. ${driverOf(pick.id).core} This is a documented default, not a finding.`;
  return { driver: pick.id, basis, weights, considered: scored };
}

// ── Hooks ───────────────────────────────────────────────────────────────────
function buildHooks({ angleId, driverId, proof, avoidStyles = [] }) {
  const c = ANGLE_COPY[angleId];
  const d = driverOf(driverId);
  const out = [];
  for (const style of HOOK_STYLES) {
    const build = HOOK_BUILDERS[style.id];
    if (!build) continue;
    const text = build({ c, proof, driver: d });
    if (!text) {
      out.push({ hook_style: style.id, text: null, skipped: `This shape needs a figure from your records and there is none: ${proof.closings.basis}` });
      continue;
    }
    // loss_aversion may only be used where the cost of waiting comes from a record.
    if (driverId === 'loss_aversion' && style.id === 'cost_of_waiting' && !proof.closings.usable && !c.waiting) {
      out.push({ hook_style: style.id, text: null, skipped: 'The cost of waiting must come from a figure on the record.' });
      continue;
    }
    const cc = compliance.check(text, { context: `hook (${style.id})` });
    out.push({
      hook_style: style.id, style_name: style.name, shape: style.shape,
      text, recently_used: avoidStyles.includes(style.id),
      compliance: cc, usable: cc.ok && !avoidStyles.includes(style.id),
      why_not: !cc.ok ? 'Blocked by the compliance check.' : avoidStyles.includes(style.id) ? 'You used this shape in this market inside the last 180 days.' : null,
    });
  }
  return out;
}

// ── Image brief ─────────────────────────────────────────────────────────────
// Stored with every creative so the same instruction can be handed to a designer
// today and to a generator later, and the two produce the same thing.
function imageBrief({ angleId, driverId, format, hook, market, operatorName }) {
  const f = IMAGE_FORMATS.find(x => x.id === format) || IMAGE_FORMATS[0];
  const c = ANGLE_COPY[angleId];
  const d = driverOf(driverId);
  return {
    format: f.id, format_name: f.name, why_this_format: f.use,
    subject: `${cap(c.subject)}, shown as an ordinary thing rather than a problem.`,
    composition: 'Single subject, off-centre, plenty of empty space for the overlay. Eye level, not drone or wide-angle. It must look photographed, not rendered.',
    lighting: 'Flat daylight, overcast. No golden hour, no dramatic shadow. Drama reads as an advertisement.',
    palette: 'Muted and true to life. No saturated brand colour bars, no gradients.',
    text_overlay: { text: hook, placement: 'Upper third, left aligned', rules: 'Maximum two lines. No exclamation marks. No price, no phone number, no arrow. Never more than 20% of the frame.' },
    must_not_appear: [
      'Any person’s face, unless it is a real photograph of the operator',
      'Anything identifying a real address, name, document or case number',
      'Distress cues: boarded windows, rubbish piles, "SOLD" or auction signage',
      'Stock-photo handshakes, oversized keys, cartoon houses, dollar signs',
      'A document that could be mistaken for a real legal notice',
      'Any implication about who lives in the property',
    ],
    accessibility: { alt_text: `${f.name}: ${c.subject}. Overlay reads: ${hook}` },
    aspect_ratios: [
      { placement: 'Meta feed', ratio: '4:5', pixels: '1080x1350' },
      { placement: 'Meta and Instagram stories/reels', ratio: '9:16', pixels: '1080x1920' },
      { placement: 'Google Display', ratio: '1.91:1', pixels: '1200x628' },
      { placement: 'Square, all platforms', ratio: '1:1', pixels: '1080x1080' },
    ],
    driver_alignment: `The image carries ${d.name.toLowerCase()}: ${d.core}`,
    production_note: 'No image generator is connected to Veori. This brief is the deliverable: hand it to a designer, a generator or a photographer and the result will match the ad.',
    provenance: { market, built_for: operatorName || null, generated_at: new Date().toISOString() },
  };
}

// ── Video ───────────────────────────────────────────────────────────────────
function videoScript({ angleId, driverId, proof, hook }) {
  const c = ANGLE_COPY[angleId];
  const d = driverOf(driverId);
  const proofLine = proof.closings.usable
    ? `We have bought ${proof.closings.value} houses here${proof.median_days.usable ? `, and the middle one took ${proof.median_days.value} days from the first call` : ''}.${proof.price_range.usable ? ` Between ${money(proof.price_range.value[0])} and ${money(proof.price_range.value[1])}.` : ''}`
    : 'Here is exactly what happens: one call, one walkthrough, a number in writing, and you decide. If you say no, that is the end of it and nobody calls you again.';
  const lines = {
    1: hook,
    2: `${cap(c.they_say)}. That is the whole situation, and it is more common than you would think.`,
    3: `${c.permission} ${cap(c.objection)} — that is the part that stops most people, and it is not true here.`,
    4: proofLine,
    5: `One call. ${cap(c.one_step)}. If it is not worth doing, you say so and we are done.`,
  };
  const parts = VIDEO_PARTS.map(p => ({
    ...p,
    line: lines[p.part],
    on_screen: p.part === 1 ? 'No text for the first second. Then the line, two lines maximum.'
      : p.part === 4 ? (proof.closings.usable ? 'The figures on screen as they are spoken, so they can be read and checked.' : 'No figures on screen. There are none to show.')
      : 'Speaker only. No captions competing with the voice.',
    compliance: compliance.check(lines[p.part], { context: `video part ${p.part}` }),
  }));
  return {
    architecture: 'Five parts, fixed. The same structure every time is what makes one video comparable to the next.',
    total_seconds: 45, parts,
    delivery: `Spoken by the operator, to camera, in one take. ${d.name} does not survive a voiceover.`,
    captions: 'Burned-in captions required: most of this audience watches without sound.',
    proof_rule: proof.rule,
    ok: parts.every(p => p.compliance.ok),
  };
}

// ── Organic companion ───────────────────────────────────────────────────────
function organicCompanion({ angleId, market, proof }) {
  const c = ANGLE_COPY[angleId];
  return {
    platform_note: 'The same angle without the ad shape. It is posted, not boosted, and it does not ask for anything.',
    post: `${cap(c.they_say)} — that is the sentence I hear most often about ${c.subject} in ${market}.\n\nWhat usually surprises people: ${c.permission.toLowerCase()}\n\n${proof.closings.usable ? `${proof.closings.value} of these have come across my desk here.` : 'If that is where you are, the first step is a conversation, not a decision.'}`,
    why_it_works: 'It earns the right to be believed before anything is asked for, and it gives the paid ad somewhere credible to land.',
    do_not: ['Do not add a call to action.', 'Do not add a link.', 'Do not post it the same day the ad starts: let it sit first.'],
    compliance: compliance.check(`${c.they_say} ${c.permission}`, { context: 'organic post' }),
  };
}

// ── Expected cost ───────────────────────────────────────────────────────────
function costExpectation(network, angleId, model) {
  const row = (network.by_angle || []).find(a => a.value === angleId);
  const ownCpl = model?.avg_cpl_by_channel && Object.keys(model.avg_cpl_by_channel).length ? model.avg_cpl_by_channel : null;
  if (!row && !ownCpl) {
    return {
      cost_per_lead: null, label: 'UNKNOWN',
      statement: 'Veori has no recorded cost-per-lead for this situation, from you or from the network. It does not estimate one.',
      not_a_guarantee: 'Veori never guarantees a cost per lead. Advertising cost is set by the auction, the audience and the creative, none of which Veori controls.',
    };
  }
  return {
    cost_per_lead: row ? row.median_cpl : null,
    range: row ? row.cpl_range : null,
    label: row ? row.label : 'ESTIMATED',
    basis: row ? row.label_meaning : null,
    your_own_by_channel: ownCpl,
    your_own_basis: ownCpl ? `Median of your own recorded results, across ${model.data_points} campaigns.` : 'You have recorded no results of your own yet.',
    statement: row
      ? `${row.label === 'BENCHMARKED' ? 'Benchmarked' : 'Directional only'}: other operators running this situation recorded a median of ${row.median_cpl == null ? 'no cost figure' : money(row.median_cpl)} per lead across ${row.results} results from ${row.contributors} operators.`
      : 'Only your own recorded results are available for this.',
    not_a_guarantee: 'This is what was recorded, not what you will pay. Advertising cost is set by the auction, the audience and the creative. Veori never guarantees a cost per lead.',
  };
}

// ── The agent ───────────────────────────────────────────────────────────────
const declaration = {
  id: 'creative_intelligence',
  name: 'Creative Intelligence',
  domain: 'advertising',
  version: '1.0.0',
  last_knowledge_update: '2026-09-18',
  capabilities: ['hook_generation', 'image_brief', 'video_script', 'organic_companion', 'compliance_screening', 'non_duplication'],
  required_inputs: ['market'],
  outputs: ['creative_package'],
  tools: ['market_preflight_brief', 'deals_history', 'cross_operator_learnings', 'non_duplication_engine', 'compliance_screen'],
  knowledge_sources: ['market_preflight_brief', 'veori_creative_catalogue', 'operator_workspace_data'],
  handoff_agents: [],
  permissions: 'DRAFT',
  risk_level: 'medium',
  jurisdiction_aware: true,
};

const agent = defineAgent({
  declaration,
  async analyze(ctx) {
    const { market } = ctx.inputs;
    const brief = await preflight.requireBrief(ctx.userId, market);   // the gate
    const b = brief.brief;

    const requestedAngle = ctx.inputs.angle || null;
    const ranked = b.angle_ranking || [];
    if (!ranked.length) throw Object.assign(new Error(`The pre-flight for ${brief.market} found no situation with evidence behind it. There is nothing to advertise yet.`), { status: 409, code: 'NO_ANGLE' });
    const chosen = requestedAngle ? ranked.find(r => r.angle === requestedAngle) : ranked[0];
    if (!chosen) {
      throw Object.assign(new Error(`"${requestedAngle}" has no evidence in ${brief.market}: not one of your leads there shows that situation. Veori will not build creative for a situation it cannot see. Available: ${ranked.map(r => r.angle).join(', ')}.`), { status: 409, code: 'ANGLE_NOT_IN_BRIEF' });
    }

    const [proof, network, model] = await Promise.all([
      proofPoints(ctx.userId, brief.market, require('./marketPulse').resolveMarket(brief.market)),
      learning.networkGuidance({ angles: [chosen.angle], platform: ctx.inputs.platform || null }),
      learning.operatorModel(ctx.userId),
    ]);
    const driverPick = chooseDriver(chosen.angle, ctx.inputs.psychological_driver || null, network, model);

    // Shapes used in this market recently, so the next creative does not repeat one.
    const since = new Date(Date.now() - dedupe.OPERATOR_LOOKBACK_DAYS * 86400000).toISOString();
    const { data: recent } = await supabase.from('ad_creatives').select('hook_style').eq('user_id', ctx.userId).eq('market', brief.market).gte('created_at', since).limit(200);
    const avoidStyles = [...new Set((recent || []).map(r => r.hook_style).filter(Boolean))];

    const hooks = buildHooks({ angleId: chosen.angle, driverId: driverPick.driver, proof, avoidStyles });
    const usable = hooks.filter(h => h.usable);
    if (!usable.length) {
      return {
        output_type: 'creative_package', status: 'insufficient_data',
        summary: `Every hook shape for "${chosen.name}" in ${brief.market} is either already used here in the last ${dedupe.OPERATOR_LOOKBACK_DAYS} days or has no evidence to stand on. Nothing is produced rather than repeating yourself.`,
        confidence: { score: 0, reasoning: 'No usable hook could be built without repeating a shape already running or stating a figure that does not exist.' },
        missing: [{ item: 'An unused hook shape or new closings', why_it_matters: 'Repeating a shape in the same market inside the lookback window is what makes ads stop working.', how_to_get: `Wait for the ${dedupe.OPERATOR_LOOKBACK_DAYS}-day window to clear, pick a different situation, or record closings so the evidence-backed shapes open up.` }],
        data: { market: brief.market, angle: chosen.angle, hooks },
      };
    }

    const format = ctx.inputs.image_format && IMAGE_FORMATS.some(f => f.id === ctx.inputs.image_format)
      ? ctx.inputs.image_format
      : (proof.closings.usable ? 'exterior_ordinary' : 'text_on_plain');

    // Score every usable hook against the non-duplication engine and keep the best.
    const scored = [];
    for (const h of usable) {
      const candidate = { angle: chosen.angle, psychological_driver: driverPick.driver, hook_style: h.hook_style, image_format: format, hook: h.text };
      scored.push({ ...h, candidate, dedupe: await dedupe.evaluate(ctx.userId, candidate, brief.market) });
    }
    scored.sort((a, b2) => b2.dedupe.differentiation.score - a.dedupe.differentiation.score);
    const best = scored[0];
    const allowed = scored.filter(s => s.dedupe.allowed);

    const image = imageBrief({ angleId: chosen.angle, driverId: driverPick.driver, format, hook: best.text, market: brief.market, operatorName: ctx.operatorName || null });
    const video = videoScript({ angleId: chosen.angle, driverId: driverPick.driver, proof, hook: best.text });
    const organic = organicCompanion({ angleId: chosen.angle, market: brief.market, proof });
    const cost = costExpectation(network, chosen.angle, model);
    const checklist = compliance.checklist(brief.market);

    // The creative's own intelligence score: what the brief knew, moved by how
    // distinct this particular execution is and whether it has proof behind it.
    const cis = Math.max(0, Math.min(100, Math.round(
      (brief.creative_intelligence_score || 0) * 0.55 +
      best.dedupe.differentiation.score * 0.30 +
      (proof.closings.usable ? 100 : 0) * 0.15
    )));

    return {
      output_type: 'creative_package',
      status: allowed.length ? 'complete' : 'insufficient_data',
      summary: `${brief.market} — ${chosen.name}, ${driverOf(driverPick.driver).name} driver. ${allowed.length} of ${scored.length} hooks cleared compliance and non-duplication. Differentiation ${best.dedupe.differentiation.score}/100, creative intelligence ${cis}/100.`,
      findings: [
        { label: 'Situation chosen', claim: claim(chosen.name, STATUS.CALCULATED, { source: 'market_preflight_brief', source_tier: 'operator', basis: chosen.evidence, confidence: chosen.evidence_strength === 'strong' ? 85 : chosen.evidence_strength === 'moderate' ? 60 : 30 }) },
        { label: 'Driver chosen', claim: claim(driverOf(driverPick.driver).name, network.usable ? STATUS.INFERRED : STATUS.ESTIMATED, { source: network.usable ? 'cross_operator_learnings' : 'veori_creative_catalogue', source_tier: network.usable ? 'secondary' : 'model', basis: driverPick.basis }) },
        { label: 'Closings behind the proof line', claim: claim(proof.closings.value, proof.closings.status, { source: 'veori_workspace_data', source_tier: 'operator', basis: proof.closings.basis }) },
        { label: 'Expected cost per lead', claim: claim(cost.cost_per_lead, cost.label === 'BENCHMARKED' ? STATUS.VERIFIED : cost.label === 'ESTIMATED' ? STATUS.ESTIMATED : STATUS.UNKNOWN, { source: 'cross_operator_learnings', source_tier: 'secondary', basis: cost.statement, note: cost.not_a_guarantee }) },
      ],
      risks: [
        ...(best.dedupe.differentiation.score < 70 ? [{ risk: best.dedupe.differentiation.verdict, severity: 'medium', category: 'duplication', evidence: best.dedupe.differentiation.deductions.map(d => d.reason).join('; '), mitigation: 'Change the hook shape or the image format.' }] : []),
        ...(proof.closings.usable ? [] : [{ risk: 'No closings in this market, so the ad cannot offer anything checkable', severity: 'medium', category: 'credibility', evidence: proof.closings.basis, mitigation: 'The copy describes the process instead of claiming a result. That is honest but weaker; the first closings here will change it.' }]),
        ...(brief.data_confidence < 50 ? [{ risk: `The pre-flight brief behind this is only ${brief.data_confidence}% confident`, severity: 'high', category: 'market_data', evidence: 'Competitive density, search demand and MLS statistics are all unavailable.', mitigation: 'Treat the first spend as research and record the results.' }] : []),
      ],
      recommendations: [
        { action: `Run the "${best.style_name}" hook first`, why: `It scored ${best.dedupe.differentiation.score}/100 for differentiation, the highest of the ${scored.length} built, and cleared compliance.`, urgency: 'high', assigned_to: 'operator' },
        ...(allowed.length > 1 ? [{ action: `Hold "${allowed[1].style_name}" as the variant`, why: 'A second shape, not a second wording. Testing two wordings of the same shape tells you nothing.', urgency: 'medium', assigned_to: 'operator' }] : []),
        { action: 'Record the result against this creative when the campaign has run', why: `Your own results carry ${learning.blend(model?.data_points || 0).own_weight}% of the weight in the next recommendation, and the network's share falls as yours grows.`, urgency: 'medium', assigned_to: 'operator' },
      ],
      missing: brief.data_gaps || [],
      confidence: {
        score: cis,
        reasoning: `Creative intelligence ${cis}/100: ${Math.round((brief.creative_intelligence_score || 0))} from what the pre-flight could establish (55%), ${best.dedupe.differentiation.score} for how distinct this execution is (30%), and ${proof.closings.usable ? 'proof from real closings' : 'no proof available'} (15%).`,
      },
      sources: [
        { source: 'Market pre-flight brief', tier: 'operator', ref: brief.id, generated_at: brief.generated_at },
        { source: 'Veori workspace deals', tier: 'operator', rows: proof.closings.events },
        ...(network.data_points ? [{ source: 'Cross-operator anonymised results', tier: 'secondary', rows: network.data_points }] : []),
      ],
      data: {
        market: brief.market, preflight_brief_id: brief.id,
        angle: chosen.angle, angle_name: chosen.name, angle_evidence: chosen.evidence,
        psychological_driver: driverPick.driver, driver_name: driverOf(driverPick.driver).name, driver_basis: driverPick.basis, learning_blend: driverPick.weights,
        image_format: format,
        hooks: scored.map(s => ({ hook_style: s.hook_style, style_name: s.style_name, text: s.text, differentiation: s.dedupe.differentiation.score, allowed: s.dedupe.allowed, compliance_ok: s.compliance.ok, why_not: s.why_not, blockers: s.dedupe.freshness.passed ? null : s.dedupe.freshness.reason })),
        skipped_shapes: hooks.filter(h => !h.text).map(h => ({ hook_style: h.hook_style, why: h.skipped })),
        selected: { hook: best.text, hook_style: best.hook_style, differentiation: best.dedupe.differentiation, dedupe: best.dedupe },
        image_brief: image, video_script: video, organic_companion: organic,
        cost_expectation: cost, compliance_checklist: checklist,
        proof_points: proof,
        creative_intelligence_score: cis,
        brief_says: {
          opportunity_score: b.market_pulse?.opportunity_score ?? null,
          do_not_use: b.do_not_use?.phrases?.map(p => p.phrase) || [],
          unknown_by_design: b.no_agent_may_assume?.forbidden || [],
        },
      },
    };
  },
});

// Codes that mean "Veori refused because the evidence is not there", not "it broke".
const REFUSALS = new Set(['PREFLIGHT_REQUIRED', 'PREFLIGHT_EXPIRED', 'PREFLIGHT_INSUFFICIENT', 'NO_ANGLE', 'ANGLE_NOT_IN_BRIEF', 'DRIVER_NOT_ALLOWED']);

// ── Persisting a package ────────────────────────────────────────────────────
async function generate(userId, input, { actorUserId = null } = {}) {
  const out = await agent.run({ userId, actorUserId, command: 'ads.creative', inputs: input });
  if (out.status === 'error') {
    const e = new Error(out.summary);
    // A refusal is not a failure: these are the cases where Veori declined to
    // build something because the evidence for it does not exist.
    e.code = out.error?.code || 'CREATIVE_FAILED';
    e.status = REFUSALS.has(e.code) ? 409 : 400;
    throw e;
  }
  if (out.status !== 'complete') return { creative: null, agent_output: out };

  const d = out.data;
  const { data: cb, error: cbErr } = await supabase.from('creative_briefs').insert({
    user_id: userId, preflight_brief_id: d.preflight_brief_id, market: d.market,
    angle: d.angle, psychological_driver: d.psychological_driver, image_format: d.image_format,
    hook: d.selected.hook, hook_style: d.selected.hook_style,
    emotional_tone: driverOf(d.psychological_driver)?.name || null,
    brief: {
      image_brief: d.image_brief, video_script: d.video_script, organic_companion: d.organic_companion,
      hooks: d.hooks, skipped_shapes: d.skipped_shapes, proof_points: d.proof_points,
      cost_expectation: d.cost_expectation, driver_basis: d.driver_basis, learning_blend: d.learning_blend,
      angle_evidence: d.angle_evidence, brief_says: d.brief_says, creative_intelligence_score: d.creative_intelligence_score,
    },
    compliance: { checklist: d.compliance_checklist, differentiation: d.selected.differentiation, screened_at: new Date().toISOString() },
  }).select('*').single();
  if (cbErr) throw cbErr;

  const { data: creative, error: cErr } = await supabase.from('ad_creatives').insert({
    user_id: userId, creative_brief_id: cb.id, market: d.market, asset_type: 'package',
    angle: d.angle, psychological_driver: d.psychological_driver, image_format: d.image_format,
    hook: d.selected.hook, hook_style: d.selected.hook_style, status: 'draft',
    content: { image_brief: d.image_brief, video_script: d.video_script, organic_companion: d.organic_companion, creative_intelligence_score: d.creative_intelligence_score },
  }).select('*').single();
  if (cErr) throw cErr;

  return { creative, creative_brief: cb, agent_output: out };
}

module.exports = { agent, declaration, generate, REFUSALS, proofPoints, chooseDriver, buildHooks, imageBrief, videoScript, organicCompanion, costExpectation, MIN_PROOF_EVENTS };
