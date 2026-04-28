// ─── Veori Data Moat Engine ───────────────────────────────────────────────────
// Every call WRITES intelligence. Every new call READS it.
// This is what nobody can replicate — proprietary learning that compounds.
const supabase = require('../config/supabase');

// ─── WRITE: Record everything learned from a completed call ──────────────────
async function recordCallIntelligence({ call, lead, aiAnalysis, operator }) {
  const { outcome, motivation_score, seller_personality, key_signals, objections, ai_summary } = aiAnalysis || {};
  if (!lead || !outcome) return;

  const worked = ['appointment', 'offer_made', 'verbal_yes'].includes(outcome);

  // 1. Upsert seller profile — builds trust/personality model over every touch
  try {
    const { data: existing } = await supabase
      .from('seller_profiles')
      .select('*')
      .eq('lead_id', lead.id)
      .single();

    const profileUpdate = {
      lead_id:              lead.id,
      user_id:              lead.user_id,
      personality_type:     seller_personality || existing?.personality_type || null,
      trust_level:          Math.min(100, (existing?.trust_level || 0) + (worked ? 15 : 3)),
      total_touches:        (existing?.total_touches || 0) + 1,
      responded_to_empathy: existing?.responded_to_empathy || (worked && ['emotional','empathetic'].includes(seller_personality)),
      responded_to_urgency: existing?.responded_to_urgency || (worked && seller_personality === 'motivated'),
      responded_to_data:    existing?.responded_to_data    || (worked && seller_personality === 'analytical'),
      last_positive_signal: worked ? (ai_summary?.slice(0, 200) || outcome) : existing?.last_positive_signal,
      updated_at:           new Date().toISOString(),
    };

    // Detect dominant objection from transcript
    if (objections?.length) {
      const priceObj = objections.find(o => /price|low|worth|value/i.test(o));
      const trustObj = objections.find(o => /trust|investor|scam|legit/i.test(o));
      const timeObj  = objections.find(o => /think|later|not now|wait/i.test(o));
      profileUpdate.dominant_objection = priceObj ? 'price' : trustObj ? 'trust' : timeObj ? 'timing' : 'other';
    }

    if (existing) {
      await supabase.from('seller_profiles').update(profileUpdate).eq('lead_id', lead.id);
    } else {
      await supabase.from('seller_profiles').insert(profileUpdate);
    }
  } catch (e) { console.error('[DataMot] seller_profiles write failed:', e.message); }

  // 2. Log conversation pattern — what approach + what outcome
  try {
    const opening = call?.transcript
      ? call.transcript.slice(0, 300)
      : `Tag: ${lead.primary_tag || 'unknown'}`;

    await supabase.from('conversation_patterns').insert({
      user_id:                 lead.user_id,
      lead_tag:                lead.primary_tag || 'absentee_owner',
      seller_personality:      seller_personality || null,
      pattern_type:            'opening',
      phrase_used:             opening,
      outcome,
      worked,
      call_duration_seconds:   call?.duration_seconds || null,
      motivation_score_after:  motivation_score || null,
      state:                   lead.property_state || null,
    });
  } catch (e) { console.error('[DataMot] conversation_patterns write failed:', e.message); }

  // 3. Log objections heard + whether they were resolved
  if (objections?.length) {
    try {
      const objectionRows = objections.map(obj => ({
        user_id:              lead.user_id,
        objection_text:       obj,
        objection_category:   /price|low|worth/i.test(obj) ? 'price'
                            : /trust|investor|scam/i.test(obj) ? 'trust'
                            : /think|later|wait/i.test(obj) ? 'timing'
                            : /agent|realtor/i.test(obj) ? 'agent'
                            : 'other',
        resolved:             worked,
        lead_tag:             lead.primary_tag || null,
        seller_personality:   seller_personality || null,
        call_id:              call?.id || null,
      }));
      await supabase.from('objection_library').insert(objectionRows);
    } catch (e) { console.error('[DataMot] objection_library write failed:', e.message); }
  }

  // 4. Log market price anchor — build proprietary price intelligence per market
  if (lead.property_state && (lead.estimated_value || call?.offer_made)) {
    try {
      await supabase.from('market_anchors').insert({
        state:              lead.property_state,
        city:               lead.property_city || null,
        zip_code:           lead.property_zip || null,
        property_type:      lead.property_type || 'Single Family',
        seller_asking_price: lead.asking_price || null,
        offer_made:         call?.offer_price || null,
        arv:                lead.estimated_value || null,
        deal_closed:        outcome === 'verbal_yes',
        lead_tag:           lead.primary_tag || null,
      });
    } catch (e) { console.error('[DataMot] market_anchors write failed:', e.message); }
  }

  console.log(`[DataMot] Intelligence recorded for lead ${lead.id} — outcome: ${outcome}, worked: ${worked}`);
}

