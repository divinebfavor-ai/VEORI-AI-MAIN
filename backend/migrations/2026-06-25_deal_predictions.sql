-- ─────────────────────────────────────────────────────────────────────────────
-- AI DEAL PREDICTION ENGINE — audit log table (Rule 6: log every prediction).
--
-- WHY:
--   The new predictionEngine.predict() fuses every existing scorer (detectStrategy,
--   suggestAssignmentFee, calculateSourcingScore, motivation_score) into ONE
--   prediction per lead/deal, with per-field confidence + evidence. The
--   GET /api/leads/:id/prediction endpoint persists each run here so the operator
--   has a queryable history of what Veori predicted, when, and on what evidence —
--   and so future model tuning can compare predictions to real outcomes.
--
-- SAFETY: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS — additive,
-- idempotent, no drops, no data loss. The endpoint writes here BEST-EFFORT: if this
-- migration hasn't been run yet, the prediction still returns; only the audit log
-- is skipped. Run this once in the Supabase SQL editor to enable logging.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS deal_predictions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID,                       -- owning operator (scoped per user)
  lead_id            UUID REFERENCES leads(id) ON DELETE CASCADE,
  deal_id            UUID REFERENCES deals(id) ON DELETE SET NULL,
  overall_confidence INTEGER,                     -- 0..100 fused confidence
  escalate           BOOLEAN DEFAULT FALSE,       -- Rule 4: below-threshold flag
  best_next_action   TEXT,                        -- Rule 5: the recommended action key
  predictions        JSONB,                       -- per-field { value, confidence, evidence[] }
  evidence           JSONB,                       -- flat evidence stream (Rule 2)
  strategy           JSONB,                       -- { primary, confidence, ranked[] }
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- Idempotent guards in case an older/partial deal_predictions table already exists.
ALTER TABLE deal_predictions
  ADD COLUMN IF NOT EXISTS user_id            UUID,
  ADD COLUMN IF NOT EXISTS lead_id            UUID,
  ADD COLUMN IF NOT EXISTS deal_id            UUID,
  ADD COLUMN IF NOT EXISTS overall_confidence INTEGER,
  ADD COLUMN IF NOT EXISTS escalate           BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS best_next_action   TEXT,
  ADD COLUMN IF NOT EXISTS predictions        JSONB,
  ADD COLUMN IF NOT EXISTS evidence           JSONB,
  ADD COLUMN IF NOT EXISTS strategy           JSONB,
  ADD COLUMN IF NOT EXISTS created_at         TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_deal_predictions_lead    ON deal_predictions(lead_id);
CREATE INDEX IF NOT EXISTS idx_deal_predictions_user    ON deal_predictions(user_id);
CREATE INDEX IF NOT EXISTS idx_deal_predictions_created ON deal_predictions(created_at DESC);
