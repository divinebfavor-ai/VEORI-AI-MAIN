// ─── Title Company Automation Service ────────────────────────────────────────
// Auto-assigns, auto-contacts, and follows up with title companies until close
const supabase  = require('../config/supabase');
const { v4: uuidv4 } = require('uuid');
const { sendEmail } = require('./emailService');

// ─── 1. Auto-assign best title company for a deal's state ─────────────────────
async function autoAssignTitleCompany(dealId, userId) {
  try {
    const { data: deal } = await supabase.from('deals').select('*').eq('id', dealId).single();
    if (!deal || deal.title_company_id) return null; // already assigned

    const state = deal.property_state?.trim().toUpperCase();
    if (!state) return null;

    // Find title companies that handle this state, prefer is_default
    const { data: companies } = await supabase
      .from('title_companies')
      .select('*')
      .eq('user_id', userId)
      .order('is_default', { ascending: false });

    if (!companies?.length) return null;

    // Best match: handles this state
    const stateMatch = companies.find(c =>
      (c.preferred_states || []).some(s => s.trim().toUpperCase() === state)
    );
    const assigned = stateMatch || companies.find(c => c.is_default) || companies[0];

    await supabase.from('deals').update({
      title_company_id: assigned.id,
      updated_at: new Date().toISOString(),
    }).eq('id', dealId);

    console.log(`[Title] Auto-assigned "${assigned.name}" to deal ${dealId} (state: ${state})`);
    return assigned;
  } catch (e) {
    console.error('[Title] Auto-assign failed:', e.message);
    return null;
  }
}

