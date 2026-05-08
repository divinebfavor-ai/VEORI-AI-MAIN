-- ─── Veori Wealth Playbook — Supabase Migration ──────────────────────────────
-- Run this in your Supabase SQL Editor: https://supabase.com/dashboard/project/xqllxyoeftkbufoungcz/sql

CREATE TABLE IF NOT EXISTS wealth_assessments (
  assessment_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL,
  home_ownership TEXT,
  equity_position TEXT,
  debt_situation TEXT,
  real_estate_goal TEXT,
  experience_level TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS wealth_playbooks (
  playbook_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL,
  headline          TEXT,
  summary           TEXT,
  primary_strategy  TEXT,
  strategies        JSONB,
  wealth_projection JSONB,
  first_action      TEXT,
  generated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS wealth_scores (
  score_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL,
  score             INTEGER DEFAULT 0,
  score_tier        TEXT DEFAULT 'Learner',
  actions_completed JSONB DEFAULT '[]',
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS strategy_progress (
  progress_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL,
  strategy_id  TEXT NOT NULL,
  status       TEXT DEFAULT 'not_started',
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  notes        TEXT,
  UNIQUE(user_id, strategy_id)
);

CREATE TABLE IF NOT EXISTS elite_moves_feed (
  move_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_initials      TEXT NOT NULL,
  user_city          TEXT,
  user_state         TEXT,
  strategy_used      TEXT NOT NULL,
  result_description TEXT NOT NULL,
  days_to_result     INTEGER,
  is_example         BOOLEAN DEFAULT FALSE,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wealth_calculator_sessions (
  session_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID,
  home_value         NUMERIC,
  mortgage_balance   NUMERIC,
  monthly_income     NUMERIC,
  monthly_expenses   NUMERIC,
  current_savings    NUMERIC,
  monthly_investment NUMERIC,
  investment_goal    TEXT,
  heloc_potential    NUMERIC,
  projection_data    JSONB,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE wealth_assessments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE wealth_playbooks          ENABLE ROW LEVEL SECURITY;
ALTER TABLE wealth_scores             ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_progress         ENABLE ROW LEVEL SECURITY;
ALTER TABLE wealth_calculator_sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies (service role bypasses these — they protect direct client access)
CREATE POLICY "Users can manage own assessment"   ON wealth_assessments        FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own playbook"     ON wealth_playbooks          FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own score"        ON wealth_scores             FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own progress"     ON strategy_progress         FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own calculator"   ON wealth_calculator_sessions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Anyone can read elite feed"        ON elite_moves_feed          FOR SELECT USING (true);
