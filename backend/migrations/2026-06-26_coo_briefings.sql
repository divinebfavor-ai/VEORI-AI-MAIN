-- ─────────────────────────────────────────────────────────────────────────────
-- AI COO COMMAND CENTER - audit log for the fused 4-answer briefing.
--
-- WHY:
--   GET /api/coo/briefing fuses every existing engine (predictionEngine across the
--   pipeline, plus raw lead/deal/call/follow-up rows) into ONE view answering the
--   operator's four standing questions: What's happening / Why / What's next /
--   What to do now. This table logs each generated briefing (Rule 6: every action
--   logged) so the operator has a history of what the COO saw and recommended, and
--   so we can later compare recommendations to outcomes.
--
-- SAFETY: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS - additive,
-- idempotent, no drops, no data loss. The route writes here BEST-EFFORT: if this
-- migration hasn't run, the briefing still returns; only the audit log is skipped.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS coo_briefings (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID,            -- owning operator (scoped per user)
  headline             TEXT,            -- one-line pipeline snapshot
  what_is_happening    JSONB,           -- Q1: factual counts
  why_is_it_happening  JSONB,           -- Q2: ranked bottlenecks + evidence
  what_happens_next    JSONB,           -- Q3: pipeline EV forecast, about-to-close, at-risk
  what_to_do_now       JSONB,           -- Q4: EV-sorted action queue + escalations
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

-- Idempotent guards in case an older/partial table already exists.
ALTER TABLE coo_briefings
  ADD COLUMN IF NOT EXISTS user_id             UUID,
  ADD COLUMN IF NOT EXISTS headline            TEXT,
  ADD COLUMN IF NOT EXISTS what_is_happening   JSONB,
  ADD COLUMN IF NOT EXISTS why_is_it_happening JSONB,
  ADD COLUMN IF NOT EXISTS what_happens_next   JSONB,
  ADD COLUMN IF NOT EXISTS what_to_do_now      JSONB,
  ADD COLUMN IF NOT EXISTS created_at          TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_coo_briefings_user    ON coo_briefings(user_id);
CREATE INDEX IF NOT EXISTS idx_coo_briefings_created ON coo_briefings(created_at DESC);
