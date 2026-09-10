-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-09-10 — Critical integrity + scale migration
--
-- Fixes three classes of defect found in the pre-launch audit:
--   1. Tables/functions the application CODE ALREADY CALLS but which were never
--      defined in any migration. These are live failure paths today.
--   2. Non-atomic usage metering that lets paid limits be exceeded.
--   3. Missing indexes on the hot multi-tenant sort paths.
--
-- Safe to run more than once: every statement is guarded.
-- Run this BEFORE the accompanying application deploy.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. processed_transactions  — MISSING, AND ALREADY REFERENCED BY BILLING CODE
--
-- src/routes/flutterwaveBilling.js claims idempotency at lines 512, 741, 933 and
-- 1006 by INSERTing here and treating unique-violation (23505) as "already
-- handled". With no such table the insert fails with a DIFFERENT error code, so
-- the claim is never recognised: /verify returns 500 and the webhook returns 500
-- forever — the customer is charged and never activated.
--
-- The UNIQUE constraint is the whole point; without it both the redirect path
-- and the webhook path run and the subscription is provisioned twice.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.processed_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        TEXT NOT NULL,                 -- 'flutterwave' | 'stripe'
  transaction_id  TEXT NOT NULL,
  user_id         UUID REFERENCES public.users(id) ON DELETE SET NULL,
  kind            TEXT,                          -- 'subscription' | 'topup' | ...
  amount          NUMERIC(12,2),
  currency        TEXT,
  metadata        JSONB,
  processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The idempotency guarantee. A repeated (provider, transaction_id) raises 23505,
-- which is exactly what the billing code catches.
CREATE UNIQUE INDEX IF NOT EXISTS uq_processed_transactions_provider_txid
  ON public.processed_transactions (provider, transaction_id);

CREATE INDEX IF NOT EXISTS idx_processed_transactions_user
  ON public.processed_transactions (user_id, processed_at DESC);


-- ───────────────────────────────────────────────────────────────────────────
-- 2. referral_payments.idempotency_key — COLUMN MISSING, ALREADY WRITTEN TO
--
-- src/routes/referrals.js writes `idempotency_key` at lines 372 and 442, but
-- migrations/referrals.sql never defined the column. Either the insert errors
-- (and commissions silently never pay) or — if the column was hand-added without
-- a unique index — every Flutterwave webhook RETRY re-credits the referrer.
-- Payouts are auto-wired to a real transfer, so that is duplicated real money.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.referral_payments
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- Partial unique index: pre-existing rows with NULL keys stay valid, while any
-- two rows that DO carry the same key collide.
CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_payments_idempotency_key
  ON public.referral_payments (idempotency_key)
  WHERE idempotency_key IS NOT NULL;


-- ───────────────────────────────────────────────────────────────────────────
-- 3. increment_calls_used() — RPC MISSING, ALREADY CALLED
--
-- src/services/campaignManager.js:275 calls this RPC and, on error, falls back
-- to a read-modify-write. Because the function does not exist, EVERY dial takes
-- the racy fallback: N concurrent dials all read the same calls_used and all
-- write used+1, so the counter advances by one no matter how many calls were
-- placed. A user can dial far past a paid monthly limit.
--
-- A single UPDATE ... RETURNING is atomic under Postgres row locking, so
-- concurrent callers serialise correctly.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.increment_calls_used(
  p_user_id UUID,
  p_amount  INTEGER DEFAULT 1
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_value INTEGER;
BEGIN
  UPDATE public.users
     SET calls_used = COALESCE(calls_used, 0) + p_amount
   WHERE id = p_user_id
  RETURNING calls_used INTO new_value;

  RETURN new_value;   -- NULL when no such user
END;
$$;

-- Generic atomic counter for the other meters that share the same race
-- (ai_messages_used, outreach credits, and anything added later).
CREATE OR REPLACE FUNCTION public.increment_user_counter(
  p_user_id UUID,
  p_column  TEXT,
  p_amount  INTEGER DEFAULT 1
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_value INTEGER;
BEGIN
  -- Allow-list the column name: it is interpolated into dynamic SQL, so it must
  -- never come straight from a caller.
  IF p_column NOT IN ('calls_used', 'ai_messages_used', 'free_calls_today', 'overage_dials_used') THEN
    RAISE EXCEPTION 'increment_user_counter: column % is not permitted', p_column;
  END IF;

  EXECUTE format(
    'UPDATE public.users SET %I = COALESCE(%I, 0) + $2 WHERE id = $1 RETURNING %I',
    p_column, p_column, p_column
  )
  INTO new_value
  USING p_user_id, p_amount;

  RETURN new_value;
END;
$$;


-- ───────────────────────────────────────────────────────────────────────────
-- 4. Hot-path indexes
--
-- These back the two most-run queries in the product. Without them each request
-- sorts the caller's whole partition.
--
-- NOTE ON LOCKING: plain CREATE INDEX takes a write lock for the duration. On
-- the current data volume that is instant. If these tables have already grown
-- large, run the CONCURRENTLY variants noted below instead — they cannot run
-- inside a transaction block, so send them one at a time.
-- ───────────────────────────────────────────────────────────────────────────

-- GET /api/calls  → WHERE user_id = ? ORDER BY created_at DESC
-- (calls had indexes on user_id, lead_id, vapi_id and status — but nothing on
--  created_at or started_at, which is what it actually sorts by.)
CREATE INDEX IF NOT EXISTS idx_calls_user_created
  ON public.calls (user_id, created_at DESC);
-- CONCURRENTLY variant:
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_calls_user_created ON public.calls (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_calls_lead_started
  ON public.calls (lead_id, started_at ASC);

-- Nightly analytics rollup scans calls by created_at across ALL tenants.
CREATE INDEX IF NOT EXISTS idx_calls_created_at
  ON public.calls (created_at DESC);

-- GET /api/leads → WHERE user_id = ? ORDER BY motivation_score DESC, created_at DESC
CREATE INDEX IF NOT EXISTS idx_leads_user_score_created
  ON public.leads (user_id, motivation_score DESC NULLS LAST, created_at DESC);

-- The per-lead timeline and intelligence views fan out on lead_id.
CREATE INDEX IF NOT EXISTS idx_sms_messages_lead_sent
  ON public.sms_messages (lead_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_deal_activity_lead_created
  ON public.deal_activity (lead_id, created_at DESC);


-- ───────────────────────────────────────────────────────────────────────────
-- 5. Subscription expiry lookups
--
-- The application now enforces subscription_expires_at (it was previously
-- written but never read). A nightly lapse sweep needs this index.
-- ───────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_subscription_expiry
  ON public.users (subscription_status, subscription_expires_at)
  WHERE subscription_status = 'active';
