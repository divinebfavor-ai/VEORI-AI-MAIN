-- User geo and analytics columns
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS country       TEXT,
  ADD COLUMN IF NOT EXISTS country_code  TEXT,
  ADD COLUMN IF NOT EXISTS region        TEXT,
  ADD COLUMN IF NOT EXISTS city          TEXT,
  ADD COLUMN IF NOT EXISTS timezone      TEXT,
  ADD COLUMN IF NOT EXISTS signup_source TEXT,
  ADD COLUMN IF NOT EXISTS device_type   TEXT,
  ADD COLUMN IF NOT EXISTS last_seen_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_country ON public.users (country_code);
