-- Usage-pipeline state for the 5-plan dial meter.
-- Additive only. Does not touch existing quota columns
-- (calls_used, monthly_dial_limit, calls_limit, dials_reset_date).
--
-- Pure pipeline / usage-visibility. NO cost or billing math here.
--
-- Behavior wired in code (backend/src/routes/calls.js):
--   * When calls_used >= monthly_dial_limit:
--       - overage_enabled = FALSE  -> hard block (current behavior, unchanged)
--       - overage_enabled = TRUE   -> allow the dial, increment overage_dials_used
--   * last_usage_warning_pct lets the 80/95% warning fire once per threshold
--     per month instead of on every call. Reset alongside dials_reset_date
--     (handled in campaignManager.js month rollover).

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS overage_enabled         BOOLEAN  DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS overage_dials_used      INTEGER  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_usage_warning_pct  INTEGER  DEFAULT 0;
