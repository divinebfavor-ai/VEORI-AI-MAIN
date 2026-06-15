-- ============================================================================
-- TOP-UP + OUTREACH-METER SYSTEM  (Phase 1)
-- Additive only. Does NOT touch the existing dial meter
-- (calls_used / monthly_dial_limit / dials_reset_date / overage_* ).
--
-- Two meters now exist, by design:
--   * DIAL meter   : calls_used / monthly_dial_limit      -> AI calls (existing)
--   * OUTREACH meter: outreach_used / monthly_allocation  -> lead-outreach SMS (new)
--
-- 1 outbound lead-outreach SMS (opening SMS + AI outreach replies) = 1 outreach credit.
-- Transactional/compliance SMS (2FA OTP, opt-out confirmations, manual operator
-- replies) are NOT metered and are never blocked.
--
-- Consumption order: monthly_allocation first, then topup_credits_available.
-- Top-up credits EXPIRE at billing-cycle reset (do not roll over).
--
-- RUN THIS MANUALLY. Review the backfill block at the bottom before running.
-- ============================================================================

-- ── New outreach meter ──────────────────────────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS monthly_allocation   INTEGER DEFAULT 0,   -- outreach credits granted by plan/month
  ADD COLUMN IF NOT EXISTS outreach_used        INTEGER DEFAULT 0,   -- outreach SMS sent this cycle
  ADD COLUMN IF NOT EXISTS outreach_reset_date  DATE;                -- YYYY-MM-01 rollover marker (mirrors dials_reset_date)

-- ── Top-up tracking ─────────────────────────────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS topup_credits_available    INTEGER       DEFAULT 0,
  ADD COLUMN IF NOT EXISTS topup_credits_used         INTEGER       DEFAULT 0,
  ADD COLUMN IF NOT EXISTS topup_purchases_this_cycle INTEGER       DEFAULT 0,
  ADD COLUMN IF NOT EXISTS topup_spend_this_cycle     NUMERIC(10,2) DEFAULT 0.00;

-- ── Notification de-dupe flags (fire-once per cycle) ────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS notified_at_80_percent  BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS notified_at_95_percent  BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS notified_at_100_percent BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS notified_topup_expiry   BOOLEAN DEFAULT FALSE,
  -- TRUE => outreach hard-paused because all credits are exhausted this cycle.
  ADD COLUMN IF NOT EXISTS outreach_paused         BOOLEAN DEFAULT FALSE;

-- ── Top-up purchase history (also the webhook idempotency surface) ──────────
CREATE TABLE IF NOT EXISTS public.topup_purchases (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id       UUID REFERENCES public.users(id),
  plan_id           TEXT NOT NULL,            -- plan key at time of purchase (starter..enterprise)
  block_size        INTEGER NOT NULL,         -- outreach credits in this block
  blocks            INTEGER NOT NULL DEFAULT 1,
  price_paid        NUMERIC(10,2) NOT NULL,   -- USD actually charged (after multi-block discount)
  credits_added     INTEGER NOT NULL,         -- block_size * blocks
  purchased_at      TIMESTAMPTZ DEFAULT NOW(),
  billing_cycle_id  TEXT NOT NULL,            -- YYYY-MM the credits belong to (expire at next reset)
  flutterwave_tx_id TEXT,
  status            TEXT DEFAULT 'active'      -- active | expired | refunded
);

CREATE INDEX IF NOT EXISTS idx_topup_purchases_operator ON public.topup_purchases (operator_id);
-- Idempotency guard: one row per Flutterwave transaction (NULLs allowed for manual grants).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_topup_fw_tx
  ON public.topup_purchases (flutterwave_tx_id)
  WHERE flutterwave_tx_id IS NOT NULL;

-- ── BACKFILL: seed monthly_allocation from each user's current plan ─────────
-- Mirrors PLANS[plan].outreach in flutterwaveBilling.js. Review before running.
-- Only seeds active subscribers; leaves free/inactive at 0.
UPDATE public.users SET monthly_allocation = CASE subscription_plan
    WHEN 'starter'    THEN 10000
    WHEN 'solo'       THEN 25000
    WHEN 'operator'   THEN 50000
    WHEN 'scale'      THEN 100000
    WHEN 'enterprise' THEN 200000
    ELSE monthly_allocation
  END
  WHERE subscription_status = 'active'
    AND subscription_plan IN ('starter','solo','operator','scale','enterprise');

-- Initialize the outreach reset marker to the current month for active subs so the
-- first rollover detection works (mirrors dials_reset_date convention YYYY-MM-01).
UPDATE public.users
  SET outreach_reset_date = date_trunc('month', NOW())::date
  WHERE subscription_status = 'active'
    AND outreach_reset_date IS NULL;
