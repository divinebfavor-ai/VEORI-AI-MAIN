-- ─── Features 13–38 Migration ────────────────────────────────────────────────
-- Run this against Supabase SQL Editor.
-- ALL tables are new — zero existing tables modified.

-- 13: Smart List Prioritization
CREATE TABLE IF NOT EXISTS smart_lists (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID NOT NULL,
  name          TEXT NOT NULL,
  filters       JSONB DEFAULT '{}',
  sort_by       TEXT DEFAULT 'score',
  lead_count    INT  DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 14: Driving for Dollars
CREATE TABLE IF NOT EXISTS dfd_pins (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL,
  session_id      UUID,
  lat             NUMERIC(10,7) NOT NULL,
  lng             NUMERIC(10,7) NOT NULL,
  address         TEXT,
  notes           TEXT,
  condition       TEXT DEFAULT 'unknown', -- vacant|distressed|good|unknown
  photo_url       TEXT,
  lead_id         UUID REFERENCES leads(id) ON DELETE SET NULL,
  ai_analysis     JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dfd_sessions (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL,
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  ended_at        TIMESTAMPTZ,
  pin_count       INT DEFAULT 0,
  miles_driven    NUMERIC(6,2) DEFAULT 0,
  area_name       TEXT
);

-- 15/16: Call Analytics (silent detection + best time)
CREATE TABLE IF NOT EXISTS call_analytics (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL,
  call_id         UUID REFERENCES calls(id) ON DELETE CASCADE,
  lead_id         UUID REFERENCES leads(id) ON DELETE CASCADE,
  duration_sec    INT DEFAULT 0,
  was_silent      BOOLEAN DEFAULT FALSE,
  silence_sec     INT DEFAULT 0,
  call_hour       INT,  -- 0-23
  call_day_of_week INT, -- 0=Sun 6=Sat
  answered        BOOLEAN DEFAULT FALSE,
  sentiment       TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 17: Caller ID Reputation
CREATE TABLE IF NOT EXISTS caller_id_reputation (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL,
  phone_number    TEXT NOT NULL,
  spam_score      INT DEFAULT 0,   -- 0-100 (100=very spammy)
  answer_rate     NUMERIC(5,2) DEFAULT 0,
  total_calls     INT DEFAULT 0,
  answered_calls  INT DEFAULT 0,
  flagged_spam    BOOLEAN DEFAULT FALSE,
  last_checked    TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, phone_number)
);

-- 19: Seller Trust Score
CREATE TABLE IF NOT EXISTS seller_trust_scores (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL,
  lead_id         UUID REFERENCES leads(id) ON DELETE CASCADE UNIQUE,
  score           INT DEFAULT 0,  -- 0-100
  factors         JSONB DEFAULT '{}',
  recommendation  TEXT,
  calculated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 20: Direct Mail Log
CREATE TABLE IF NOT EXISTS direct_mail_log (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL,
  lead_id         UUID REFERENCES leads(id) ON DELETE CASCADE,
  template        TEXT NOT NULL,
  lob_postcard_id TEXT,
  status          TEXT DEFAULT 'queued',
  address         JSONB,
  sent_at         TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  trigger_reason  TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 21: Profit Calculations
CREATE TABLE IF NOT EXISTS profit_calculations (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL,
  lead_id         UUID REFERENCES leads(id) ON DELETE CASCADE,
  arv             NUMERIC(12,2),
  repair_low      NUMERIC(12,2),
  repair_high     NUMERIC(12,2),
  repair_midpoint NUMERIC(12,2),
  mao             NUMERIC(12,2),
  asking_price    NUMERIC(12,2),
  assignment_fee  NUMERIC(12,2),
  net_profit      NUMERIC(12,2),
  roi_pct         NUMERIC(6,2),
  scenarios       JSONB DEFAULT '{}',
  repair_items    JSONB DEFAULT '[]',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 22: Property Listings
CREATE TABLE IF NOT EXISTS listings (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL,
  lead_id         UUID REFERENCES leads(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  asking_price    NUMERIC(12,2),
  arv             NUMERIC(12,2),
  repair_cost     NUMERIC(12,2),
  equity          NUMERIC(12,2),
  property_type   TEXT DEFAULT 'single_family',
  bedrooms        INT,
  bathrooms       NUMERIC(3,1),
  sqft            INT,
  year_built      INT,
  address         TEXT,
  city            TEXT,
  state           TEXT,
  zip             TEXT,
  status          TEXT DEFAULT 'draft', -- draft|active|under_contract|closed
  photos          JSONB DEFAULT '[]',
  highlights      JSONB DEFAULT '[]',
  tour_url        TEXT,
  published_to    JSONB DEFAULT '[]',  -- [facebook, instagram, email_blast, ...]
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 23: Blast History
CREATE TABLE IF NOT EXISTS listing_blasts (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id      UUID REFERENCES listings(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL,
  platforms       JSONB DEFAULT '[]',
  results         JSONB DEFAULT '{}',
  blasted_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 24: Buyer Inquiries / Qualification
CREATE TABLE IF NOT EXISTS buyer_inquiries (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id      UUID REFERENCES listings(id) ON DELETE CASCADE,
  buyer_id        UUID REFERENCES buyers(id) ON DELETE SET NULL,
  user_id         UUID NOT NULL,
  buyer_name      TEXT,
  buyer_email     TEXT,
  buyer_phone     TEXT,
  message         TEXT,
  qualification   JSONB DEFAULT '{}',
  ai_score        INT DEFAULT 0,
  status          TEXT DEFAULT 'new', -- new|qualified|rejected|offer_submitted
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 25: Deal Packages
CREATE TABLE IF NOT EXISTS deal_packages (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL,
  listing_id      UUID REFERENCES listings(id) ON DELETE CASCADE,
  lead_id         UUID REFERENCES leads(id) ON DELETE SET NULL,
  pdf_url         TEXT,
  sections        JSONB DEFAULT '{}',
  generated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 27: Assignment Contracts
CREATE TABLE IF NOT EXISTS assignment_contracts (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL,
  listing_id      UUID REFERENCES listings(id) ON DELETE CASCADE,
  buyer_id        UUID REFERENCES buyers(id) ON DELETE SET NULL,
  assignor_name   TEXT,
  assignee_name   TEXT,
  property_address TEXT,
  purchase_price  NUMERIC(12,2),
  assignment_fee  NUMERIC(12,2),
  sign_url        TEXT,
  dropbox_envelope_id TEXT,
  status          TEXT DEFAULT 'draft', -- draft|sent|signed|voided
  signed_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 28: Social Connections
CREATE TABLE IF NOT EXISTS social_connections (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL,
  platform        TEXT NOT NULL, -- facebook|instagram|twitter|youtube|tiktok|email
  access_token    TEXT,
  refresh_token   TEXT,
  account_name    TEXT,
  account_id      TEXT,
  expires_at      TIMESTAMPTZ,
  connected       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, platform)
);

-- 29-31: Generated Content / Posts
CREATE TABLE IF NOT EXISTS generated_content (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL,
  listing_id      UUID REFERENCES listings(id) ON DELETE SET NULL,
  content_type    TEXT NOT NULL, -- video|caption|email|post
  platform        TEXT,          -- instagram|facebook|twitter|youtube|tiktok
  content         TEXT,
  media_url       TEXT,
  thumbnail_url   TEXT,
  caption         TEXT,
  status          TEXT DEFAULT 'draft', -- draft|published|scheduled
  published_at    TIMESTAMPTZ,
  scheduled_for   TIMESTAMPTZ,
  publish_result  JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 32: Email Blasts
CREATE TABLE IF NOT EXISTS email_blasts (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL,
  listing_id      UUID REFERENCES listings(id) ON DELETE SET NULL,
  subject         TEXT NOT NULL,
  body_html       TEXT,
  recipient_type  TEXT DEFAULT 'all_buyers', -- all_buyers|specific|segment
  recipient_ids   JSONB DEFAULT '[]',
  sent_count      INT DEFAULT 0,
  open_count      INT DEFAULT 0,
  click_count     INT DEFAULT 0,
  status          TEXT DEFAULT 'draft', -- draft|sending|sent|failed
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 33: Content Calendar
CREATE TABLE IF NOT EXISTS content_calendar (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL,
  content_id      UUID REFERENCES generated_content(id) ON DELETE CASCADE,
  scheduled_date  DATE NOT NULL,
  platform        TEXT,
  status          TEXT DEFAULT 'scheduled', -- scheduled|published|cancelled
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 34-38: Virtual Tours
CREATE TABLE IF NOT EXISTS virtual_tours (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL,
  listing_id      UUID REFERENCES listings(id) ON DELETE CASCADE,
  lead_id         UUID REFERENCES leads(id) ON DELETE SET NULL,
  tour_token      TEXT UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  title           TEXT,
  photos          JSONB DEFAULT '[]',
  tour_type       TEXT DEFAULT 'slideshow', -- slideshow|360|kuula
  kuula_url       TEXT,
  trolto_url      TEXT,
  embed_code      TEXT,
  status          TEXT DEFAULT 'processing', -- processing|ready|failed
  is_public       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tour_views (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tour_id         UUID REFERENCES virtual_tours(id) ON DELETE CASCADE,
  viewer_ip       TEXT,
  viewer_agent    TEXT,
  duration_sec    INT DEFAULT 0,
  source          TEXT, -- email|instagram|facebook|direct
  viewed_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_dfd_pins_user    ON dfd_pins(user_id);
CREATE INDEX IF NOT EXISTS idx_dfd_sessions_user ON dfd_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_call_analytics_user ON call_analytics(user_id);
CREATE INDEX IF NOT EXISTS idx_caller_rep_user  ON caller_id_reputation(user_id);
CREATE INDEX IF NOT EXISTS idx_trust_lead       ON seller_trust_scores(lead_id);
CREATE INDEX IF NOT EXISTS idx_mail_user        ON direct_mail_log(user_id);
CREATE INDEX IF NOT EXISTS idx_profit_lead      ON profit_calculations(lead_id);
CREATE INDEX IF NOT EXISTS idx_listings_user    ON listings(user_id);
CREATE INDEX IF NOT EXISTS idx_buyer_inq_listing ON buyer_inquiries(listing_id);
CREATE INDEX IF NOT EXISTS idx_deal_pkg_listing ON deal_packages(listing_id);
CREATE INDEX IF NOT EXISTS idx_assignment_listing ON assignment_contracts(listing_id);
CREATE INDEX IF NOT EXISTS idx_social_conn_user ON social_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_gen_content_user ON generated_content(user_id);
CREATE INDEX IF NOT EXISTS idx_email_blasts_user ON email_blasts(user_id);
CREATE INDEX IF NOT EXISTS idx_cal_user         ON content_calendar(user_id);
CREATE INDEX IF NOT EXISTS idx_tours_user       ON virtual_tours(user_id);
CREATE INDEX IF NOT EXISTS idx_tour_views_tour  ON tour_views(tour_id);
