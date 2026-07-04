-- ─── VEORI: Landing Page Visitor Tracking ────────────────────────────────────
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS landing_page_visits (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id      TEXT,
  ip_address      TEXT,
  country_code    TEXT,
  country_name    TEXT,
  region          TEXT,
  city            TEXT,
  timezone        TEXT,
  referrer        TEXT,
  referrer_source TEXT,       -- 'facebook' | 'instagram' | 'twitter' | 'tiktok' | 'google' | 'direct' | 'other'
  user_agent      TEXT,
  device_type     TEXT,       -- 'mobile' | 'desktop' | 'tablet'
  page            TEXT        DEFAULT '/',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lpv_created_at      ON landing_page_visits(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lpv_country_code    ON landing_page_visits(country_code);
CREATE INDEX IF NOT EXISTS idx_lpv_referrer_source ON landing_page_visits(referrer_source);
CREATE INDEX IF NOT EXISTS idx_lpv_session_id      ON landing_page_visits(session_id);

-- No RLS needed - backend uses service role key for writes, admin reads
