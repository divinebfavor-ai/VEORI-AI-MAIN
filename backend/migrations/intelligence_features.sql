-- ============================================================
-- VEORI AI — Intelligence Features Migration
-- All NEW tables only. Do NOT modify existing tables.
-- Run once against your Supabase project.
-- ============================================================

-- 1. CONVERSATION MEMORY
-- Persistent per-lead call history, injected into next call prompt
CREATE TABLE IF NOT EXISTS conversation_memory (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id           UUID NOT NULL,
  user_id           UUID NOT NULL,
  call_id           UUID,
  transcript        TEXT,
  motivation_score  INTEGER,
  sentiment         TEXT,                -- Motivated|Neutral|Hesitant|Cold|Hostile
  key_statements    JSONB DEFAULT '[]',  -- ["Seller said...", ...]
  objections        JSONB DEFAULT '[]',  -- ["Price too low", ...]
  follow_up_date    TIMESTAMPTZ,
  call_outcome      TEXT,               -- answered|voicemail|no_answer|callback_requested
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_conv_memory_lead ON conversation_memory(lead_id);
CREATE INDEX IF NOT EXISTS idx_conv_memory_user ON conversation_memory(user_id);

-- 2. SENTIMENT TIMELINE
-- One row per interaction (call or SMS), used for timeline display
CREATE TABLE IF NOT EXISTS sentiment_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     UUID NOT NULL,
  user_id     UUID NOT NULL,
  call_id     UUID,
  source      TEXT DEFAULT 'call',  -- call|sms|manual
  sentiment   TEXT NOT NULL,        -- Motivated|Neutral|Hesitant|Cold|Hostile
  score       INTEGER,              -- motivation_score at time of event
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sentiment_lead ON sentiment_events(lead_id);
CREATE INDEX IF NOT EXISTS idx_sentiment_user ON sentiment_events(user_id);
CREATE INDEX IF NOT EXISTS idx_sentiment_created ON sentiment_events(created_at DESC);

-- 3. DEAL PROBABILITY SCORES
-- Multi-factor deal probability score, recalculated after every interaction
CREATE TABLE IF NOT EXISTS deal_probability_scores (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id           UUID NOT NULL UNIQUE,
  user_id           UUID NOT NULL,
  score             INTEGER NOT NULL DEFAULT 0,  -- 0-100
  color             TEXT DEFAULT 'red',           -- red|yellow|green
  factors           JSONB DEFAULT '{}',           -- breakdown of scoring inputs
  calculated_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deal_prob_lead ON deal_probability_scores(lead_id);
CREATE INDEX IF NOT EXISTS idx_deal_prob_user ON deal_probability_scores(user_id);
CREATE INDEX IF NOT EXISTS idx_deal_prob_score ON deal_probability_scores(score DESC);

-- 4. HOT LEAD ESCALATIONS
-- Tracks every auto-escalation event (score > 85)
CREATE TABLE IF NOT EXISTS hot_lead_escalations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id           UUID NOT NULL,
  user_id           UUID NOT NULL,
  motivation_score  INTEGER,
  triggered_at      TIMESTAMPTZ DEFAULT NOW(),
  notification_sent BOOLEAN DEFAULT FALSE,
  follow_up_created BOOLEAN DEFAULT FALSE,
  contract_drafted  BOOLEAN DEFAULT FALSE,
  resolved_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_hot_lead_user ON hot_lead_escalations(user_id);
CREATE INDEX IF NOT EXISTS idx_hot_lead_lead ON hot_lead_escalations(lead_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hot_lead_unique
  ON hot_lead_escalations(lead_id)
  WHERE resolved_at IS NULL;  -- only one active escalation per lead

-- 5. WEEKLY PREDICTIONS
-- Generated every Monday at 8am — top 10 leads most likely to close
CREATE TABLE IF NOT EXISTS weekly_predictions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,
  week_start      DATE NOT NULL,        -- Monday of the week
  lead_id         UUID NOT NULL,
  rank            INTEGER NOT NULL,     -- 1-10
  predicted_score INTEGER,             -- 0-100 confidence
  reasoning       TEXT,
  status          TEXT DEFAULT 'active', -- active|closed|missed
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_weekly_pred_user ON weekly_predictions(user_id);
CREATE INDEX IF NOT EXISTS idx_weekly_pred_week ON weekly_predictions(week_start DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_pred_unique ON weekly_predictions(user_id, week_start, lead_id);

-- 6. DAILY BRIEFINGS
-- Stored morning briefing per operator per day
CREATE TABLE IF NOT EXISTS daily_briefings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,
  briefing_date   DATE NOT NULL,
  stats           JSONB DEFAULT '{}',   -- yesterday's call/deal stats
  priorities      JSONB DEFAULT '[]',   -- today's top follow-up leads
  ai_summary      TEXT,                 -- natural language summary
  delivered_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_brief_unique ON daily_briefings(user_id, briefing_date);
CREATE INDEX IF NOT EXISTS idx_daily_brief_user ON daily_briefings(user_id);

-- 7. SEQUENCE TEMPLATES (operator-defined sequences)
-- The existing sequences table stores enrollments; this stores the template definitions
CREATE TABLE IF NOT EXISTS sequence_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  trigger     TEXT DEFAULT 'manual',  -- manual|no_answer|voicemail|motivated
  steps       JSONB DEFAULT '[]',     -- [{type, delay_hours, content}, ...]
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_seq_tmpl_user ON sequence_templates(user_id);
