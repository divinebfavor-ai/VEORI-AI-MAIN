-- VEORI AI - Usage limits (shared-credit cushion). Additive, safe to re-run.
-- Applied to Supabase. Daily counters capping per-consumer use of shared metered
-- services (RentCast property data, AI chat) so one heavy user or an anonymous bot
-- can never drain the credits every operator depends on.
CREATE TABLE IF NOT EXISTS usage_counters (
  key      TEXT NOT NULL,          -- user id, or 'ip:<addr>' for anonymous traffic
  resource TEXT NOT NULL,          -- 'aria_chat' | 'property_research' | ...
  day      DATE NOT NULL,
  count    INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (key, resource, day)
);
