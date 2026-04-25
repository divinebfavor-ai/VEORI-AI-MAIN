-- ═══════════════════════════════════════════════════════════════════════════════
-- VEORI AI — Complete Database Schema
-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════════

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── USERS ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  full_name       TEXT,
  company_name    TEXT,
  phone           TEXT,
  plan            TEXT DEFAULT 'hustle',
  calls_used      INTEGER DEFAULT 0,
  calls_limit     INTEGER DEFAULT 500,
  ai_messages_used INTEGER DEFAULT 0,
  ai_messages_limit INTEGER DEFAULT 200,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── PHONE NUMBERS ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS phone_numbers (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID REFERENCES users(id) ON DELETE CASCADE,
  number              TEXT NOT NULL,
  friendly_name       TEXT,
  carrier             TEXT,
  area_code           TEXT,
  state               TEXT,
  daily_calls_made    INTEGER DEFAULT 0,
  daily_call_limit    INTEGER DEFAULT 50,
  weekly_calls_made   INTEGER DEFAULT 0,
  spam_score          INTEGER DEFAULT 100,
  health_status       TEXT DEFAULT 'healthy',
  is_active           BOOLEAN DEFAULT TRUE,
  last_used           TIMESTAMPTZ,
  cooldown_until      TIMESTAMPTZ,
  last_reset_date     DATE DEFAULT CURRENT_DATE,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ─── LEADS ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID REFERENCES users(id) ON DELETE CASCADE,
  first_name          TEXT,
  last_name           TEXT,
  phone               TEXT NOT NULL,
  email               TEXT,
  property_address    TEXT,
  property_city       TEXT,
  property_state      TEXT,
  property_zip        TEXT,
  property_type       TEXT,
  estimated_value     NUMERIC,
  estimated_equity    NUMERIC,
  estimated_arv       NUMERIC,
  source              TEXT,
  status              TEXT DEFAULT 'new',
  motivation_score    INTEGER,
  seller_personality  TEXT,
  is_on_dnc           BOOLEAN DEFAULT FALSE,
  call_count          INTEGER DEFAULT 0,
  last_call_date      TIMESTAMPTZ,
  notes               TEXT,
  tags                TEXT[],
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ─── CALLS ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS calls (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID REFERENCES users(id) ON DELETE CASCADE,
  lead_id               UUID REFERENCES leads(id) ON DELETE SET NULL,
  phone_number_id       UUID REFERENCES phone_numbers(id) ON DELETE SET NULL,
  vapi_call_id          TEXT UNIQUE,
  direction             TEXT DEFAULT 'outbound',
  status                TEXT DEFAULT 'initiated',
  duration_seconds      INTEGER,
  transcript            TEXT,
  recording_url         TEXT,
  motivation_score      INTEGER,
  seller_personality    TEXT,
  key_signals           TEXT[],
  objections            TEXT[],
  outcome               TEXT,
  ai_summary            TEXT,
  offer_made            NUMERIC,
  seller_response       TEXT,
  operator_took_over    BOOLEAN DEFAULT FALSE,
  started_at            TIMESTAMPTZ,
  ended_at              TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ─── DEALS ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deals (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID REFERENCES users(id) ON DELETE CASCADE,
  lead_id               UUID REFERENCES leads(id) ON DELETE SET NULL,
  property_address      TEXT,
  property_city         TEXT,
  property_state        TEXT,
  arv                   NUMERIC,
  repair_estimate       NUMERIC,
  mao                   NUMERIC,
  offer_price           NUMERIC,
  seller_agreed_price   NUMERIC,
  buyer_price           NUMERIC,
  assignment_fee        NUMERIC,
  status                TEXT DEFAULT 'new',
  seller_contract_url   TEXT,
  buyer_contract_url    TEXT,
  title_company_id      UUID,
  closing_date          DATE,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ─── BUYERS ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS buyers (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID REFERENCES users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  phone             TEXT,
  email             TEXT,
  buy_box_states    TEXT[],
  buy_box_types     TEXT[],
  max_price         NUMERIC,
  repair_tolerance  TEXT DEFAULT 'any',
  is_active         BOOLEAN DEFAULT TRUE,
  notes             TEXT,
  call_count        INTEGER DEFAULT 0,
  deals_closed      INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ─── BUYER CAMPAIGNS ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS buyer_campaigns (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID REFERENCES users(id) ON DELETE CASCADE,
  deal_id             UUID REFERENCES deals(id) ON DELETE CASCADE,
  status              TEXT DEFAULT 'pending',
  buyers_called       INTEGER DEFAULT 0,
  buyers_interested   INTEGER DEFAULT 0,
  assigned_buyer_id   UUID REFERENCES buyers(id) ON DELETE SET NULL,
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ─── APPOINTMENTS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  lead_id       UUID REFERENCES leads(id) ON DELETE CASCADE,
  scheduled_at  TIMESTAMPTZ NOT NULL,
  status        TEXT DEFAULT 'scheduled',
  notes         TEXT,
  outcome       TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── TITLE COMPANIES ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS title_companies (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  contact_name  TEXT,
  email         TEXT,
  phone         TEXT,
  address       TEXT,
  city          TEXT,
  state         TEXT,
  preferred_states TEXT[] DEFAULT '{}',
  preferred_communication_method TEXT,
  relationship_status TEXT DEFAULT 'active',
  notes         TEXT,
  is_default    BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── DEAL ACTIVITY ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deal_activity (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  deal_id         UUID REFERENCES deals(id) ON DELETE CASCADE,
  lead_id         UUID REFERENCES leads(id) ON DELETE SET NULL,
  title_company_id UUID REFERENCES title_companies(id) ON DELETE SET NULL,
  actor_type      TEXT DEFAULT 'system',
  activity_type   TEXT NOT NULL,
  message         TEXT NOT NULL,
  metadata        JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── TITLE LOGS ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS title_logs (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID REFERENCES users(id) ON DELETE CASCADE,
  deal_id             UUID REFERENCES deals(id) ON DELETE CASCADE,
  title_company_id    UUID REFERENCES title_companies(id) ON DELETE SET NULL,
  title_contact_name  TEXT,
  title_contact_phone TEXT,
  title_contact_email TEXT,
  sent_to_title_at    TIMESTAMPTZ,
  status              TEXT DEFAULT 'documents_sent',
  closing_date        DATE,
  last_follow_up_at   TIMESTAMPTZ,
  closed_at           TIMESTAMPTZ,
  fee_received        NUMERIC,
  notes               TEXT,
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ─── CONTRACTS ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contracts (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID REFERENCES users(id) ON DELETE CASCADE,
  deal_id             UUID REFERENCES deals(id) ON DELETE CASCADE,
  contract_type       TEXT NOT NULL,
  content             TEXT NOT NULL,
  signing_status      TEXT DEFAULT 'draft',
  signing_url         TEXT,
  closing_date        DATE,
  sent_at             TIMESTAMPTZ,
  fully_signed_at     TIMESTAMPTZ,
  signed_summary      JSONB DEFAULT '[]'::jsonb,
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contract_signers (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id         UUID REFERENCES contracts(id) ON DELETE CASCADE,
  signer_role         TEXT NOT NULL,
  name                TEXT NOT NULL,
  email               TEXT,
  phone               TEXT,
  access_token        TEXT UNIQUE NOT NULL,
  printed_name        TEXT,
  signature_text      TEXT,
  status              TEXT DEFAULT 'pending',
  accessed_at         TIMESTAMPTZ,
  signed_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ─── FOLLOW UPS ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS follow_ups (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID REFERENCES users(id) ON DELETE CASCADE,
  deal_id             UUID REFERENCES deals(id) ON DELETE CASCADE,
  contact_id          UUID,
  contact_type        TEXT DEFAULT 'seller',
  follow_up_type      TEXT DEFAULT 'text',
  next_follow_up_at   TIMESTAMPTZ NOT NULL,
  reason              TEXT NOT NULL,
  status              TEXT DEFAULT 'scheduled',
  outcome             TEXT,
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ─── PROPERTY PHOTOS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS property_photos (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID REFERENCES users(id) ON DELETE CASCADE,
  deal_id             UUID REFERENCES deals(id) ON DELETE CASCADE,
  role                TEXT DEFAULT 'seller',
  storage_path        TEXT NOT NULL,
  photo_url           TEXT NOT NULL,
  content_type        TEXT,
  caption             TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ─── CAMPAIGNS ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaigns (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID REFERENCES users(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  status                TEXT DEFAULT 'draft',
  concurrent_lines      INTEGER DEFAULT 3,
  daily_limit_per_number INTEGER DEFAULT 50,
  calling_hours_start   TIME DEFAULT '09:00',
  calling_hours_end     TIME DEFAULT '20:00',
  retry_attempts        INTEGER DEFAULT 3,
  call_delay_seconds    INTEGER DEFAULT 3,
  total_leads           INTEGER DEFAULT 0,
  leads_called          INTEGER DEFAULT 0,
  leads_answered        INTEGER DEFAULT 0,
  offers_made           INTEGER DEFAULT 0,
  contracts_sent        INTEGER DEFAULT 0,
  daily_spend_limit     NUMERIC,
  lead_filter           JSONB DEFAULT '{}',
  phone_number_ids      UUID[],
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ─── DNC RECORDS ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dnc_records (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone       TEXT UNIQUE NOT NULL,
  added_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  reason      TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── AI ASSISTANT CONVERSATIONS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_conversations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  messages    JSONB DEFAULT '[]',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- INDEXES FOR PERFORMANCE
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_leads_user_id       ON leads(user_id);
CREATE INDEX IF NOT EXISTS idx_leads_status        ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_phone         ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_motivation    ON leads(motivation_score DESC);
CREATE INDEX IF NOT EXISTS idx_calls_user_id       ON calls(user_id);
CREATE INDEX IF NOT EXISTS idx_calls_lead_id       ON calls(lead_id);
CREATE INDEX IF NOT EXISTS idx_calls_status        ON calls(status);
CREATE INDEX IF NOT EXISTS idx_calls_vapi          ON calls(vapi_call_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_user_id   ON campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_deals_user_id       ON deals(user_id);
CREATE INDEX IF NOT EXISTS idx_deals_status        ON deals(status);
CREATE INDEX IF NOT EXISTS idx_deal_activity_user_id ON deal_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_deal_activity_deal_id ON deal_activity(deal_id);
CREATE INDEX IF NOT EXISTS idx_title_logs_user_id  ON title_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_title_logs_deal_id  ON title_logs(deal_id);
CREATE INDEX IF NOT EXISTS idx_contracts_user_id   ON contracts(user_id);
CREATE INDEX IF NOT EXISTS idx_contracts_deal_id   ON contracts(deal_id);
CREATE INDEX IF NOT EXISTS idx_contract_signers_contract_id ON contract_signers(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_signers_access_token ON contract_signers(access_token);
CREATE INDEX IF NOT EXISTS idx_follow_ups_user_id  ON follow_ups(user_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_deal_id  ON follow_ups(deal_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_next_follow_up_at ON follow_ups(next_follow_up_at);
CREATE INDEX IF NOT EXISTS idx_property_photos_user_id ON property_photos(user_id);
CREATE INDEX IF NOT EXISTS idx_property_photos_deal_id ON property_photos(deal_id);
CREATE INDEX IF NOT EXISTS idx_dnc_phone           ON dnc_records(phone);

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (Enable after adding your first user)
-- ═══════════════════════════════════════════════════════════════════════════════
-- ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE buyers ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE phone_numbers ENABLE ROW LEVEL SECURITY;
