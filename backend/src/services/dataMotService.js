// ─── Veori Data Moat Engine ───────────────────────────────────────────────────
// Every call WRITES intelligence. Every new call READS it.
// This is what nobody can replicate - proprietary learning that compounds.
const supabase = require('../config/supabase');

// ─── WRITE: Record everything learned from a completed call ──────────────────
async function recordCallIntelligence({ call, lead, aiAnalysis, operator }) {
  const { outcome, motivation_score, seller_personality, key_signals, objections, ai_summary } = aiAnalysis || {};
  if (!lead || !outcome) return;

  const worked = ['appointment', 'offer_made', 'verbal_yes'].includes(outcome);

  // E - rejection cooldown: a hard "no" is a signal, not a dead end. We stamp WHEN
  // it happened so the next touch re-approaches softly (acknowledge, don't re-pitch)
  // instead of hammering the same offer the day after they said no.
  const rejected = ['not_interested', 'rejected', 'do_not_call', 'hung_up'].includes(outcome);

  // 1. Upsert seller profile - builds trust/personality model over every touch
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
      last_rejection_at:    rejected ? new Date().toISOString() : (existing?.last_rejection_at || null),
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

  // 2. Log conversation pattern - what approach + what outcome
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

  // 4. Log market price anchor - build proprietary price intelligence per market
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

  console.log(`[DataMot] Intelligence recorded for lead ${lead.id} - outcome: ${outcome}, worked: ${worked}`);
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

  const [profileRes, playbooksRes, patternsRes, anchorsRes, objectionsRes, lastCallRes, outcomesRes] = await Promise.allSettled([
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

    // B - verbatim recall: the most recent prior call WITH THIS SPECIFIC SELLER,
    // so the AI can quote their actual words instead of only a summary tag.
    supabase.from('calls')
      .select('transcript, ai_summary, outcome, created_at')
      .eq('lead_id', lead.id)
      .not('transcript', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single(),

    // Rule 3 (outcome learning): real closed/dead outcomes in THIS state, so Alex
    // knows what's actually converting where this property is - not a guess.
    supabase.from('deal_outcome_learning')
      .select('outcome, days_to_outcome')
      .eq('state', state)
      .limit(200),
  ]);

  const sellerProfile = profileRes.value?.data || null;
  const playbooks     = playbooksRes.value?.data || [];
  const patterns      = patternsRes.value?.data || [];
  const anchors       = anchorsRes.value?.data || [];
  const objectionData = objectionsRes.value?.data || [];
  const lastCall      = lastCallRes.value?.data || null;
  const outcomeRows   = outcomesRes.value?.data || [];

  // Rule 3 - same-state win rate from real terminal outcomes. Only surfaced with a
  // meaningful sample (min 3 decided) so a single deal can't mislead the caller.
  const isWonOutcome  = o => /clos|won|assigned|funded/i.test(o?.outcome || '');
  const isLostOutcome = o => /fell|fail|dead|lost|cancel|withdraw/i.test(o?.outcome || '');
  const wonCount      = outcomeRows.filter(isWonOutcome).length;
  const lostCount     = outcomeRows.filter(isLostOutcome).length;
  const decidedCount  = wonCount + lostCount;
  const wonDaysArr    = outcomeRows.filter(o => isWonOutcome(o) && o.days_to_outcome != null)
                                   .map(o => Number(o.days_to_outcome));
  const stateLearning = decidedCount >= 3 ? {
    state,
    won:               wonCount,
    decided:           decidedCount,
    win_rate:          Math.round((wonCount / decidedCount) * 100),
    avg_days_to_close: wonDaysArr.length
      ? Math.round(wonDaysArr.reduce((s, d) => s + d, 0) / wonDaysArr.length)
      : null,
  } : null;

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

  return { sellerProfile, playbooks, patterns, anchors, avgDiscount, topObjCategory, objectionData, lastCall, stateLearning };
}

// ─── Format intelligence block for Alex's system prompt ──────────────────────
function buildAccumulatedIntelligenceBlock({ sellerProfile, playbooks, patterns, avgDiscount, topObjCategory, lastCall, stateLearning, lead }) {
  const lines = [];

  lines.push('');
  lines.push('═══════════════════════════════════════════');
  lines.push('ACCUMULATED INTELLIGENCE - VEORI DATA ENGINE');
  lines.push('═══════════════════════════════════════════');
  lines.push('This intelligence was built from real calls. Use it as your edge.');

  // Returning seller - personalize based on history
  if (sellerProfile && sellerProfile.total_touches > 0) {
    lines.push('');
    lines.push(`THIS SELLER HAS BEEN CONTACTED ${sellerProfile.total_touches} TIME(S) BEFORE:`);
    lines.push(`- Trust level built: ${sellerProfile.trust_level}/100`);
    if (sellerProfile.personality_type) {
      lines.push(`- Personality confirmed: ${sellerProfile.personality_type}`);
    }
    if (sellerProfile.dominant_objection) {
      lines.push(`- Their dominant objection: ${sellerProfile.dominant_objection} - prepare for it`);
    }
    if (sellerProfile.last_positive_signal) {
      lines.push(`- Last positive signal: "${sellerProfile.last_positive_signal.slice(0, 150)}"`);
    }
    if (sellerProfile.responded_to_empathy) lines.push('- RESPONDS TO: Empathy. Lead with understanding.');
    if (sellerProfile.responded_to_data)    lines.push('- RESPONDS TO: Data. Give them numbers.');
    if (sellerProfile.responded_to_urgency) lines.push('- RESPONDS TO: Urgency. Move fast.');

    // E - rejection cooldown: if they recently said no, do NOT re-pitch the same way.
    // Acknowledge it, lead with what's NEW (a different angle / changed situation),
    // and give them an easy out - a fresh hard sell the week after a "no" just burns
    // the lead. Older rejections (30+ days) are stale; treat as a warm re-open.
    if (sellerProfile.last_rejection_at) {
      const daysSince = Math.floor((Date.now() - new Date(sellerProfile.last_rejection_at).getTime()) / 86400000);
      if (daysSince >= 0 && daysSince < 14) {
        lines.push(`- RECENTLY SAID NO (${daysSince} day(s) ago): Do NOT re-pitch the same offer. Open by acknowledging it - "I know the timing wasn't right last time" - then lead with something NEW. Soft, low-pressure, give them an easy out.`);
      } else if (daysSince >= 14 && daysSince < 60) {
        lines.push(`- Said no ${daysSince} days ago - enough time has passed to re-open warmly. "Wanted to circle back and see if anything's changed on your end."`);
      }
    }
  }

  // B - VERBATIM RECALL: the seller's actual words from the last call. A summary
  // tag ("price objection") tells you WHAT happened; their real sentence tells you
  // HOW they said it. Quoting them back ("Last time you mentioned the roof was your
  // big worry…") is what a 50-year closer does - it proves you listened and skips
  // re-discovery. We pull the last few "Seller:" lines from the stored transcript.
  if (lastCall && lastCall.transcript) {
    const sellerLines = String(lastCall.transcript)
      .split('\n')
      .filter(l => /^Seller:/i.test(l.trim()))
      .map(l => l.replace(/^Seller:\s*/i, '').trim())
      .filter(Boolean);
    const keyQuotes = sellerLines.slice(-3); // their last few real sentences
    if (keyQuotes.length) {
      lines.push('');
      lines.push('LAST TIME THIS SELLER SAID (their exact words - reference these naturally):');
      keyQuotes.forEach(q => lines.push(`- "${q.slice(0, 180)}"`));
      if (lastCall.ai_summary) {
        lines.push(`Where it left off: ${String(lastCall.ai_summary).slice(0, 220)}`);
      }
      lines.push('Do NOT make them repeat themselves - pick up where you left off and build on it.');
    }
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

  // Rule 3 - what's ACTUALLY closing in this state (real terminal outcomes).
  if (stateLearning) {
    lines.push('');
    lines.push(`WHAT'S ACTUALLY CLOSING IN ${stateLearning.state || 'THIS STATE'} (from ${stateLearning.decided} real outcomes):`);
    lines.push(`- ${stateLearning.win_rate}% of decided deals here have closed (${stateLearning.won}/${stateLearning.decided})`);
    if (stateLearning.avg_days_to_close != null) {
      lines.push(`- Deals that close here average ${stateLearning.avg_days_to_close} days start-to-close`);
    }
    if (stateLearning.win_rate >= 50) {
      lines.push('- This is a strong market for us - push with confidence, this is a winnable deal.');
    } else {
      lines.push('- Tougher market - qualify hard, lead with value, do not over-chase a weak fit.');
    }
  }

  // What to watch for
  if (topObjCategory) {
    const objGuide = {
      price:  'The #1 objection in this market is price. Lead with value: "You pay no agent fees, no repairs, fast close - that has real value."',
      trust:  'Trust is the #1 objection here. Build credibility first - mention references, past closings, your process.',
      timing: 'Sellers here often need more time. Plant a seed: "I\'m not here to rush you. Can I follow up in a week?"',
      agent:  'Some sellers have agents. Confirm early: "Are you working with anyone?" If yes: "No problem - your agent keeps full commission."',
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
  lines.push('Use this intelligence. It represents real seller interactions - patterns that work in the real world.');

  return lines.join('\n');
}

// ─── READ: Compact seller memory for the SMS brain (A - unified memory) ──────
// The voice brain already builds a rich profile (trust, personality, dominant
// objection, what they respond to) in seller_profiles. The SMS brain used to
// score/continue blind to all of it. This pulls that SAME row so a text reply is
// judged WITH the call history behind it. Read-only, single row, non-blocking:
// any failure returns null and the SMS path behaves exactly as it did before.
async function getSellerContextForSMS(leadId) {
  if (!supabase || !leadId) return null;
  try {
    const { data } = await supabase
      .from('seller_profiles')
      .select('trust_level, personality_type, dominant_objection, total_touches, last_positive_signal, responded_to_empathy, responded_to_data, responded_to_urgency')
      .eq('lead_id', leadId)
      .single();
    return data || null;
  } catch (e) {
    return null; // no profile yet (first touch) - not an error
  }
}

// Format the seller profile into a short prompt block the SMS LLM can use. Kept
// tight on purpose - GPT-4o-mini scoring/continuation runs on a small token
// budget. Returns '' when there is no prior history so the prompt is unchanged.
function buildSMSContextBlock(sellerContext) {
  if (!sellerContext || !(sellerContext.total_touches > 0)) return '';
  const lines = ['', 'WHAT WE ALREADY KNOW ABOUT THIS SELLER (from prior calls/texts):'];
  lines.push(`- Contacted ${sellerContext.total_touches} time(s) before; trust ${sellerContext.trust_level || 0}/100`);
  if (sellerContext.personality_type)   lines.push(`- Personality: ${sellerContext.personality_type}`);
  if (sellerContext.dominant_objection) lines.push(`- Their usual objection: ${sellerContext.dominant_objection}`);
  if (sellerContext.responded_to_empathy) lines.push('- Responds to empathy - lead with understanding.');
  if (sellerContext.responded_to_data)    lines.push('- Responds to data - give concrete numbers.');
  if (sellerContext.responded_to_urgency) lines.push('- Responds to urgency - a time reason moves them.');
  if (sellerContext.last_positive_signal) lines.push(`- Last positive signal: "${String(sellerContext.last_positive_signal).slice(0, 140)}"`);
  return lines.join('\n');
}

// ─── C - BUYER-SIDE BRAIN ────────────────────────────────────────────────────
// The seller brain (above) remembers each seller. The buyer brain remembers each
// BUYER. `buyers` holds their static buy-box; buyer_deal_history holds how every
// past deal landed with them. This reads both and derives the buyer's real
// pattern so the AI pitches them like a wholesaler who knows their track record.
// Read-only, single buyer, non-blocking: any failure returns null and the buyer
// call behaves exactly as it did before (deal-numbers-only pitch).
async function getBuyerIntelligence(buyerId) {
  if (!supabase || !buyerId) return null;
  try {
    const [buyerRes, histRes] = await Promise.allSettled([
      supabase.from('buyers')
        .select('name, buyer_type, buy_box_states, buy_box_types, max_price, repair_tolerance, notes')
        .eq('id', buyerId)
        .single(),
      supabase.from('buyer_deal_history')
        .select('offered_price, arv, property_type, outcome, reason, created_at')
        .eq('buyer_id', buyerId)
        .order('created_at', { ascending: false })
        .limit(25),
    ]);

    const buyer   = buyerRes.value?.data || null;
    const history = histRes.value?.data || [];
    if (!buyer) return null;

    // Derive the pattern. "won" = they bought; "passed" = explicit no on a deal.
    const won    = history.filter(h => h.outcome === 'won');
    const passed = history.filter(h => h.outcome === 'passed' || h.outcome === 'lost');

    // Typical % of ARV this buyer actually buys at (from won deals with both nums).
    const pricedWins = won.filter(h => h.offered_price > 0 && h.arv > 0);
    const avgPctOfArv = pricedWins.length
      ? Math.round(pricedWins.reduce((s, h) => s + (h.offered_price / h.arv) * 100, 0) / pricedWins.length)
      : null;

    // Most common stated pass reason (helps pre-empt their usual objection).
    const passReasons = passed.map(h => (h.reason || '').trim().toLowerCase()).filter(Boolean)
      .reduce((acc, r) => { acc[r] = (acc[r] || 0) + 1; return acc; }, {});
    const topPassReason = Object.entries(passReasons).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    return {
      buyer,
      dealsWon:       won.length,
      dealsPassed:    passed.length,
      totalTouches:   history.length,
      avgPctOfArv,
      topPassReason,
      lastOutcome:    history[0]?.outcome || null,
    };
  } catch (e) {
    return null; // no history / table not yet present - not an error
  }
}

// WRITE: record one buyer × deal outcome. Best-effort, idempotent on (buyer,deal)
// via the partial unique index - re-touching a deal UPSERTs the outcome instead of
// stacking rows. Never throws: a logging miss must never break a blast or assign.
async function recordBuyerDealOutcome({ buyerId, dealId, userId, outcome, offeredPrice, arv, propertyType, propertyState, reason }) {
  if (!supabase || !buyerId || !userId || !outcome) return;
  try {
    await supabase.from('buyer_deal_history').upsert({
      buyer_id:       buyerId,
      deal_id:        dealId || null,
      user_id:        userId,
      outcome,
      offered_price:  offeredPrice ?? null,
      arv:            arv ?? null,
      property_type:  propertyType || null,
      property_state: propertyState || null,
      reason:         reason || null,
    }, { onConflict: 'buyer_id,deal_id' });
  } catch (e) {
    console.warn('[DataMot] buyer_deal_history write failed:', e.message);
  }
}

// Format buyer intelligence into a prompt block for the buyer-call system prompt.
// Returns '' when there is no buyer/history so the pitch is byte-for-byte unchanged.
function buildBuyerIntelBlock(intel) {
  if (!intel || !intel.buyer) return '';
  const b = intel.buyer;
  const lines = ['', "THIS BUYER'S TRACK RECORD (use it - pitch them like you know them):"];

  // Static buy-box (always known if the buyer row loaded).
  if (b.buy_box_types?.length)  lines.push(`- Buys: ${b.buy_box_types.join(', ')}`);
  if (b.buy_box_states?.length) lines.push(`- Markets: ${b.buy_box_states.join(', ')}`);
  if (b.max_price)              lines.push(`- Max purchase price: $${Number(b.max_price).toLocaleString()}`);
  if (b.repair_tolerance && b.repair_tolerance !== 'any') lines.push(`- Rehab appetite: ${b.repair_tolerance}`);
  if (b.notes)                  lines.push(`- Notes on file: ${String(b.notes).slice(0, 160)}`);

  // Earned history (only if we've touched them before).
  if (intel.totalTouches > 0) {
    lines.push(`- History: bought ${intel.dealsWon}, passed ${intel.dealsPassed} of ${intel.totalTouches} deals shown`);
    if (intel.avgPctOfArv) lines.push(`- Typically buys around ${intel.avgPctOfArv}% of ARV - anchor the price there, not higher`);
    if (intel.topPassReason) lines.push(`- Usual reason they pass: "${intel.topPassReason}" - get ahead of it before they raise it`);
    if (intel.lastOutcome === 'passed') lines.push('- They passed last time - acknowledge it: "I know the last one wasn\'t a fit - this one\'s different because…"');
    if (intel.lastOutcome === 'won')    lines.push('- They bought last time - warm relationship, you can be direct: "Got another one like the last that worked for you."');
  }

  return lines.length > 2 ? lines.join('\n') : '';
}

// ─── D - DEAL-STATE AWARENESS ────────────────────────────────────────────────
// The seller/buyer brains remember PEOPLE. This one remembers the DEAL itself.
// Until now the AI dialed every lead like a cold first-touch even when a deal
// already existed - re-pitching a seller who'd already given a verbal yes, which
// reads as broken to an experienced investor. This pulls the lead's most recent
// deal so the AI knows where things actually stand (already agreed? under
// contract? closing scheduled?). Read-only, single row, non-blocking: any
// failure / no deal returns null and the call behaves exactly as it did before.
async function getDealContext(leadId) {
  if (!supabase || !leadId) return null;
  try {
    const { data } = await supabase
      .from('deals')
      .select('status, offer_price, seller_agreed_price, arv, assignment_fee, closing_date, created_at')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data || null;
  } catch (e) {
    return null; // no deal yet (true cold lead) - not an error
  }
}

// Format the deal into a short prompt block so the AI opens from the RIGHT place
// in the pipeline instead of re-pitching from scratch. Returns '' when there is
// no deal so a genuine first-touch lead gets the byte-for-byte original prompt.
function buildDealContextBlock(deal) {
  if (!deal) return '';
  const lines = ['', 'WHERE THIS DEAL ALREADY STANDS (do NOT re-pitch from scratch):'];

  const status = String(deal.status || '').toLowerCase();
  const STATUS_GUIDANCE = {
    under_contract: 'You already have a verbal/contract agreement - this call is to confirm & advance to closing, NOT to re-negotiate price.',
    closing:        'Deal is heading to close - call is logistics (title, dates, signatures), not a fresh pitch.',
    won:            'Deal already closed - treat as a relationship/referral touch, not a new offer.',
    lead:           'Appointment/early-stage deal exists - pick up where the last conversation left off.',
    new:            'A deal record exists but is early - continue the existing thread, don\'t cold-open.',
  };
  if (deal.status) lines.push(`- Stage: ${deal.status}${STATUS_GUIDANCE[status] ? ' - ' + STATUS_GUIDANCE[status] : ''}`);
  if (deal.seller_agreed_price) lines.push(`- Seller already agreed to: $${Number(deal.seller_agreed_price).toLocaleString()} - anchor here, do not lower it on them.`);
  else if (deal.offer_price)    lines.push(`- Offer on the table: $${Number(deal.offer_price).toLocaleString()}.`);
  if (deal.closing_date)        lines.push(`- Closing date: ${new Date(deal.closing_date).toDateString()}.`);
  if (deal.arv)                 lines.push(`- ARV on file: $${Number(deal.arv).toLocaleString()}.`);

  return lines.length > 2 ? lines.join('\n') : '';
}

// ─── E - OPERATOR TRACK-RECORD ADAPTATION ────────────────────────────────────
// Everything above remembers the MARKET (sellers, buyers, tags, the deal). This
// one remembers the OPERATOR running Veori - and makes the AI call the way THIS
// operator's best calls already go. Until now every operator's AI behaved
// identically; a closer with a 30% appointment rate and a brand-new user got the
// exact same prompt. This reads the operator's OWN history - their real win rate
// from `calls`, the seller personality they convert best, and their typical
// agreed-price discount + assignment fee from `deals` - and feeds it back so the
// AI leans into what's working for them. ONLY verified columns are read: `calls`
// (user_id, outcome, seller_personality, created_at) and `deals` (user_id,
// status, seller_agreed_price, arv, assignment_fee). Read-only, two scoped
// reads, non-blocking: any failure / a brand-new operator returns null and the
// call behaves byte-for-byte as it did before. Needs a real sample before it
// says anything (MIN_CALLS) so a single lucky/unlucky call never skews the AI.
const OPERATOR_MIN_CALLS = 10; // don't characterize an operator on thin data
const OPERATOR_WIN_OUTCOMES = ['verbal_yes', 'appointment', 'offer_made'];

async function getOperatorTrackRecord(userId) {
  if (!supabase || !userId) return null;
  try {
    // Last 500 of the operator's own calls + deals - enough to see a pattern,
    // bounded so a heavy user's read stays cheap.
    const [callsRes, dealsRes] = await Promise.allSettled([
      supabase
        .from('calls')
        .select('outcome, seller_personality, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('deals')
        .select('status, seller_agreed_price, arv, assignment_fee')
        .eq('user_id', userId)
        .limit(500),
    ]);

    const calls = callsRes.status === 'fulfilled' ? (callsRes.value.data || []) : [];
    const deals = dealsRes.status === 'fulfilled' ? (dealsRes.value.data || []) : [];

    const decided = calls.filter(c => c.outcome); // ignore in-flight/unlabeled rows
    if (decided.length < OPERATOR_MIN_CALLS) return null; // too thin to characterize

    // Win rate = share of decided calls that hit a motivated outcome.
    const wins = decided.filter(c => OPERATOR_WIN_OUTCOMES.includes(c.outcome));
    const winRate = Math.round((wins.length / decided.length) * 100);

    // Which seller personality this operator converts best (only counts wins that
    // actually recorded a personality). Needs ≥2 wins of a type to be a "pattern".
    const personalityWins = {};
    for (const w of wins) {
      const p = w.seller_personality;
      if (!p) continue;
      personalityWins[p] = (personalityWins[p] || 0) + 1;
    }
    let bestPersonality = null;
    let bestPersonalityCount = 0;
    for (const [p, n] of Object.entries(personalityWins)) {
      if (n > bestPersonalityCount) { bestPersonality = p; bestPersonalityCount = n; }
    }
    if (bestPersonalityCount < 2) bestPersonality = null;

    // Deal economics: typical agreed-price-as-%-of-ARV and average assignment fee,
    // from deals that carry the relevant numbers. Null when no deal has them yet.
    const pricedDeals = deals.filter(d => d.seller_agreed_price > 0 && d.arv > 0);
    let avgDiscountPct = null;
    if (pricedDeals.length) {
      const ratios = pricedDeals.map(d => d.seller_agreed_price / d.arv);
      const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
      avgDiscountPct = Math.round((1 - avgRatio) * 100); // e.g. agreed 70% of ARV → 30
    }

    const feeDeals = deals.filter(d => d.assignment_fee > 0);
    let avgAssignmentFee = null;
    if (feeDeals.length) {
      avgAssignmentFee = Math.round(
        feeDeals.reduce((a, d) => a + Number(d.assignment_fee), 0) / feeDeals.length
      );
    }

    return {
      sampleSize: decided.length,
      winRate,
      bestPersonality,
      bestPersonalityCount,
      avgDiscountPct,
      avgAssignmentFee,
    };
  } catch (e) {
    return null; // brand-new operator / read failure - AI behaves as before
  }
}

// Format the operator's track record into a short prompt block. Returns '' when
// there's no usable record so a new operator's AI runs the byte-for-byte original
// prompt. Kept tight - this rides on top of the full call prompt.
function buildOperatorTrackRecordBlock(track) {
  if (!track) return '';
  const lines = ['', "HOW THIS OPERATOR'S BEST CALLS GO (lean into what's working for them):"];
  lines.push(`- Their AI converts ${track.winRate}% of calls to a yes/appointment/offer (over ${track.sampleSize} calls) - match that energy.`);
  if (track.bestPersonality) {
    lines.push(`- They close "${track.bestPersonality}" sellers best - when you read this personality, press toward the close.`);
  }
  if (track.avgDiscountPct != null) {
    lines.push(`- Their deals typically land around ${track.avgDiscountPct}% below ARV - that's a realistic anchor for this operator's market.`);
  }
  if (track.avgAssignmentFee != null) {
    lines.push(`- Their typical spread is about $${Number(track.avgAssignmentFee).toLocaleString()} - leave room for it; don't over-offer.`);
  }
  return lines.length > 2 ? lines.join('\n') : '';
}

module.exports = {
  recordCallIntelligence,
  recordWinningPlaybook,
  getCallIntelligence,
  buildAccumulatedIntelligenceBlock,
  getSellerContextForSMS,
  buildSMSContextBlock,
  getBuyerIntelligence,
  buildBuyerIntelBlock,
  recordBuyerDealOutcome,
  getDealContext,
  buildDealContextBlock,
  getOperatorTrackRecord,
  buildOperatorTrackRecordBlock,
};
