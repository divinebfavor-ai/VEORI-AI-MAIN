/**
 * Buyer Disposition Service - the BUY side of the auto-disposition loop.
 *
 * When a deal goes under_contract we want to (a) find the cash buyers whose
 * buy-box fits the deal and (b) blast them the deal so it moves fast. This module
 * owns the matching + the blast; it reuses the Phase-1 SMS queue (enqueueSMS) so a
 * buyer blast scales exactly like a seller blast (rotation, daily caps, DNC, credit
 * metering, durability - all enforced inside smsBlastProcessor).
 *
 * IMPORTANT - this is the SINGLE correct buyer matcher. The old inline match in
 * deals.js (under_contract hook) queried dead columns `preferred_states` /
 * `max_purchase_price` which don't exist on the live `buyers` table, so it always
 * returned nothing. The live schema is `buy_box_states` (text[]), `buy_box_types`
 * (text[]), `max_price` (numeric), `is_active` (bool) - matchBuyers uses those.
 */

const supabase     = require('../config/supabase');
const queueService = require('./queueService');

// How much over the buyer's max_price we still consider a fit. A buyer who buys up
// to $250k is realistically still a fit for a $260k deal, so we pad the ceiling 15%.
const PRICE_TOLERANCE = 1.15;

// Upper bound on how many buyer rows a single match pulls. Tunable via
// BUYER_MATCH_CAP (Railway env); defaults to 2000 so behaviour is unchanged when
// unset. Rows are fetched in pages of PAGE_SIZE via .range() to avoid a single
// large allocation as pools grow.
const PAGE_SIZE        = 1000;
const BUYER_MATCH_CAP  = Number(process.env.BUYER_MATCH_CAP) || 2000;

/**
 * Fetch up to BUYER_MATCH_CAP rows from a buyers query, paged via .range().
 * `build()` must return a FRESH PostgREST query builder on each call (filters
 * applied, no .range()/.limit()). Returns { rows, error } - error is the first
 * page error (caller decides how to treat it; pool query tolerates missing column).
 */
async function fetchBuyersPaged(build) {
  const rows = [];
  for (let from = 0; from < BUYER_MATCH_CAP; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE, BUYER_MATCH_CAP) - 1;
    const { data, error } = await build().range(from, to);
    if (error) return { rows, error };
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return { rows, error: null };
}

/**
 * The price we're asking a buyer to pay for this deal.
 * Prefer an explicit buyer_price; else mark up the offer_price; else fall back wide.
 */
