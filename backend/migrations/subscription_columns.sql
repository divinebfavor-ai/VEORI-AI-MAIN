-- ─── Subscription columns on users table ─────────────────────────────────────
-- Required for Flutterwave billing to work

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS subscription_plan        TEXT    DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS subscription_status      TEXT    DEFAULT 'inactive',
  ADD COLUMN IF NOT EXISTS monthly_dial_limit       INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fw_customer_id           TEXT,
  ADD COLUMN IF NOT EXISTS fw_subscription_id       TEXT,
  ADD COLUMN IF NOT EXISTS subscription_expires_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_subscription_plan   ON public.users (subscription_plan);
CREATE INDEX IF NOT EXISTS idx_users_subscription_status ON public.users (subscription_status);
CREATE INDEX IF NOT EXISTS idx_users_fw_customer         ON public.users (fw_customer_id);