// ─── 2. Send deal package to title company ────────────────────────────────────
async function sendDealPackageToTitle(dealId, userId) {
  try {
    const { data: deal } = await supabase
      .from('deals')
      .select('*, leads(*)')
      .eq('id', dealId)
      .single();
    if (!deal) return;

    const titleCoId = deal.title_company_id;
    if (!titleCoId) {
      console.warn('[Title] No title company assigned to deal', dealId);
      return;
    }

    const { data: titleCo } = await supabase.from('title_companies').select('*').eq('id', titleCoId).single();
    if (!titleCo?.email) {
      console.warn('[Title] Title company has no email - skipping send');
      return;
    }

    const { data: operator } = await supabase.from('users')
      .select('company_name, ai_caller_name, business_email, business_phone')
      .eq('id', userId).single();

    const sellerName = deal.leads
      ? `${deal.leads.first_name || ''} ${deal.leads.last_name || ''}`.trim()
      : deal.seller_name || 'Seller';
    const closingDate = deal.closing_date
      ? new Date(deal.closing_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : 'TBD';

    const emailBody = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
  <div style="background: #0D0D0F; padding: 24px; border-radius: 8px 8px 0 0;">
    <h1 style="color: #00C37A; font-size: 20px; margin: 0;">New Deal Package - Action Required</h1>
    <p style="color: #aaa; font-size: 13px; margin: 6px 0 0;">${operator?.company_name || 'Veori AI'}</p>
  </div>

  <div style="background: #f9f9f9; padding: 24px; border: 1px solid #e0e0e0; border-top: none;">
    <p style="font-size: 14px;">Hi ${titleCo.contact_name || 'Team'},</p>
    <p style="font-size: 14px;">We have a new deal ready for title. Please see the details below and confirm receipt.</p>

    <div style="background: #fff; border: 1px solid #e0e0e0; border-radius: 6px; padding: 20px; margin: 20px 0;">
      <h2 style="font-size: 15px; margin: 0 0 14px; color: #0D0D0F;">Deal Summary</h2>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <tr><td style="padding: 6px 0; color: #666; width: 40%;">Property</td><td style="color: #0D0D0F; font-weight: 600;">${deal.property_address}${deal.property_city ? ', ' + deal.property_city : ''}${deal.property_state ? ', ' + deal.property_state : ''}</td></tr>
        <tr><td style="padding: 6px 0; color: #666;">Seller</td><td style="color: #0D0D0F;">${sellerName}</td></tr>
        ${deal.seller_phone ? `<tr><td style="padding: 6px 0; color: #666;">Seller Phone</td><td style="color: #0D0D0F;">${deal.seller_phone}</td></tr>` : ''}
        ${deal.seller_email ? `<tr><td style="padding: 6px 0; color: #666;">Seller Email</td><td style="color: #0D0D0F;">${deal.seller_email}</td></tr>` : ''}
        <tr><td style="padding: 6px 0; color: #666;">Purchase Price</td><td style="color: #0D0D0F; font-weight: 600;">${deal.seller_agreed_price ? '$' + Number(deal.seller_agreed_price).toLocaleString() : deal.offer_price ? '$' + Number(deal.offer_price).toLocaleString() : 'TBD'}</td></tr>
        <tr><td style="padding: 6px 0; color: #666;">Target Close</td><td style="color: #0D0D0F;">${closingDate}</td></tr>
        ${deal.arv ? `<tr><td style="padding: 6px 0; color: #666;">ARV</td><td style="color: #0D0D0F;">$${Number(deal.arv).toLocaleString()}</td></tr>` : ''}
      </table>
    </div>

    <p style="font-size: 14px;">Please confirm receipt of this deal and advise on next steps. The signed purchase agreement will follow shortly if not already attached.</p>

    <p style="font-size: 14px;">If you have any questions, contact us directly:</p>
    <p style="font-size: 13px; color: #555;">
      ${operator?.ai_caller_name || 'Alex'} | ${operator?.company_name || 'Veori AI'}<br>
      ${operator?.business_phone || ''}<br>
      ${operator?.business_email || ''}
    </p>
  </div>

  <div style="background: #0D0D0F; padding: 14px 24px; border-radius: 0 0 8px 8px; text-align: center;">
    <p style="color: #555; font-size: 11px; margin: 0;">Powered by Veori AI - Autonomous Real Estate</p>
  </div>
</div>`;

    await sendEmail({
      userId,
      dealId,
      to: titleCo.email,
      subject: `New Deal Package - ${deal.property_address}${deal.property_state ? ', ' + deal.property_state : ''}`,
      body: emailBody,
      emailType: 'title_package',
    });

    // Log to title_logs
    const now = new Date().toISOString();
    const { data: existingLog } = await supabase.from('title_logs')
      .select('id').eq('deal_id', dealId).maybeSingle();

    const logPayload = {
      user_id:             userId,
      deal_id:             dealId,
      title_company_id:    titleCo.id,
      title_contact_name:  titleCo.contact_name || null,
      title_contact_phone: titleCo.phone || null,
      title_contact_email: titleCo.email,
      sent_to_title_at:    now,
      status:              'documents_sent',
      closing_date:        deal.closing_date || null,
      updated_at:          now,
    };

    if (existingLog?.id) {
      await supabase.from('title_logs').update(logPayload).eq('id', existingLog.id);
    } else {
      await supabase.from('title_logs').insert({ id: uuidv4(), ...logPayload });
    }

    // Update deal status
    await supabase.from('deals').update({
      status: 'sent_to_title',
      updated_at: now,
    }).eq('id', dealId);

    // Log AI command
    await supabase.from('ai_command_log').insert({
      deal_id:      dealId,
      action_type:  'title_package_sent',
      message_sent: `Deal package emailed to ${titleCo.name} (${titleCo.email})`,
      outcome:      'success',
      operator_id:  userId,
    });

    console.log(`[Title] Deal package sent to ${titleCo.name} for deal ${dealId}`);
    return titleCo;
  } catch (e) {
    console.error('[Title] Send package failed:', e.message);
  }
}

// ─── 3. Schedule title follow-up sequence ─────────────────────────────────────
// Creates 4 follow-up tasks spaced out until closing date
async function scheduleTitleFollowUps(dealId, userId) {
  try {
    const { data: deal } = await supabase.from('deals').select('*, title_companies(*)').eq('id', dealId).single();
    if (!deal) return;

    const titleCo = deal.title_companies;
    const now = new Date();

    // Follow-up schedule: 2 days, 5 days, 10 days, 3 days before close
    const intervals = [2, 5, 10];
    const tasks = intervals.map((days, i) => {
      const followUpAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
      return {
        id:               uuidv4(),
        user_id:          userId,
        deal_id:          dealId,
        contact_type:     'title_company',
        follow_up_type:   i === 0 ? 'call' : 'email',
        next_follow_up_at: followUpAt.toISOString(),
        reason:           i === 0
          ? `Call ${titleCo?.name || 'title company'} to confirm receipt of deal package`
          : i === 1
          ? `Email ${titleCo?.name || 'title company'} - request title search update`
          : `Follow up with ${titleCo?.name || 'title company'} on closing timeline`,
        status:           'pending',
        created_at:       now.toISOString(),
      };
    });

    // Also add a final follow-up 3 days before closing date if known
    if (deal.closing_date) {
      const closeDate = new Date(deal.closing_date);
      const threeDaysBefore = new Date(closeDate.getTime() - 3 * 24 * 60 * 60 * 1000);
      if (threeDaysBefore > now) {
        tasks.push({
          id:               uuidv4(),
          user_id:          userId,
          deal_id:          dealId,
          contact_type:     'title_company',
          follow_up_type:   'call',
          next_follow_up_at: threeDaysBefore.toISOString(),
          reason:           `Final check-in with ${titleCo?.name || 'title company'} - 3 days before closing`,
          status:           'pending',
          created_at:       now.toISOString(),
        });
      }
    }

    await supabase.from('follow_ups').insert(tasks);

    await supabase.from('ai_command_log').insert({
      deal_id:      dealId,
      action_type:  'title_followups_scheduled',
      message_sent: `${tasks.length} title company follow-ups scheduled with ${titleCo?.name || 'title company'}`,
      outcome:      'success',
      operator_id:  userId,
    });

    console.log(`[Title] ${tasks.length} follow-ups scheduled for deal ${dealId}`);
    return tasks;
  } catch (e) {
    console.error('[Title] Follow-up schedule failed:', e.message);
  }
}

// ─── 4. Send follow-up email to title company ─────────────────────────────────
async function sendTitleFollowUpEmail(dealId, userId, followUpNumber = 1) {
  try {
    const { data: deal } = await supabase.from('deals')
      .select('*, title_companies(*)').eq('id', dealId).single();
    if (!deal?.title_companies?.email) return false;

    const titleCo = deal.title_companies;
    const subjects = [
      `Following Up - ${deal.property_address}`,
      `Title Search Status - ${deal.property_address}`,
      `Closing Update Needed - ${deal.property_address}`,
    ];
    const messages = [
      `Hi ${titleCo.contact_name || 'Team'},\n\nJust following up to confirm you received our deal package for ${deal.property_address}. Please let us know if you need anything additional to proceed.\n\nTarget close: ${deal.closing_date || 'TBD'}`,
      `Hi ${titleCo.contact_name || 'Team'},\n\nChecking in on the title search progress for ${deal.property_address}. Can you give us a status update? We want to make sure we stay on track for closing.`,
      `Hi ${titleCo.contact_name || 'Team'},\n\nWe're getting close to our target closing date for ${deal.property_address}. Please advise on any outstanding items we need to address before closing.`,
    ];

    const idx = Math.min(followUpNumber - 1, messages.length - 1);
    await sendEmail({
      userId,
      dealId,
      to: titleCo.email,
      subject: subjects[idx],
      body: messages[idx],
      emailType: 'title_followup',
    });

    await supabase.from('title_logs').update({
      last_follow_up_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('deal_id', dealId);

    console.log(`[Title] Follow-up #${followUpNumber} sent to ${titleCo.name}`);
    return true;
  } catch (e) {
    console.error('[Title] Follow-up email failed:', e.message);
    return false;
  }
}

// ─── 5. Due title follow-up sweep (Redis-INDEPENDENT) ─────────────────────────
// scheduleTitleFollowUps() inserts follow_ups rows (contact_type='title_company',
// status='pending') but nothing executed them - they sat pending forever. This
// sweep runs on a plain setInterval from index.js (same pattern as the callback
// sweep) and fires each due title touch as an EMAIL to the title company.
// 'call'-type rows also go out as email: the AI dialer only calls sellers, so an
// email touch is the automated equivalent (the reason text is preserved in the
// outcome for the operator's timeline).
//
// Double-send safety: each row is ATOMICALLY claimed (pending → processing,
// guarded by .eq('status','pending')) before sending, so overlapping ticks or
// multiple boxes never send the same follow-up twice.
async function pollDueTitleFollowUps() {
  try {
    const nowIso = new Date().toISOString();
    const { data: due, error } = await supabase
      .from('follow_ups')
      .select('id, user_id, deal_id, follow_up_type, reason, next_follow_up_at')
      .eq('contact_type', 'title_company')
      .eq('status', 'pending')
      .lte('next_follow_up_at', nowIso)
      .order('next_follow_up_at', { ascending: true })
      .limit(25);

    if (error) { console.error('[TitleSweep] query error:', error.message); return 0; }
    if (!due || due.length === 0) return 0;

    let fired = 0;
    for (const row of due) {
      if (!row.deal_id || !row.user_id) {
        await supabase.from('follow_ups').update({
          status: 'failed', outcome: 'missing deal_id/user_id', updated_at: new Date().toISOString(),
        }).eq('id', row.id);
        continue;
      }

      // Atomic claim - only the caller that flips pending→processing proceeds.
      const { data: claimed, error: claimErr } = await supabase
        .from('follow_ups')
        .update({ status: 'processing', updated_at: new Date().toISOString() })
        .eq('id', row.id)
        .eq('status', 'pending')
        .select('id');
      if (claimErr) { console.error('[TitleSweep] claim error:', claimErr.message); continue; }
      if (!claimed || claimed.length === 0) continue; // lost the race

      // Follow-up number = completed title touches for this deal so far + 1
      // (picks the matching subject/body variant in sendTitleFollowUpEmail).
      let followUpNumber = 1;
      try {
        const { count } = await supabase.from('follow_ups')
          .select('id', { count: 'exact', head: true })
          .eq('deal_id', row.deal_id)
          .eq('contact_type', 'title_company')
          .eq('status', 'completed');
        followUpNumber = (count || 0) + 1;
      } catch (_) { /* default to 1 */ }

      const sent = await sendTitleFollowUpEmail(row.deal_id, row.user_id, followUpNumber);
      await supabase.from('follow_ups').update({
        status:     sent ? 'completed' : 'failed',
        outcome:    sent
          ? (row.follow_up_type === 'call' ? 'sent as email (auto)' : 'email sent')
          : 'send failed or title company has no email',
        updated_at: new Date().toISOString(),
      }).eq('id', row.id);

      if (sent) fired++;
    }

    if (fired) console.log(`[TitleSweep] Sent ${fired} due title follow-up(s)`);
    return fired;
  } catch (err) {
    console.error('[TitleSweep] Sweep error:', err.message);
    return 0;
  }
}

module.exports = {
  autoAssignTitleCompany,
  sendDealPackageToTitle,
  scheduleTitleFollowUps,
  sendTitleFollowUpEmail,
  pollDueTitleFollowUps,
};
