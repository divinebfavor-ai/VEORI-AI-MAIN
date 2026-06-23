const supabase = require('../config/supabase');

// ─── Primary tag detection ────────────────────────────────────────────────────
function detectPrimaryTag(lead) {
  // pre_foreclosure: has NOD, lis pendens, or is behind on payments
  if (
    lead.has_lis_pendens ||
    lead.foreclosure_stage ||
    lead.is_behind_on_payments ||
    (lead.months_behind && lead.months_behind > 0) ||
    (lead.motivation_indicators || []).some(m =>
      /foreclos|nod|notice of default|lis pendens/i.test(m)
    ) ||
    (lead.source || '').toLowerCase().includes('foreclosure') ||
    (lead.sub_source || '').toLowerCase().includes('nod')
  ) return { tag: 'pre_foreclosure', confidence: 90 };

  // probate: deed or source signals probate/estate
  if (
    lead.probate_case ||
    (lead.deed_type || '').toLowerCase().includes('probate') ||
    (lead.source || '').toLowerCase().includes('probate') ||
    (lead.motivation_indicators || []).some(m => /probate|estate/i.test(m))
  ) return { tag: 'probate', confidence: 88 };

  // inherited: deed transfer via inheritance
  if (
    (lead.deed_type || '').toLowerCase().includes('inherit') ||
    (lead.source || '').toLowerCase().includes('inherit') ||
    (lead.motivation_indicators || []).some(m => /inherit|heir/i.test(m))
  ) return { tag: 'inherited', confidence: 85 };

  // tax_delinquent: has unpaid taxes
  if (
    lead.tax_delinquent ||
    (lead.tax_amount_owed && lead.tax_amount_owed > 0) ||
    (lead.motivation_indicators || []).some(m => /tax|delinquen/i.test(m)) ||
    (lead.source || '').toLowerCase().includes('tax')
  ) return { tag: 'tax_delinquent', confidence: 87 };

  // free_and_clear: no mortgage lien
  if (
    (!lead.mortgage_balance || lead.mortgage_balance === 0) &&
    !lead.has_liens &&
    (lead.estimated_equity_percent || 0) >= 90
  ) return { tag: 'free_and_clear', confidence: 82 };

  // fsbo: listed by owner
  if (
    (lead.source || '').toLowerCase().includes('fsbo') ||
    (lead.sub_source || '').toLowerCase().includes('by owner') ||
    (lead.motivation_indicators || []).some(m => /fsbo|for sale by owner/i.test(m))
  ) return { tag: 'fsbo', confidence: 85 };

  // vacant: no occupancy
  if (
    lead.is_vacant ||
    (lead.motivation_indicators || []).some(m => /vacant|empty|unoccupied/i.test(m)) ||
    (lead.source || '').toLowerCase().includes('vacant')
  ) return { tag: 'vacant', confidence: 83 };

  // absentee_owner: mailing address differs from property address
  if (
    lead.is_absentee_owner ||
    (lead.mailing_address && lead.property_address &&
      lead.mailing_address.trim().toLowerCase() !== lead.property_address.trim().toLowerCase()) ||
    (lead.source || '').toLowerCase().includes('absentee')
  ) return { tag: 'absentee_owner', confidence: 80 };

  // cash_buyer: buyer record with cash purchases
  if (
    (lead.source || '').toLowerCase().includes('cash buyer') ||
    lead.buyer_type === 'cash'
  ) return { tag: 'cash_buyer', confidence: 80 };

  // Fallback based on motivation indicators
  if ((lead.motivation_indicators || []).length > 0) {
    return { tag: 'absentee_owner', confidence: 50 };
  }

  return { tag: 'absentee_owner', confidence: 40 };
}

// ─── Secondary tags detection ─────────────────────────────────────────────────
function detectSecondaryTags(lead) {
  const tags = [];

  // out_of_state_owner
  if (
    lead.mailing_state &&
    lead.property_state &&
    lead.mailing_state.trim().toUpperCase() !== lead.property_state.trim().toUpperCase()
  ) tags.push('out_of_state_owner');

  // high_equity (60%+)
  if ((lead.estimated_equity_percent || 0) >= 60) tags.push('high_equity');

  // long_term_owner (10+ years)
  if ((lead.years_owned || 0) >= 10) tags.push('long_term_owner');

  // multiple_properties
  if ((lead.owner_property_count || 1) > 1) tags.push('multiple_properties');

  // delinquent_taxes
  if (lead.tax_delinquent || (lead.tax_amount_owed && lead.tax_amount_owed > 0)) {
    tags.push('delinquent_taxes');
  }

  // recent_inheritance
  if (
    (lead.deed_type || '').toLowerCase().includes('inherit') ||
    (lead.motivation_indicators || []).some(m => /inherit|heir|recently.*passed|estate/i.test(m))
  ) tags.push('recent_inheritance');

  // needs_repair
  if (
    (lead.motivation_indicators || []).some(m => /repair|rehab|fix|distress|condition/i.test(m)) ||
    (lead.notes || '').toLowerCase().includes('repair') ||
    (lead.notes || '').toLowerCase().includes('needs work')
  ) tags.push('needs_repair');

  // landlord
  if (
    (lead.is_absentee_owner && !lead.is_vacant) ||
    (lead.motivation_indicators || []).some(m => /landlord|tenant|rented|rental/i.test(m)) ||
    (lead.notes || '').toLowerCase().includes('tenant') ||
    (lead.notes || '').toLowerCase().includes('renter')
  ) tags.push('landlord');

  return [...new Set(tags)];
}

