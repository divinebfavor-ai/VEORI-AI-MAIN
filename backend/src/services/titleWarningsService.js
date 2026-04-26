const supabase = require('../config/supabase');

// ─── Daily title warnings scan (BullMQ job at 8am) ────────────────────────────
async function runTitleWarningsScan() {
  console.log('[TitleWarnings] Running daily scan…');
  try {
    const now = new Date();

    // Deals currently under contract or in buyer search
    const { data: activeDeals } = await supabase.from('deals')
      .select('deal_id, user_id, property_address, stage, closing_date, title_company_id, stage_changed_at')
      .in('stage', ['under_contract', 'buyer_search'])
      .not('closing_date', 'is', null);

    if (!activeDeals || activeDeals.length === 0) {
      console.log('[TitleWarnings] No active deals with closing dates.');
      return;
    }

    for (const deal of activeDeals) {
      const closingDate = new Date(deal.closing_date);
      const daysUntilClose = Math.floor((closingDate - now) / 86400000);

      // 7-day warning
      if (daysUntilClose === 7) {
        await fireNotification({
          operatorId: deal.user_id,
          type: 'title_warning_7day',
          title: '📅 Closing in 7 days',
          message: `${deal.property_address} closes in 7 days. Confirm title search, insurance binder, and buyer funding are in order.`,
          dealId: deal.deal_id,
        });
      }

      // 48-hour warning
      if (daysUntilClose === 2) {
        await fireNotification({
          operatorId: deal.user_id,
          type: 'title_warning_48hr',
          title: '⚠️ 48 hours to closing',
          message: `${deal.property_address} closes in 48 hours. Verify final HUD/ALTA, wire instructions, and all signatures are complete.`,
          dealId: deal.deal_id,
        });
      }

      // Stale title — no update in 5+ days
      const lastUpdate = deal.stage_changed_at ? new Date(deal.stage_changed_at) : null;
      const daysSinceUpdate = lastUpdate
        ? Math.floor((now - lastUpdate) / 86400000)
        : 999;

      if (daysSinceUpdate >= 5 && daysUntilClose > 0) {
        // Check if we already sent a stale notification in the last 5 days
        const { count } = await supabase.from('notifications')
          .select('*', { count: 'exact', head: true })
          .eq('operator_id', deal.user_id)
          .eq('type', 'title_stale')
          .eq('deal_id', deal.deal_id)
          .gte('created_at', new Date(now - 5 * 86400000).toISOString());

        if (!count || count === 0) {
          await fireNotification({
            operatorId: deal.user_id,
            type: 'title_stale',
            title: '🔇 Title status is stale',
            message: `${deal.property_address} has had no title update in ${daysSinceUpdate} days. Follow up with your title company to confirm status.`,
            dealId: deal.deal_id,
          });
        }
      }
    }

    console.log(`[TitleWarnings] Scan complete. Processed ${activeDeals.length} deals.`);
  } catch (err) {
    console.error('[TitleWarnings] Scan error:', err.message);
  }
}

async function fireNotification({ operatorId, type, title, message, dealId }) {
  try {
    await supabase.from('notifications').insert({
      operator_id: operatorId,
      type,
      title,
      message,
      deal_id: dealId || null,
      is_read: false,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[TitleWarnings] Notification insert error:', err.message);
  }
}

module.exports = { runTitleWarningsScan };