// ─── WRITE: Record winning playbook when a deal closes ───────────────────────
async function recordWinningPlaybook({ deal, calls_to_close, days_to_close, lead }) {
  if (!deal || !lead) return;
  try {
    // Get the best call for this deal to extract what closed it
    const { data: bestCall } = await supabase
      .from('calls')
      .select('ai_summary, transcript, outcome, duration_seconds')
      .eq('lead_id', lead.id)
      .in('outcome', ['verbal_yes', 'appointment', 'offer_made'])
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    await supabase.from('winning_playbooks').insert({
      deal_id:               deal.deal_id || deal.id,
      user_id:               deal.user_id || deal.operator_id,
      lead_tag:              lead.primary_tag || null,
      seller_personality:    lead.seller_personality || null,
      state:                 deal.property_state || null,
      calls_to_close,
      days_to_close,
      opening_that_worked:   bestCall?.transcript?.slice(0, 400) || null,
      what_closed_the_deal:  bestCall?.ai_summary || null,
      price_discount_percent: deal.seller_agreed_price && deal.arv
        ? Math.round((1 - deal.seller_agreed_price / deal.arv) * 100)
        : null,
      arv:            deal.arv || null,
      assignment_fee: deal.assignment_fee || null,
    });
    console.log(`[DataMot] Winning playbook recorded for deal ${deal.deal_id || deal.id}`);
  } catch (e) { console.error('[DataMot] winning_playbook write failed:', e.message); }
}

