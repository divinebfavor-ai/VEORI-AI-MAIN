/**
 * Buyer Disposition Service — the BUY side of the auto-disposition loop.
 *
 * When a deal goes under_contract we want to (a) find the cash buyers whose
 * buy-box fits the deal and (b) blast them the deal so it moves fast. This module
 * owns the matching + the blast; it reuses the Phase-1 SMS queue (enqueueSMS) so a
 * buyer blast scales exactly like a seller blast (rotation, daily caps, DNC, credit
 * metering, durability — all enforced inside smsBlastProcessor).
 *
 * IMPORTANT — this is the SINGLE correct buyer matcher. The old inline match in
 * deals.js (under_contract hook) queried dead columns `preferred_states` /
 * `max_purchase_price` which don't exist on the live `buyers` table, so it always
 * returned nothing. The live schema is `buy_box_states` (text[]), `buy_box_types`
 * (text[]), `max_price` (numeric), `is_active` (bool) — matchBuyers uses those.
 */

const supabase     = require('../config/supabase');
const queueService = require('./queueService');

// How much over the buyer's max_price we still consider a fit. A buyer who buys up
// to $250k is realistically still a fit for a $260k deal, so we pad the ceiling 15%.
const PRICE_TOLERANCE = 1.15;

/**
 * The price we're asking a buyer to pay for this deal.
 * Prefer an explicit buyer_price; else mark up the offer_price; else fall back wide.
 */
function dealAskPrice(deal) {
  if (deal.buyer_price)  return Number(deal.buyer_price);
  if (deal.offer_price)  return Math.round(Number(deal.offer_price) * 1.1);
  if (deal.seller_agreed_price) return Math.round(Number(deal.seller_agreed_price) * 1.1);
  return null; // unknown — don't price-filter
}

/**
 * Find active buyers whose buy-box fits this deal.
 *   - state: buy_box_states contains the deal's property_state, OR buyer left it empty (buys anywhere)
 *   - price: buyer.max_price >= ask (with tolerance), OR buyer left max_price null
 *   - type:  buy_box_types overlaps the deal's property type, OR buyer left it empty
 *   - is_active = true
 * Returns [] (never throws) so the caller's hook stays resilient.
 *
 * @param {object} deal  a deals row (needs user_id, property_state, pricing)
 * @returns {Promise<Array>} matching buyers
 */
async function matchBuyers(deal) {
  if (!supabase || !deal?.user_id) return [];
  const state = (deal.property_state || '').trim().toUpperCase();
  const ask   = dealAskPrice(deal);

  try {
    // Pull this operator's active buyers, then filter in JS. The buy-box columns are
    // arrays with "empty == matches anything" semantics that are awkward to express
    // in a single PostgREST .or() chain, so we keep the query simple and correct and
    // do the overlap logic here. Buyer pools per operator are bounded (hundreds, not
    // millions), so this is cheap.
    const { data: buyers, error } = await supabase
      .from('buyers')
      .select('*')
      .eq('user_id', deal.user_id)
      .eq('is_active', true)
      .limit(2000);
    if (error) { console.warn('[BuyerDispo] matchBuyers query error:', error.message); return []; }

    const dealType = (deal.property_type || '').trim().toLowerCase();

    return (buyers || []).filter(b => {
      // State fit: empty buy_box_states == buys anywhere.
      const states = (b.buy_box_states || []).map(s => String(s).trim().toUpperCase());
      const stateFit = states.length === 0 || (state && states.includes(state));
      if (!stateFit) return false;

      // Price fit: null max_price == no ceiling.
      const priceFit = b.max_price == null || ask == null || Number(b.max_price) * PRICE_TOLERANCE >= ask;
      if (!priceFit) return false;

      // Type fit: empty buy_box_types == any type.
      const types = (b.buy_box_types || []).map(t => String(t).trim().toLowerCase());
      const typeFit = types.length === 0 || !dealType || types.includes(dealType);
      return typeFit;
    });
  } catch (e) {
    console.warn('[BuyerDispo] matchBuyers failed:', e.message);
    return [];
  }
}

/**
 * Build the buy-box / deal-blast SMS copy sent to a matched buyer.
 * Keeps it short, factual, and reply-friendly (a "yes" reply drives auto-assign).
 */