// ─── Strategy detection ───────────────────────────────────────────────────────
// Which acquisition strategy fits this lead best. ADDITIVE + independent of the
// tag pipeline — it reads the same signals but answers a different question: not
// "why is this seller motivated" (tag) but "how should we buy this house"
// (strategy). Pure, never throws, returns { strategy, confidence }.
//
//   subject_to     — there's an existing loan with payments to take over. Strong
//                    when equity is thin (so a cash discount can't clear the loan)
//                    and/or the seller is behind (arrears) — take over payments.
//   seller_finance — owner can carry the note: free & clear / very high equity,
//                    landlord/tired-owner signals, not in distress.
//   lease_option   — rental / landlord with modest equity, not distressed — control
//                    now, buy later.
//   cash           — DEFAULT. Distressed / vacant / needs-repair / strong equity
//                    discount. This is the existing wholesale path and the fallback
//                    for everything the other branches don't claim.
function detectStrategy(lead) {
  if (!lead || typeof lead !== 'object') return { strategy: 'cash', confidence: 40 };

  const equity   = Number(lead.estimated_equity_percent || 0);
  const mortgage = Number(lead.mortgage_balance || 0);
  const arrears  = Number(lead.arrears_amount || 0);
  const rate     = lead.interest_rate != null ? Number(lead.interest_rate) : null;
  const loanType = (lead.loan_type || '').toLowerCase();
  const tag      = lead.primary_tag || '';
  const secondary = lead.secondary_tags || [];
  const indicators = lead.motivation_indicators || [];

  const isLandlord  = secondary.includes('landlord') ||
    indicators.some(m => /landlord|tenant|rented|rental/i.test(m));
  const isDistressed = ['pre_foreclosure', 'tax_delinquent', 'vacant'].includes(tag) ||
    lead.is_vacant || secondary.includes('needs_repair') || arrears > 0;
  const freeAndClear = loanType === 'none' ||
    (mortgage === 0 && (!lead.has_liens) && equity >= 90) ||
    tag === 'free_and_clear';

  // Subject-To: an existing loan to assume + thin equity (can't be cleared by a
  // cash discount) and/or seller behind. A low locked-in rate strengthens it.
  if (mortgage > 0 && equity > 0 && equity < 35) {
    let conf = 78;
    if (arrears > 0) conf += 8;                 // behind → reinstate + take over
    if (rate != null && rate <= 5) conf += 6;   // cheap money worth keeping
    if (tag === 'pre_foreclosure') conf += 4;
    return { strategy: 'subject_to', confidence: Math.min(conf, 95) };
  }

  // Seller-finance: owner owns it (or nearly) and isn't in distress → they can
  // carry paper for monthly income + tax spread.
  if (freeAndClear && !isDistressed) {
    let conf = 74;
    if (isLandlord) conf += 8;                  // tired landlord wants passive income
    if (secondary.includes('long_term_owner')) conf += 4;
    return { strategy: 'seller_finance', confidence: Math.min(conf, 92) };
  }

  // Lease-option: landlord/rental with moderate equity, not distressed → control
  // now, exercise the buy later.
  if (isLandlord && !isDistressed && equity >= 30 && equity < 90) {
    return { strategy: 'lease_option', confidence: 70 };
  }

  // Cash / wholesale — the default and the explicit fit for distress + discount.
  let conf = 60;
  if (isDistressed) conf += 15;
  if (equity >= 50) conf += 5;
  return { strategy: 'cash', confidence: Math.min(conf, 90) };
}

// ─── Build tag reason string ──────────────────────────────────────────────────
function buildTagReason(lead, primaryTag, secondaryTags) {
  const reasons = [];

  const tagTriggers = {
    pre_foreclosure:  'Has lis pendens, NOD, or behind on payments',
    tax_delinquent:   'Tax delinquency detected on record',
    absentee_owner:   'Owner mailing address differs from property address',
    inherited:        'Deed transfer indicates inheritance',
    probate:          'Probate case or estate source detected',
    free_and_clear:   'No mortgage lien, high equity (90%+)',
    fsbo:             'Listed for sale by owner',
    vacant:           'Property shows no occupancy signals',
    cash_buyer:       'Multiple cash purchase history detected',
  };

  reasons.push(tagTriggers[primaryTag] || 'Primary tag assigned by scoring');
  if (secondaryTags.length) reasons.push(`Secondary: ${secondaryTags.join(', ')}`);

  return reasons.join(' | ');
}

