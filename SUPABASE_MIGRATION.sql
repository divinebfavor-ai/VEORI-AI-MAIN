-- ═══════════════════════════════════════════════════════════════════════════════
-- VEORI AI — Missing Tables Migration
-- Run this in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/xqllxyoeftkbufoungcz/sql
-- ═══════════════════════════════════════════════════════════════════════════════

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

-- ─── DEALS ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deals (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID REFERENCES users(id) ON DELETE CASCADE,
  lead_id               UUID REFERENCES leads(id) ON DELETE SET NULL,
  property_address      TEXT,
  property_city         TEXT,
  property_state        TEXT,
  property_zip          TEXT,
  arv                   NUMERIC,
  repair_estimate       NUMERIC,
  mao                   NUMERIC,
  offer_price           NUMERIC,
  seller_agreed_price   NUMERIC,
  buyer_price           NUMERIC,
  assignment_fee        NUMERIC,
  estimated_rent        NUMERIC,
  status                TEXT DEFAULT 'new',
  seller_name           TEXT,
  seller_phone          TEXT,
  seller_email          TEXT,
  seller_primary_tag    TEXT,
  seller_contract_url   TEXT,
  buyer_contract_url    TEXT,
  title_company_id      UUID REFERENCES title_companies(id) ON DELETE SET NULL,
  buyer_id              UUID,
  closing_date          DATE,
  contract_status       TEXT,
  notes                 TEXT,
  estimated_value       NUMERIC,
  estimated_equity      NUMERIC,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deals_user_id ON deals(user_id);
CREATE INDEX IF NOT EXISTS idx_deals_status  ON deals(status);
CREATE INDEX IF NOT EXISTS idx_deals_lead_id ON deals(lead_id);

-- ─── BUYERS ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS buyers (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID REFERENCES users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  phone             TEXT,
  email             TEXT,
  buyer_type        TEXT,
  investment_strategy TEXT,
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

CREATE INDEX IF NOT EXISTS idx_buyers_user_id ON buyers(user_id);

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

-- ─── DEAL ACTIVITY ────────────────────────────────────────────────────────────
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

CREATE INDEX IF NOT EXISTS idx_deal_activity_user_id    ON deal_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_deal_activity_deal_id    ON deal_activity(deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_activity_created_at ON deal_activity(created_at DESC);

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

CREATE INDEX IF NOT EXISTS idx_title_logs_user_id ON title_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_title_logs_deal_id ON title_logs(deal_id);

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

CREATE INDEX IF NOT EXISTS idx_contracts_user_id              ON contracts(user_id);
CREATE INDEX IF NOT EXISTS idx_contracts_deal_id              ON contracts(deal_id);
CREATE INDEX IF NOT EXISTS idx_contract_signers_contract_id   ON contract_signers(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_signers_access_token  ON contract_signers(access_token);

-- ─── FOLLOW UPS ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS follow_ups (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID REFERENCES users(id) ON DELETE CASCADE,
  deal_id             UUID REFERENCES deals(id) ON DELETE SET NULL,
  lead_id             UUID REFERENCES leads(id) ON DELETE SET NULL,
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

CREATE INDEX IF NOT EXISTS idx_follow_ups_user_id           ON follow_ups(user_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_deal_id           ON follow_ups(deal_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_next_follow_up_at ON follow_ups(next_follow_up_at);

-- ─── PROPERTY PHOTOS ─────────────────────────────────────────────────────────
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

CREATE INDEX IF NOT EXISTS idx_property_photos_user_id ON property_photos(user_id);
CREATE INDEX IF NOT EXISTS idx_property_photos_deal_id ON property_photos(deal_id);

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

-- ─── CONVERSATIONS ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  lead_id       UUID REFERENCES leads(id) ON DELETE SET NULL,
  deal_id       UUID REFERENCES deals(id) ON DELETE SET NULL,
  contact_id    UUID,
  contact_type  TEXT DEFAULT 'seller',
  channel       TEXT DEFAULT 'sms',
  direction     TEXT DEFAULT 'outbound',
  body          TEXT NOT NULL,
  from_number   TEXT,
  to_number     TEXT,
  vapi_call_id  TEXT,
  sent_at       TIMESTAMPTZ,
  status        TEXT DEFAULT 'sent',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_id    ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_lead_id    ON conversations(lead_id);
CREATE INDEX IF NOT EXISTS idx_conversations_deal_id    ON conversations(deal_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at DESC);

-- ─── NOTIFICATIONS ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  notification_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  operator_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  title           TEXT NOT NULL,
  message         TEXT NOT NULL,
  deal_id         UUID REFERENCES deals(id) ON DELETE SET NULL,
  lead_id         UUID REFERENCES leads(id) ON DELETE SET NULL,
  link            TEXT,
  is_read         BOOLEAN DEFAULT FALSE,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_operator_id ON notifications(operator_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read     ON notifications(operator_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at  ON notifications(created_at DESC);

-- ─── SEQUENCES ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sequences (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  lead_id         UUID REFERENCES leads(id) ON DELETE CASCADE,
  sequence_type   TEXT NOT NULL,
  current_step    INTEGER DEFAULT 0,
  next_action_at  TIMESTAMPTZ,
  status          TEXT DEFAULT 'active',
  metadata        JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sequences_user_id       ON sequences(user_id);
CREATE INDEX IF NOT EXISTS idx_sequences_lead_id       ON sequences(lead_id);
CREATE INDEX IF NOT EXISTS idx_sequences_status        ON sequences(status);
CREATE INDEX IF NOT EXISTS idx_sequences_next_action   ON sequences(next_action_at);

-- ─── TCPA LOG ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tcpa_log (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                 UUID REFERENCES users(id) ON DELETE CASCADE,
  lead_id                 UUID REFERENCES leads(id) ON DELETE SET NULL,
  call_id                 UUID REFERENCES calls(id) ON DELETE SET NULL,
  phone_number            TEXT NOT NULL,
  called_at_utc           TIMESTAMPTZ NOT NULL,
  local_time              TEXT,
  timezone                TEXT,
  within_calling_hours    BOOLEAN,
  dnc_checked_at          TIMESTAMPTZ,
  dnc_result              TEXT,
  attempt_number          INTEGER DEFAULT 1,
  days_since_last_attempt INTEGER,
  consent_status          TEXT DEFAULT 'unknown',
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tcpa_log_user_id  ON tcpa_log(user_id);
CREATE INDEX IF NOT EXISTS idx_tcpa_log_lead_id  ON tcpa_log(lead_id);
CREATE INDEX IF NOT EXISTS idx_tcpa_log_called_at ON tcpa_log(called_at_utc DESC);

-- ─── CALLS: add missing columns if needed ─────────────────────────────────────
ALTER TABLE calls ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS ai_summary TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS key_signals TEXT[];
ALTER TABLE calls ADD COLUMN IF NOT EXISTS objections TEXT[];
ALTER TABLE calls ADD COLUMN IF NOT EXISTS offer_made BOOLEAN DEFAULT FALSE;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS seller_personality TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS direction TEXT DEFAULT 'outbound';

-- ─── PHONE NUMBERS: add missing columns ───────────────────────────────────────
ALTER TABLE phone_numbers ADD COLUMN IF NOT EXISTS vapi_phone_number_id TEXT;
ALTER TABLE phone_numbers ADD COLUMN IF NOT EXISTS monthly_cost NUMERIC DEFAULT 2.15;
ALTER TABLE phone_numbers ADD COLUMN IF NOT EXISTS purchased_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE phone_numbers ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ;
ALTER TABLE phone_numbers ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT FALSE;
ALTER TABLE phone_numbers ADD COLUMN IF NOT EXISTS release_reason TEXT;

-- ─── LEADS: add missing columns ───────────────────────────────────────────────
ALTER TABLE leads ADD COLUMN IF NOT EXISTS primary_tag TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS secondary_tags TEXT[];
ALTER TABLE leads ADD COLUMN IF NOT EXISTS tag_confidence INTEGER;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS tag_reason TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_call_outcome TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS direct_mail_sent BOOLEAN DEFAULT FALSE;

-- ─── USERS: add missing columns ───────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_caller_name TEXT DEFAULT 'Alex';
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_voice_id TEXT DEFAULT 'Elliot';
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_personality_tone TEXT DEFAULT 'professional';
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_intro_script TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS vapi_assistant_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS business_phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'trial';
ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