function buildBuyerSMS(deal, buyer) {
  const addr = [deal.property_address, deal.property_city, deal.property_state]
    .filter(Boolean).join(', ') || 'a new property';
  const ask  = dealAskPrice(deal);
  const arv  = deal.arv ? `, ARV ~$${Number(deal.arv).toLocaleString()}` : '';
  const price = ask ? ` for $${Number(ask).toLocaleString()}` : '';
  const first = (buyer.name || '').split(' ')[0];
  const hi = first ? `Hi ${first}, ` : '';
  return `${hi}I've got a deal under contract: ${addr}${price}${arv}. Fits your buy box — interested? Reply YES and I'll send the assignment contract.`;
}

/**
 * Start (or refresh) a buyer blast for a deal.
 *   1. find matching buyers (or, if none match, fall back to ALL active buyers so the
 *      deal still gets exposure — wholesalers would rather over-blast than miss).
 *   2. create/refresh a buyer_campaigns row for the deal.
 *   3. enqueue one SMS per buyer onto the Phase-1 SMS_BLAST queue (rotation, DNC,
 *      credit metering, daily caps all enforced downstream).
 *   4. bump buyer_campaigns.sms_sent by the number enqueued.
 *
 * Redis-down: enqueueSMS returns null per job; we count those as not-sent and the
 * caller can retry. We never place a send here directly (single send path = queue).
 *
 * @param {string} dealId
 * @param {string} userId
 * @returns {Promise<{campaignId:string|null, matched:number, enqueued:number}>}
 */
async function startBuyerBlast(dealId, userId) {
  if (!supabase || !dealId || !userId) return { campaignId: null, matched: 0, enqueued: 0 };

  const { data: deal } = await supabase.from('deals').select('*').eq('id', dealId).single();
  if (!deal) { console.warn(`[BuyerDispo] deal ${dealId} not found — no blast`); return { campaignId: null, matched: 0, enqueued: 0 }; }

  // 1. Match (fall back to all active buyers if no buy-box match).
  let buyers = await matchBuyers(deal);
  let usedFallback = false;
  if (!buyers.length) {
    const { data: allActive } = await supabase
      .from('buyers').select('*').eq('user_id', userId).eq('is_active', true).limit(2000);
    buyers = (allActive || []);
    usedFallback = buyers.length > 0;
  }
  const recipients = buyers.filter(b => b.phone);

  // 2. Create / refresh the campaign row (one active campaign per deal).
  let campaignId = null;
  try {
    const { data: existing } = await supabase
      .from('buyer_campaigns').select('id').eq('deal_id', dealId).eq('user_id', userId).maybeSingle();
    if (existing) {
      campaignId = existing.id;
      await supabase.from('buyer_campaigns')
        .update({ status: 'active', started_at: new Date().toISOString() })
        .eq('id', campaignId);
    } else {
      const { data: created } = await supabase.from('buyer_campaigns').insert({
        user_id:    userId,
        deal_id:    dealId,
        status:     'active',
        started_at: new Date().toISOString(),
      }).select('id').single();
      campaignId = created?.id || null;
    }
  } catch (e) {
    console.warn('[BuyerDispo] buyer_campaigns upsert failed:', e.message);
  }

  // 3. Enqueue one SMS per recipient. campaignId+buyer.id == idempotent jobId.
  let enqueued = 0;
  for (const buyer of recipients) {
    const body = buildBuyerSMS(deal, buyer);
    try {
      const jobId = await queueService.enqueueSMS({
        leadId:     buyer.id,        // attribution only (DNC log); buyer is not a lead row
        campaignId: campaignId || dealId,
        userId,
        to:         buyer.phone,
        body,
        // no smsFirstLeadId — buyers don't get sms_first_leads rows
      });
      if (jobId) enqueued += 1;
    } catch (e) {
      console.warn(`[BuyerDispo] enqueue failed for buyer ${buyer.id}:`, e.message);
    }
  }

  // 4. Bump the sent counter (additive — column added in the Phase-1 migration).
  if (campaignId && enqueued) {
    try {
      const { data: row } = await supabase.from('buyer_campaigns').select('sms_sent').eq('id', campaignId).single();
      const next = (row?.sms_sent || 0) + enqueued;
      await supabase.from('buyer_campaigns').update({ sms_sent: next }).eq('id', campaignId);
    } catch (e) {
      console.warn('[BuyerDispo] sms_sent counter bump failed:', e.message);
    }
  }

  console.log(`[BuyerDispo] deal ${dealId}: matched ${buyers.length}${usedFallback ? ' (fallback=all-active)' : ''}, enqueued ${enqueued} SMS`);
  return { campaignId, matched: buyers.length, enqueued };
}

module.exports = { matchBuyers, buildBuyerSMS, startBuyerBlast, dealAskPrice };