// ─── READ: Pull accumulated intelligence for a lead before a call ─────────────
async function getCallIntelligence({ lead, operator }) {
  const tag   = lead.primary_tag || 'absentee_owner';
  const state = lead.property_state;

  const [profileRes, playbooksRes, patternsRes, anchorsRes, objectionsRes] = await Promise.allSettled([
    // This seller's specific profile
    supabase.from('seller_profiles')
      .select('*')
      .eq('lead_id', lead.id)
      .single(),

    // What has closed deals for this tag in this state
    supabase.from('winning_playbooks')
      .select('lead_tag, seller_personality, calls_to_close, what_closed_the_deal, opening_that_worked, price_discount_percent')
      .eq('lead_tag', tag)
      .eq('state', state)
      .order('created_at', { ascending: false })
      .limit(3),

    // Top phrases that have worked for this tag
    supabase.from('conversation_patterns')
      .select('phrase_used, outcome, seller_personality, motivation_score_after')
      .eq('lead_tag', tag)
      .eq('worked', true)
      .order('created_at', { ascending: false })
      .limit(5),

    // Price expectations in this market
    supabase.from('market_anchors')
      .select('seller_asking_price, offer_made, deal_closed, arv')
      .eq('state', state)
      .eq('lead_tag', tag)
      .order('recorded_at', { ascending: false })
      .limit(10),

    // Most common objections for this tag and how to handle them
    supabase.from('objection_library')
      .select('objection_text, objection_category, resolved')
      .eq('lead_tag', tag)
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  const sellerProfile = profileRes.value?.data || null;
  const playbooks     = playbooksRes.value?.data || [];
  const patterns      = patternsRes.value?.data || [];
  const anchors       = anchorsRes.value?.data || [];
  const objectionData = objectionsRes.value?.data || [];

  // Build price intelligence
  const closedDeals  = anchors.filter(a => a.deal_closed && a.offer_made);
  const avgDiscount  = closedDeals.length
    ? Math.round(closedDeals.reduce((s, a) => s + (1 - a.offer_made / (a.arv || a.offer_made)) * 100, 0) / closedDeals.length)
    : null;

  // Most common unresolved objections to prepare for
  const unresolvedObjs = objectionData.filter(o => !o.resolved)
    .reduce((acc, o) => {
      acc[o.objection_category] = (acc[o.objection_category] || 0) + 1;
      return acc;
    }, {});
  const topObjCategory = Object.entries(unresolvedObjs).sort((a,b)=>b[1]-a[1])[0]?.[0];

  return { sellerProfile, playbooks, patterns, anchors, avgDiscount, topObjCategory, objectionData };
}

// ─── Format intelligence block for Alex's system prompt ──────────────────────
function buildAccumulatedIntelligenceBlock({ sellerProfile, playbooks, patterns, avgDiscount, topObjCategory, lead }) {
  const lines = [];

  lines.push('');
  lines.push('═══════════════════════════════════════════');
  lines.push('ACCUMULATED INTELLIGENCE — VEORI DATA ENGINE');
  lines.push('═══════════════════════════════════════════');
  lines.push('This intelligence was built from real calls. Use it as your edge.');

  // Returning seller — personalize based on history
  if (sellerProfile && sellerProfile.total_touches > 0) {
    lines.push('');
    lines.push(`THIS SELLER HAS BEEN CONTACTED ${sellerProfile.total_touches} TIME(S) BEFORE:`);
    lines.push(`- Trust level built: ${sellerProfile.trust_level}/100`);
    if (sellerProfile.personality_type) {
      lines.push(`- Personality confirmed: ${sellerProfile.personality_type}`);
    }
    if (sellerProfile.dominant_objection) {
      lines.push(`- Their dominant objection: ${sellerProfile.dominant_objection} — prepare for it`);
    }
    if (sellerProfile.last_positive_signal) {
      lines.push(`- Last positive signal: "${sellerProfile.last_positive_signal.slice(0, 150)}"`);
    }
    if (sellerProfile.responded_to_empathy) lines.push('- RESPONDS TO: Empathy. Lead with understanding.');
    if (sellerProfile.responded_to_data)    lines.push('- RESPONDS TO: Data. Give them numbers.');
    if (sellerProfile.responded_to_urgency) lines.push('- RESPONDS TO: Urgency. Move fast.');
  }

  // What has closed deals like this
  if (playbooks.length > 0) {
    lines.push('');
    lines.push(`WHAT HAS CLOSED DEALS LIKE THIS (${lead.primary_tag?.toUpperCase().replace(/_/g,' ')} in ${lead.property_state || 'this market'}):`);
    playbooks.slice(0, 2).forEach((p, i) => {
      if (p.what_closed_the_deal) {
        lines.push(`- Playbook ${i+1}: "${p.what_closed_the_deal.slice(0, 200)}"`);
      }
      if (p.calls_to_close) {
        lines.push(`  Avg calls to close: ${p.calls_to_close} | Price discount: ${p.price_discount_percent || '?'}% below ARV`);
      }
    });
  }

  // Price anchors
  if (avgDiscount !== null) {
    lines.push('');
    lines.push(`MARKET PRICE INTELLIGENCE (${lead.property_state || 'this market'}):`);
    lines.push(`- Deals for this lead type have closed at ~${avgDiscount}% below ARV`);
    lines.push(`- Use this to anchor your offer with confidence`);
  }

  // What to watch for
  if (topObjCategory) {
    const objGuide = {
      price:  'The #1 objection in this market is price. Lead with value: "You pay no agent fees, no repairs, fast close — that has real value."',
      trust:  'Trust is the #1 objection here. Build credibility first — mention references, past closings, your process.',
      timing: 'Sellers here often need more time. Plant a seed: "I\'m not here to rush you. Can I follow up in a week?"',
      agent:  'Some sellers have agents. Confirm early: "Are you working with anyone?" If yes: "No problem — your agent keeps full commission."',
    };
    lines.push('');
    lines.push(`MOST COMMON OBJECTION IN THIS MARKET: ${topObjCategory.toUpperCase()}`);
    lines.push(`Recommended response: ${objGuide[topObjCategory] || 'Listen carefully and acknowledge before responding.'}`);
  }

  // Phrases that have worked
  if (patterns.length > 0) {
    lines.push('');
    lines.push('PHRASES THAT HAVE WORKED WITH THIS LEAD TYPE:');
    patterns.slice(0, 3).forEach(p => {
      if (p.phrase_used) {
        lines.push(`- "${p.phrase_used.slice(0, 120)}" → ${p.outcome}`);
      }
    });
  }

  lines.push('');
  lines.push('Use this intelligence. It represents real seller interactions — patterns that work in the real world.');

  return lines.join('\n');
}

module.exports = {
  recordCallIntelligence,
  recordWinningPlaybook,
  getCallIntelligence,
  buildAccumulatedIntelligenceBlock,
};
