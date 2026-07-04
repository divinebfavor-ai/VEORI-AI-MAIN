-- ─── Paddle Billing Columns ────────────────────────────────────────────────────
-- Run this in Supabase SQL Editor (safe - only ADDs columns if missing)
-- Adds paddle_customer_id and paddle_subscription_id to the users table

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS paddle_customer_id      TEXT,
  ADD COLUMN IF NOT EXISTS paddle_subscription_id  TEXT;

-- Index for fast webhook lookups
CREATE INDEX IF NOT EXISTS idx_users_paddle_customer_id     ON public.users (paddle_customer_id);
CREATE INDEX IF NOT EXISTS idx_users_paddle_subscription_id ON public.users (paddle_subscription_id);
