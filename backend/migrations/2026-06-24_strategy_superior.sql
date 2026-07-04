-- ─────────────────────────────────────────────────────────────────────────────
-- SUPERIOR STRATEGY ENGINE - auto-pick the BEST acquisition strategy per lead,
-- rank the fallbacks, and let the operator override the pick manually. Builds on
-- 2026-06-23_multi_strategy.sql (run that first if you haven't).
--
-- WHY:
--   1. detectStrategy() now scores EVERY strategy (cash, subject_to, seller_finance,
--      lease_option, novation) and returns a ranked list. tagLead persists that list
--      so the lead page can show "best play + fallbacks" and the call prompt can name
--      a PRIMARY and a FALLBACK. → strategy_ranked (jsonb).
--   2. The operator can override the auto-pick. Manual choice wins over the detector
--      in resolveStrategy() (vapiService). → strategy_override (text).
--
-- ALL ADD COLUMN IF NOT EXISTS - additive, nullable, idempotent, no drops, no data
-- loss. Existing rows keep current behavior: strategy_override null == use the
-- auto-detected strategy; detected_strategy null == cash fallback in code.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS strategy_override  text,   -- operator's manual pick: cash | subject_to | seller_finance | lease_option | novation. Wins over detected_strategy.
  ADD COLUMN IF NOT EXISTS strategy_ranked    jsonb;  -- detector's full ranking: [{ strategy, confidence, reason }, …] sorted best-first.