// ─── Tag a single lead ────────────────────────────────────────────────────────
async function tagLead(leadId) {
  try {
    const { data: lead, error } = await supabase
      .from('leads')
      .select('*')
      .eq('id', leadId)
      .single();

    if (error || !lead) {
      console.warn('[Tag] Lead not found:', leadId);
      return null;
    }

    const { tag: primaryTag, confidence } = detectPrimaryTag(lead);
    const secondaryTags = detectSecondaryTags(lead);
    const tagReason = buildTagReason(lead, primaryTag, secondaryTags);
    // Strategy reads the freshly-computed tags too — pass them on the lead so the
    // detector sees the same verdict we're about to write.
    const { strategy, confidence: strategyConfidence } = detectStrategy({
      ...lead, primary_tag: primaryTag, secondary_tags: secondaryTags,
    });

    const { data: updated, error: updateError } = await supabase
      .from('leads')
      .update({
        primary_tag:         primaryTag,
        secondary_tags:      secondaryTags,
        tag_confidence:      confidence,
        tag_reason:          tagReason,
        detected_strategy:   strategy,
        strategy_confidence: strategyConfidence,
        tagged_at:           new Date().toISOString(),
      })
      .eq('id', leadId)
      .select('id, first_name, last_name, primary_tag, secondary_tags, tag_confidence, detected_strategy, strategy_confidence')
      .single();

    if (updateError) throw updateError;

    console.log(`[Tag] ${lead.first_name} ${lead.last_name} → ${primaryTag} (${confidence}%) | ${secondaryTags.join(', ') || 'no secondary'} | strategy: ${strategy} (${strategyConfidence}%)`);
    return updated;

  } catch (err) {
    console.error('[Tag] Error tagging lead:', err.message);
    return null;
  }
}

// ─── Tag multiple leads (bulk import) ────────────────────────────────────────
async function tagLeadsBulk(leadIds) {
  const results = [];
  for (const id of leadIds) {
    const result = await tagLead(id);
    if (result) results.push(result);
    await new Promise(r => setTimeout(r, 50)); // avoid Supabase rate limit
  }
  console.log(`[Tag] Bulk tagged ${results.length}/${leadIds.length} leads`);
  return results;
}

// ─── Opening SMS by tag ───────────────────────────────────────────────────────
function getOpeningSMS(lead) {
  const first = lead.first_name || 'there';
  const addr  = lead.property_address || 'your property';
  const tag   = lead.primary_tag;

  const templates = {
    pre_foreclosure: `Hi ${first}, I came across your property at ${addr}. We help homeowners find a clean, fast exit when things get complicated. Would you be open to a quick conversation? No pressure at all.`,
    tax_delinquent:  `Hi ${first}, I saw you own a property at ${addr}. We make selling simple — no fees, no hassle, cash offer. Would you be interested in hearing what we can offer?`,
    absentee_owner:  `Hi ${first}, I'm reaching out about your property at ${addr}. We buy from owners looking to simplify — cash, fast close, no repairs needed. Is that something you'd consider?`,
    inherited:       `Hi ${first}, I hope everything is going well with you. I wanted to reach out about the property at ${addr}. We work with families to make inherited properties easy to handle. No rush — just wanted to connect.`,
    probate:         `Hi ${first}, I wanted to reach out about the property at ${addr}. We specialize in making inherited and estate properties simple to sell — cash, any condition. Happy to answer any questions at your pace.`,
    free_and_clear:  `Hi ${first}, I'm a local investor interested in ${addr}. If you're ever open to a cash offer — clean, fast close — I'd love to make you one. What would make it worth it for you?`,
    fsbo:            `Hi ${first}, I saw you have ${addr} listed for sale. We can often close faster and with less hassle than a traditional sale — no agent fees. Would you be open to hearing a cash offer?`,
    vacant:          `Hi ${first}, I noticed your property at ${addr} has been vacant. A vacant property can be a real burden. We buy as-is — any condition, fast close. Would you like an offer?`,
    cash_buyer:      `Hi ${first}, I have a deal that matches your buy box. Let me know when you have 2 minutes — I'll send over the numbers.`,
  };

  return templates[tag] || templates.absentee_owner;
}

module.exports = {
  tagLead,
  tagLeadsBulk,
  detectPrimaryTag,
  detectSecondaryTags,
  detectStrategy,
  getOpeningSMS,
};
