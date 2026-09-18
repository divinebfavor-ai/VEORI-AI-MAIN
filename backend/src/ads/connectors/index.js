// ─── Ads data sources ────────────────────────────────────────────────────────
// The creative and pre-flight agents ask for a capability, never a vendor. Not
// one of the external advertising data sources this system would like to use is
// connected, so every one of them is declared here as not built, with the exact
// environment variables it would need and what the platform does without it.
//
// This file exists so that a missing source becomes a recorded data gap in the
// brief instead of an invented number in an ad.

const NOT_BUILT = [
  {
    id: 'google_keyword_planner', name: 'Google Keyword Planner',
    capabilities: ['keyword_volume', 'keyword_competition', 'keyword_cpc'],
    env: ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID'],
    reason: 'Needs an approved Google Ads developer token and an OAuth refresh token for a Google Ads account. None are set.',
    without_it: 'Search demand and cost-per-click for a market are recorded as unknown. No keyword volume is ever estimated.',
  },
  {
    id: 'google_trends', name: 'Google Trends',
    capabilities: ['search_trend', 'seasonality'],
    env: ['GOOGLE_TRENDS_API_KEY'],
    reason: 'Google publishes no supported API for Trends; a licensed reseller key would be required.',
    without_it: 'Seasonality comes only from the operator’s own lead history, and is labelled as such.',
  },
  {
    id: 'meta_ad_library', name: 'Meta Ad Library',
    capabilities: ['competitor_ads', 'ad_creative_samples', 'advertiser_count'],
    env: ['META_AD_LIBRARY_TOKEN', 'FACEBOOK_APP_ID'],
    reason: 'Requires a Meta app with Ad Library API access and a verified identity. Not set.',
    without_it: 'Competitive density in a market cannot be measured. It is excluded from the opportunity score rather than guessed, and the saturation list falls back to the platform’s fixed catalogue of over-used industry language.',
  },
  {
    id: 'google_ads_transparency', name: 'Google Ads Transparency Center',
    capabilities: ['competitor_ads', 'advertiser_count'],
    env: ['GOOGLE_ADS_TRANSPARENCY_KEY'],
    reason: 'No public API. Scraping it would breach Google’s terms, so it is not attempted.',
    without_it: 'Same as Meta Ad Library: competitive density stays unmeasured.',
  },
  {
    id: 'batchdata', name: 'BatchData',
    capabilities: ['distress_lists', 'market_owner_counts'],
    env: ['BATCHDATA_API_KEY'],
    reason: 'Property-search integration not built.',
    without_it: 'Market-wide distress supply is measured only from leads already in the operator’s workspace, which understates the true market.',
  },
  {
    id: 'propstream', name: 'PropStream',
    capabilities: ['distress_lists', 'market_owner_counts'],
    env: ['PROPSTREAM_API_KEY'],
    reason: 'No public API integration in this codebase.',
    without_it: 'As above.',
  },
  {
    id: 'mls', name: 'MLS / IDX market feed',
    capabilities: ['mls_market_stats', 'days_on_market', 'inventory'],
    env: ['MLS_FEED_URL', 'MLS_FEED_KEY'],
    reason: 'Requires an MLS data agreement. No feed is connected.',
    without_it: 'Days-on-market and inventory are unknown; the brief says so instead of estimating them.',
  },
  {
    id: 'replicate', name: 'Replicate (image generation)',
    capabilities: ['image_generation'],
    env: ['REPLICATE_API_TOKEN'],
    reason: 'No image model is wired to the ads system.',
    without_it: 'Veori produces the image brief — format, subject, composition, text overlay, what must not appear — and the operator or a designer produces the image. The brief is stored so the same instruction can be handed to any generator later.',
  },
];

// No ads data source is implemented. When one is, it joins this array and
// providerFor() starts returning it; no agent code changes.
const IMPLEMENTED = [];

function status() {
  return [
    ...IMPLEMENTED.map(c => ({ id: c.id, name: c.name, capabilities: c.capabilities, connected: c.isConfigured(), built: true, env: c.env })),
    ...NOT_BUILT.map(c => ({ ...c, connected: false, built: false })),
  ];
}

function providerFor(capability) {
  return IMPLEMENTED.find(c => c.capabilities.includes(capability) && c.isConfigured()) || null;
}

const available = (capability) => !!providerFor(capability);

// The data gaps a brief must carry for the capabilities it wanted but could not get.
function gapsFor(capabilities) {
  const gaps = [];
  for (const cap of capabilities) {
    if (available(cap)) continue;
    const src = NOT_BUILT.filter(s => s.capabilities.includes(cap));
    gaps.push({
      capability: cap,
      status: 'UNKNOWN',
      would_come_from: src.map(s => s.name),
      why_missing: src.length ? src[0].reason : 'No provider is declared for this capability.',
      what_veori_does_instead: src.length ? src[0].without_it : 'The value is left unknown.',
      how_to_close_it: src.length && src[0].env.length ? `Set ${src[0].env.join(', ')} and connect ${src[0].name}.` : null,
    });
  }
  return gaps;
}

module.exports = { status, providerFor, available, gapsFor, NOT_BUILT };