function dealAskPrice(deal) {
  if (deal.buyer_price)  return Number(deal.buyer_price);
  if (deal.offer_price)  return Math.round(Number(deal.offer_price) * 1.1);
  if (deal.seller_agreed_price) return Math.round(Number(deal.seller_agreed_price) * 1.1);
  return null; // unknown - don't price-filter
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
    const { rows: ownBuyers, error } = await fetchBuyersPaged(() =>
      supabase
        .from('buyers')
        .select('*')
        .eq('user_id', deal.user_id)
        .eq('is_active', true)
    );
    if (error) { console.warn('[BuyerDispo] matchBuyers query error:', error.message); return []; }

    // OPT-IN shared pool: also pull OTHER operators' active buyers who opted into the
    // pool (share_to_pool = true). Owner stays user_id; these are additive exposure so
    // a fitting deal can reach a shared buyer. When no one has opted in this returns
    // nothing and behavior is identical to before. Tagged from_pool so the caller knows
    // whose buyer it is. NO fee logic / cross-operator side effects here - visibility
    // only. Degrades silently if share_to_pool column isn't migrated yet.
    let poolBuyers = [];
    try {
      const { rows: shared, error: poolErr } = await fetchBuyersPaged(() =>
        supabase
          .from('buyers')
          .select('*')
          .eq('share_to_pool', true)
          .eq('is_active', true)
          .neq('user_id', deal.user_id)
      );
      if (poolErr) {
        if (!/column .* does not exist/i.test(poolErr.message)) {
          console.warn('[BuyerDispo] pool query error:', poolErr.message);
        }
      } else {
        poolBuyers = shared || [];
      }
    } catch (e) { console.warn('[BuyerDispo] pool query failed:', e.message); }

    // Own buyers rank first; dedup by phone so a buyer that's both yours AND shared
    // isn't counted twice. Tag owner + from_pool for the caller.
    const seenPhone = new Set();
    const tagged = [];
    for (const b of (ownBuyers || [])) {
      const key = (b.phone || `id:${b.id}`).trim();
      if (seenPhone.has(key)) continue;
      seenPhone.add(key);
      tagged.push({ ...b, owner_user_id: b.user_id, from_pool: false });
    }
    for (const b of poolBuyers) {
      const key = (b.phone || `id:${b.id}`).trim();
      if (seenPhone.has(key)) continue;
      seenPhone.add(key);
      tagged.push({ ...b, owner_user_id: b.user_id, from_pool: true });
    }

    // deals has no property_type column; the type lives on the lead.
    const dealType = (deal.property_type || deal.leads?.property_type || '').trim().toLowerCase();
    const dealCity = (deal.property_city || '').trim().toLowerCase();
    const dealZip  = String(deal.property_zip || '').trim().slice(0, 5);

    return tagged.filter(b => {
      if (b.is_tire_kicker === true) return false;
      // State fit: empty buy_box_states == buys anywhere.
      const states = (b.buy_box_states || []).map(s => String(s).trim().toUpperCase());
      const stateFit = states.length === 0 || (state && states.includes(state));
      if (!stateFit) return false;

      // City fit: empty property_cities == any city in their states.
      const cities = (b.property_cities || []).map(c => String(c).trim().toLowerCase()).filter(Boolean);
      if (cities.length && !(dealCity && cities.includes(dealCity))) return false;

      // Zip fit: empty buy_box_zips == any zip.
      const zips = (b.buy_box_zips || []).map(z => String(z).trim().slice(0, 5)).filter(Boolean);
      if (zips.length && !(dealZip && zips.includes(dealZip))) return false;

      // Price fit: null max_price == no ceiling; null min_price == no floor. The same
      // 15% tolerance applies both ways. Unknown ask price never excludes a buyer.
      const priceFit = b.max_price == null || ask == null || Number(b.max_price) * PRICE_TOLERANCE >= ask;
      if (!priceFit) return false;
      const floorFit = b.min_price == null || ask == null || ask * PRICE_TOLERANCE >= Number(b.min_price);
      if (!floorFit) return false;

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
function buildBuyerSMS(deal, buyer, { fitsBuyBox = true } = {}) {
  const addr = [deal.property_address, deal.property_city, deal.property_state]
    .filter(Boolean).join(', ') || 'a new property';
  const ask  = dealAskPrice(deal);
  const arv  = deal.arv ? `, ARV ~$${Number(deal.arv).toLocaleString()}` : '';
  const price = ask ? ` for $${Number(ask).toLocaleString()}` : '';
  const first = (buyer.name || '').split(' ')[0];
  const hi = first ? `Hi ${first}, ` : '';
  // Only claim a buy-box fit when the matcher found one; fallback recipients get
  // the same offer without that claim.
  const fit = fitsBuyBox ? ' Fits your buy box -' : '';
  return `${hi}I've got a deal under contract: ${addr}${price}${arv}.${fit} Interested? Reply YES and I'll send the assignment contract.`;
}

/**
 * Start (or refresh) a buyer blast for a deal.
 *   1. find matching buyers (or, if none match, fall back to ALL active buyers so the
 *      deal still gets exposure - wholesalers would rather over-blast than miss).
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

  const { data: deal } = await supabase.from('deals').select('*, leads(property_type)').eq('id', dealId).eq('user_id', userId).maybeSingle();
  if (!deal) { console.warn(`[BuyerDispo] deal ${dealId} not found - no blast`); return { campaignId: null, matched: 0, enqueued: 0 }; }

  // 1. Match (fall back to all active buyers if no buy-box match).
  let buyers = await matchBuyers(deal);
  let usedFallback = false;
  if (!buyers.length) {
    const { rows: allActive } = await fetchBuyersPaged(() =>
      supabase.from('buyers').select('*').eq('user_id', userId).eq('is_active', true)
    );
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

  // 3. One offer row per buyer per deal, then the text. A buyer already offered
  //    this deal is not texted again (re-entering under_contract can't re-blast).
  //    The offer row is what lets a later "YES" be tied to THIS deal.
  const { data: priorOffers } = await supabase.from('buyer_deal_offers')
    .select('buyer_id').eq('deal_id', dealId);
  const alreadyOffered = new Set((priorOffers || []).map(o => o.buyer_id));
  let enqueued = 0;
  for (const buyer of recipients) {
    if (alreadyOffered.has(buyer.id)) continue;
    const { data: offer, error: offerErr } = await supabase.from('buyer_deal_offers').insert({
      user_id: userId, buyer_id: buyer.id, deal_id: dealId, campaign_id: campaignId,
      match_type: usedFallback ? 'fallback' : 'buy_box', status: 'queued',
    }).select('id').single();
    if (offerErr) {
      // 23505 = a concurrent blast already offered this buyer.
      if (offerErr.code !== '23505') console.warn(`[BuyerDispo] offer insert failed for buyer ${buyer.id}:`, offerErr.message);
      continue;
    }
    const body = buildBuyerSMS(deal, buyer, { fitsBuyBox: !usedFallback });
    try {
      const jobId = await queueService.enqueueSMS({
        leadId:     buyer.id,        // attribution only (DNC log); buyer is not a lead row
        campaignId: campaignId || dealId,
        userId,
        to:         buyer.phone,
        body,
      });
      if (jobId) enqueued += 1;
      else await supabase.from('buyer_deal_offers').update({ status: 'send_failed', updated_at: new Date().toISOString() }).eq('id', offer.id);
    } catch (e) {
      console.warn(`[BuyerDispo] enqueue failed for buyer ${buyer.id}:`, e.message);
      await supabase.from('buyer_deal_offers').update({ status: 'send_failed', updated_at: new Date().toISOString() }).eq('id', offer.id);
    }
  }

  // 4. Counter (atomic).
  if (campaignId && enqueued) {
    const { error: incErr } = await supabase.rpc('increment_buyer_campaign', { p_campaign_id: campaignId, p_sent: enqueued });
    if (incErr) console.warn('[BuyerDispo] sms_sent counter failed:', incErr.message);
  }

  console.log(`[BuyerDispo] deal ${dealId}: matched ${buyers.length}${usedFallback ? ' (fallback=all-active)' : ''}, enqueued ${enqueued} SMS`);
  return { campaignId, matched: usedFallback ? 0 : buyers.length, enqueued, usedFallback };
}

// ─── Buyer replies ────────────────────────────────────────────────────────────
const PENDING_OFFER = ['queued', 'sent', 'interested'];

/**
 * Open offers for everyone with this phone (a buyer can sit in more than one
 * operator's list via the shared pool). Only deals still under contract and
 * unassigned count - anything else is no longer available to that buyer.
 */
async function findPendingOffers(phone) {
  if (!supabase || !phone) return { buyers: [], offers: [] };
  const { data: buyers } = await supabase.from('buyers').select('*').eq('phone', phone).limit(20);
  const ids = (buyers || []).map(b => b.id);
  if (!ids.length) return { buyers: [], offers: [] };
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: offers, error } = await supabase.from('buyer_deal_offers')
    .select('*, deals(*, leads(*))')
    .in('buyer_id', ids)
    .in('status', PENDING_OFFER)
    .gte('sent_at', since)
    .order('sent_at', { ascending: false })
    .limit(20);
  if (error) { console.warn('[BuyerDispo] pending offer lookup failed:', error.message); return { buyers, offers: [] }; }
  const open = (offers || []).filter(o => o.deals && o.deals.status === 'under_contract' && !o.deals.buyer_id);
  return { buyers, offers: open };
}

/**
 * Decide which offer a reply is about. One open offer -> that one. Several -> the
 * one whose street address the buyer mentioned; otherwise ambiguous (ask, never guess).
 * @returns {{ kind: 'none'|'single'|'ambiguous', offer?: object, options?: object[] }}
 */
function pickOfferForReply(offers, body) {
  if (!offers || !offers.length) return { kind: 'none' };
  if (offers.length === 1) return { kind: 'single', offer: offers[0] };
  const text = String(body || '').toLowerCase();
  const mentioned = offers.filter(o => {
    const addr = String(o.deals?.property_address || '').toLowerCase().trim();
    const m = addr.match(/^(\d+)\s+([a-z0-9]+)/);
    if (!m) return false;
    const [, num, street] = m;
    return new RegExp(`\\b${num}\\b`).test(text) && text.includes(street);
  });
  if (mentioned.length === 1) return { kind: 'single', offer: mentioned[0] };
  return { kind: 'ambiguous', options: offers.slice(0, 5) };
}

module.exports = { matchBuyers, buildBuyerSMS, startBuyerBlast, dealAskPrice, findPendingOffers, pickOfferForReply, PENDING_OFFER };
