-- Wealth Playbook Tables
-- Run this in Supabase SQL editor

CREATE TABLE IF NOT EXISTS wealth_assessments (
  assessment_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  home_ownership  TEXT,
  equity_position TEXT,
  debt_situation  TEXT,
  real_estate_goal TEXT,
  experience_level TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wealth_playbooks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  headline          TEXT,
  summary           TEXT,
  primary_strategy  TEXT,
  strategies        JSONB,
  wealth_projection JSONB,
  first_action      TEXT,
  generated_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wealth_scores (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  score             INTEGER DEFAULT 0,
  score_tier        TEXT DEFAULT 'Learner',
  actions_completed TEXT[] DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS strategy_progress (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  strategy_id TEXT NOT NULL,
  status      TEXT DEFAULT 'viewed',
  started_at  TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, strategy_id)
);

CREATE TABLE IF NOT EXISTS elite_moves_feed (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID REFERENCES users(id) ON DELETE CASCADE,
  user_initials       TEXT,
  user_city           TEXT,
  user_state          TEXT,
  strategy_used       TEXT,
  result_description  TEXT,
  days_to_result      INTEGER,
  is_example          BOOLEAN DEFAULT false,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wealth_calculator_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  heloc_potential NUMERIC,
  projection_data JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_wealth_assessments_user ON wealth_assessments(user_id);
CREATE INDEX IF NOT EXISTS idx_wealth_playbooks_user ON wealth_playbooks(user_id);
CREATE INDEX IF NOT EXISTS idx_wealth_scores_user ON wealth_scores(user_id);
CREATE INDEX IF NOT EXISTS idx_strategy_progress_user ON strategy_progress(user_id);
