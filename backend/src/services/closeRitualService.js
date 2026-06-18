// ─────────────────────────────────────────────────────────────────────────────
// closeRitualService — Stage 6: the CLOSE RITUAL.
//
// WHY: the moment a deal closes is the payday and the relationship peak — but the
// system used to do nothing human at that moment. This ritual runs once when a
// deal flips to status='closed' and does three things, all best-effort:
//   1. STAMP THE FEE — write deals.fee_collected_at + fee_collected_amount
//      (snapshot of assignment_fee at close) so the chart/analytics can show the
//      payday without re-deriving it.
//   2. THANK-YOU SMS — text the SELLER ("thank you, it was a pleasure") AND the
//      assigned BUYER ("deal's closed, thanks for trusting us"). This is the
//      retention moment that turns a one-off into a repeat seller/buyer.
//   3. TIMELINE — drop a `deal_closed` row on deal_activity so the chart shows
//      the close, the fee, and that the thank-yous went out.
//
// Idempotent: if fee_collected_at is already set we treat the ritual as already
// run and no-op (so re-PATCHing 'closed' won't double-text anyone). Every step is
// wrapped — a failure to text the buyer never blocks stamping the fee, and the
// whole thing never throws into the request path (it's called from setImmediate).
// ─────────────────────────────────────────────────────────────────────────────

const supabase = require('../config/supabase');
const { sendSMS } = require('./smsService');
const { logActivity } = require('./dealActivityService');

function money(n) {
  const v = Number(n || 0);
  return v ? `$${v.toLocaleString()}` : '';
}

function firstName(full = '') {
  return String(full).trim().split(/\s+/)[0] || '';
}

/**
 * Run the close ritual for a freshly-closed deal.
 *
 * @param {object} a
 * @param {string} a.dealId
 * @param {string} a.userId   the operator (sender of the thank-you texts)
 * @returns {Promise<{ ran:boolean, reason?:string, fee?:number }>}
 */
async function runCloseRitual({ dealId, userId }) {
  try {
    if (!dealId || !userId) return { ran: false, reason: 'missing_ids' };

    const { data: deal } = await supabase
      .from('deals')
      .select('id, lead_id, buyer_id, status, assignment_fee, fee_collected_at, seller_name, seller_phone, property_address')
      .eq('id', dealId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!deal) return { ran: false, reason: 'deal_not_found' };

    // Idempotency guard — already ritualized, don't double-fire (no double texts).
    if (deal.fee_collected_at) return { ran: false, reason: 'already_run' };

    const fee = Number(deal.assignment_fee || 0);

    // 1) STAMP THE FEE — point-in-time snapshot of the assignment fee at close.
    await supabase
      .from('deals')
      .update({
        fee_collected_at: new Date().toISOString(),
        fee_collected_amount: fee || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', dealId)
      .eq('user_id', userId)
      .then(() => {}, (e) => console.warn('[CloseRitual] fee stamp failed:', e?.message));

    // 2) THANK-YOU SMS — seller first, then assigned buyer. Both best-effort.
    let sellerTexted = false;
    let buyerTexted = false;

    // SELLER thank-you
    try {
      const sellerPhone = deal.seller_phone || null;
      if (sellerPhone) {
        const sName = firstName(deal.seller_name);
        const sBody = sName
          ? `Hi ${sName}, this is Veori — your sale just closed. Thank you for trusting us with your property; it was a genuine pleasure working with you. If you ever need anything down the road, we're one text away.`
          : `This is Veori — your sale just closed. Thank you for trusting us with your property; it was a genuine pleasure. If you ever need anything down the road, we're one text away.`;
        await sendSMS(sellerPhone, sBody, userId);
        sellerTexted = true;
      }
    } catch (e) {
      console.warn('[CloseRitual] seller thank-you SMS failed:', e?.message);
    }

    // BUYER thank-you (only if the deal was assigned to a buyer)
    try {
      if (deal.buyer_id) {
        const { data: buyer } = await supabase
          .from('buyers')
          .select('name, phone')
          .eq('id', deal.buyer_id)
          .maybeSingle();
        if (buyer?.phone) {
          const bName = firstName(buyer.name);
          const bBody = bName
            ? `Hi ${bName}, this is Veori — the deal just closed. Thank you for trusting us on this one. We'll keep the matches coming that fit your buy-box — talk soon.`
            : `This is Veori — the deal just closed. Thank you for trusting us on this one. We'll keep the matches coming that fit your buy-box — talk soon.`;
          await sendSMS(buyer.phone, bBody, userId);
          buyerTexted = true;
        }
      }
    } catch (e) {
      console.warn('[CloseRitual] buyer thank-you SMS failed:', e?.message);
    }

    // 3) TIMELINE — one close row on the chart.
    try {
      const feeStr = money(fee);
      await logActivity({
        userId,
        dealId,
        leadId: deal.lead_id || null,
        actorType: 'system',
        activityType: 'deal_closed',
        message: feeStr
          ? `Deal closed — assignment fee ${feeStr} booked. Thank-you sent to ${[sellerTexted && 'seller', buyerTexted && 'buyer'].filter(Boolean).join(' & ') || 'no one (no phone on file)'}.`
          : `Deal closed. Thank-you sent to ${[sellerTexted && 'seller', buyerTexted && 'buyer'].filter(Boolean).join(' & ') || 'no one (no phone on file)'}.`,
        metadata: {
          fee_collected_amount: fee || 0,
          seller_thanked: sellerTexted,
          buyer_thanked: buyerTexted,
          buyer_id: deal.buyer_id || null,
        },
      });
    } catch (e) {
      console.warn('[CloseRitual] activity log failed:', e?.message);
    }

    console.log(`[CloseRitual] deal ${dealId} closed — fee ${money(fee) || '$0'}, seller_texted=${sellerTexted}, buyer_texted=${buyerTexted}`);
    return { ran: true, fee };
  } catch (err) {
    console.warn('[CloseRitual] runCloseRitual error (non-fatal):', err?.message);
    return { ran: false, reason: 'error' };
  }
}

module.exports = { runCloseRitual };
