-- ─────────────────────────────────────────────────────────────────────────────
-- MULTI-STRATEGY ENGINE — make Veori cover every way investors buy houses, not
-- just cash/wholesale. Adds the columns the strategy detector, per-strategy call
-- scripts, and the creative-finance calculator need to persist what they learn.
--
-- WHY:
--   1. deals.deal_type is SENT by the create route (routes/deals.js) and referenced
--      by the activity log, but the column never existed on `deals` — so it was
--      silently dropped on every insert. This adds it (default 'assignment' = the
--      current implicit wholesale behavior) so the value finally lands.
--   2. leads needs creative-finance signal columns (mortgage balance, payment,
--      rate, arrears, loan type) so the detector can tell a Subject-To / Seller-
--      Finance lead apart from a cash flip, and store its verdict
--      (detected_strategy / strategy_confidence).
--   3. The data-moat tables (winning_playbooks, conversation_patterns,
--      market_anchors) gain a `strategy` dimension so learnings are keyed by
--      strategy as well as tag + state.
--
-- ALL ADD COLUMN IF NOT EXISTS — additive, nullable, idempotent, no drops, no data
-- loss. Every existing row keeps its current behavior:
--   * cash/wholesale is the default everywhere (deal_type defaults 'assignment';
--     detected_strategy null == cash fallback in code).
--   * mortgage_balance is added IF NOT EXISTS, so it's safe whether or not the
--     column already exists on leads.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. deals — fix the silent-drop bug + carry per-strategy terms.
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS deal_type       text   DEFAULT 'assignment',  -- assignment | subject_to | seller_finance | lease_option | novation
  ADD COLUMN IF NOT EXISTS strategy_terms  jsonb;                        -- structured creative terms (down, monthly, rate, term, balloon, entry fee, arrears…)

-- 2. leads — creative-finance signals + the detector's verdict.
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS mortgage_balance     numeric,   -- outstanding loan balance (drives Subject-To math)
  ADD COLUMN IF NOT EXISTS est_monthly_payment  numeric,   -- PITI / monthly payment (take-over-payments framing)
  ADD COLUMN IF NOT EXISTS interest_rate        numeric,   -- existing loan rate (low rate = strong Subject-To)
  ADD COLUMN IF NOT EXISTS arrears_amount       numeric,   -- $ behind / in default (reinstatement amount)
  ADD COLUMN IF NOT EXISTS loan_type            text,      -- conventional | fha | va | private | none (free & clear)
  ADD COLUMN IF NOT EXISTS detected_strategy    text,      -- detector verdict: cash | subject_to | seller_finance | lease_option
  ADD COLUMN IF NOT EXISTS strategy_confidence  int;       -- 0–100 confidence from detectStrategy()

-- 3. Data moat — add a strategy dimension to the learning tables. Each guarded so
--    a missing table (depending on which intelligence migration has run) doesn't
--    abort the whole script.
DO $$
BEGIN
  IF to_regclass('public.winning_playbooks') IS NOT NULL THEN
    ALTER TABLE winning_playbooks     ADD COLUMN IF NOT EXISTS strategy text;
  END IF;
  IF to_regclass('public.conversation_patterns') IS NOT NULL THEN
    ALTER TABLE conversation_patterns ADD COLUMN IF NOT EXISTS strategy text;
  END IF;
  IF to_regclass('public.market_anchors') IS NOT NULL THEN
    ALTER TABLE market_anchors        ADD COLUMN IF NOT EXISTS strategy text;
  END IF;
END $$;

-- Index the detector verdict so strategy-filtered lead views don't full-scan.
CREATE INDEX IF NOT EXISTS leads_detected_strategy_idx
  ON leads (detected_strategy)
  WHERE detected_strategy IS NOT NULL;
