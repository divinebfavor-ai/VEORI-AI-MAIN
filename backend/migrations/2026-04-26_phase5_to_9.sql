-- ─── Phase 5–9 Schema: AI learning, market intelligence, notifications,
--     academy, waitlist, conversations, conversation insights, buyer preferences
-- Run with: psql $DATABASE_URL < migrations/2026-04-26_phase5_to_9.sql

-- ─── Sellers table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sellers (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  lead_id       UUID REFERENCES leads(id) ON DELETE SET NULL,
  full_name     TEXT NOT NULL,
  phone         TEXT,
  email         TEXT,
  property_address TEXT,
  property_state TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sellers_user_id   ON sellers(user_id);
CREATE INDEX IF NOT EXISTS idx_sellers_lead_id   ON sellers(lead_id);

-- ─── Conversations table ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  deal_id       UUID REFERENCES deals(id) ON DELETE CASCADE,
  contact_id    UUID,
  contact_type  TEXT DEFAULT 'seller',
  channel       TEXT DEFAULT 'sms',   -- sms | voice | email
  direction     TEXT DEFAULT 'outbound',
  body          TEXT NOT NULL,
  from_number   TEXT,
  to_number     TEXT,
  vapi_call_id  TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_conversations_deal_id   ON conversations(deal_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user_id   ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at DESC);

-- ─── AI Command Log ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_command_log (
  log_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  deal_id       UUID REFERENCES deals(id) ON DELETE SET NULL,
  lead_id       UUID REFERENCES leads(id) ON DELETE SET NULL,
  action_type   TEXT NOT NULL,
  model         TEXT,
  summary       TEXT,
  input_tokens  INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  status        TEXT DEFAULT 'success',   -- success | error
  error_message TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_command_log_user_id   ON ai_command_log(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_command_log_deal_id   ON ai_command_log(deal_id);
CREATE INDEX IF NOT EXISTS idx_ai_command_log_created_at ON ai_command_log(created_at DESC);

-- ─── Conversation insights (AI learning) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversation_insights (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_id              UUID REFERENCES deals(id) ON DELETE SET NULL,
  contact_id           UUID,
  contact_type         TEXT DEFAULT 'seller',
  phase                TEXT DEFAULT 'qualification',
  objections_raised    JSONB DEFAULT '[]'::jsonb,
  successful_language  TEXT[] DEFAULT '{}',
  sentiment_start      INTEGER DEFAULT 0,
  sentiment_end        INTEGER DEFAULT 0,
  outcome              TEXT DEFAULT 'unknown',
  created_at           TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_conversation_insights_deal_id ON conversation_insights(deal_id);

-- ─── Deal outcome learning ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deal_outcome_learning (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_id              UUID REFERENCES deals(id) ON DELETE SET NULL,
  outcome              TEXT NOT NULL,   -- closed | dead | withdrawn
  reason               TEXT,
  days_to_outcome      INTEGER,
  touches_count        INTEGER DEFAULT 0,
  final_motivation_score INTEGER,
  state                TEXT,
  property_type        TEXT,
  month                INTEGER,
  season               TEXT,
  assignment_fee       NUMERIC(12,2),
  created_at           TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deal_outcome_learning_state ON deal_outcome_learning(state);
CREATE INDEX IF NOT EXISTS idx_deal_outcome_learning_outcome ON deal_outcome_learning(outcome);

-- ─── Market intelligence ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS market_intelligence (
  record_id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  state                TEXT NOT NULL,
  county               TEXT,
  metro                TEXT,
  avg_motivation_score INTEGER DEFAULT 0,
  deals_attempted      INTEGER DEFAULT 0,
  deals_closed         INTEGER DEFAULT 0,
  close_rate           NUMERIC(5,2) DEFAULT 0,
  avg_assignment_fee   NUMERIC(12,2) DEFAULT 0,
  trend_direction      TEXT DEFAULT 'flat',   -- up | down | flat
  trend_percentage     NUMERIC(5,2) DEFAULT 0,
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (state, county, metro)
);
CREATE INDEX IF NOT EXISTS idx_market_intelligence_state ON market_intelligence(state);

-- ─── Buyer preferences (AI learning) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS buyer_preferences (
  preference_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  buyer_id             UUID REFERENCES buyers(id) ON DELETE CASCADE,
  accepted_deal_params JSONB DEFAULT '[]'::jsonb,
  rejected_deal_params JSONB DEFAULT '[]'::jsonb,
  match_accuracy_score NUMERIC(5,2) DEFAULT 0,
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_buyer_preferences_buyer_id ON buyer_preferences(buyer_id);

-- ─── State compliance ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS state_compliance (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  state_code      TEXT NOT NULL UNIQUE,
  state_name      TEXT NOT NULL,
  calling_hours_start TEXT DEFAULT '08:00',
  calling_hours_end   TEXT DEFAULT '21:00',
  timezone        TEXT DEFAULT 'America/New_York',
  max_attempts_per_week INTEGER DEFAULT 3,
  requires_disclosure BOOLEAN DEFAULT TRUE,
  assignment_allowed  BOOLEAN DEFAULT TRUE,
  double_close_notes  TEXT,
  notes           TEXT,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Notifications ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  notification_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  operator_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  title           TEXT NOT NULL,
  message         TEXT NOT NULL,
  deal_id         UUID REFERENCES deals(id) ON DELETE SET NULL,
  link            TEXT,
  is_read         BOOLEAN DEFAULT FALSE,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_operator_id ON notifications(operator_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read     ON notifications(operator_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at  ON notifications(created_at DESC);

-- ─── Academy progress ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS academy_progress (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  lesson_id       TEXT NOT NULL,
  completed_at    TIMESTAMPTZ DEFAULT NOW(),
  quiz_score      INTEGER,
  UNIQUE (user_id, lesson_id)
);
CREATE INDEX IF NOT EXISTS idx_academy_progress_user_id ON academy_progress(user_id);

-- ─── Veori Credits waitlist ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS veori_credits_waitlist (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                   TEXT NOT NULL,
  email                  TEXT NOT NULL UNIQUE,
  investment_range       TEXT,
  preferred_property_types TEXT[],
  preferred_states       TEXT[],
  signed_up_at           TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_veori_credits_waitlist_email ON veori_credits_waitlist(email);

-- ─── Operator preferences (if not already a column on users) ─────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS theme TEXT DEFAULT 'dark',
  ADD COLUMN IF NOT EXISTS dark_mode BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS contextual_tips_enabled BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS tfa_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE;

-- ─── Deals: add missing columns ───────────────────────────────────────────────
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS deal_velocity_score INTEGER,
  ADD COLUMN IF NOT EXISTS ai_paused BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS risk_level TEXT DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS stage_changed_at TIMESTAMPTZ;
