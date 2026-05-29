-- ─── Flutterwave Billing Columns ──────────────────────────────────────────────
-- Adds Flutterwave-specific fields to users table

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS fw_customer_id       TEXT,
  ADD COLUMN IF NOT EXISTS fw_subscription_id   TEXT,
  ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_fw_customer ON public.users (fw_customer_id);
