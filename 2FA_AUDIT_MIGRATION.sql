-- ─── VEORI: Audit Logs + 2FA Migration ───────────────────────────────────────
-- Run this in your Supabase SQL editor before deploying the 2FA update.

-- ─── 1. Audit Logs Table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  resource    TEXT,
  metadata    JSONB DEFAULT '{}',
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id   ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action    ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created   ON audit_logs(created_at DESC);

-- ─── 2. Add 2FA Columns to Users ─────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS two_fa_enabled  BOOLEAN     DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS two_fa_method   TEXT,        -- 'totp' | 'sms' | 'email'
  ADD COLUMN IF NOT EXISTS two_fa_secret   TEXT,        -- TOTP secret (base32)
  ADD COLUMN IF NOT EXISTS two_fa_phone    TEXT;        -- phone for SMS 2FA

-- ─── 3. OTP Codes Table (SMS + Email one-time codes) ─────────────────────────
CREATE TABLE IF NOT EXISTS otp_codes (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT        NOT NULL,
  purpose    TEXT        NOT NULL DEFAULT '2fa',
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN     DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_otp_codes_user_id ON otp_codes(user_id);

-- ─── 4. RLS: audit_logs readable only by admins (service role bypasses RLS) ──
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "service_role_only" ON audit_logs
  USING (false);   -- no direct client reads; backend uses service role

-- ─── 5. RLS: otp_codes - no direct client access ─────────────────────────────
ALTER TABLE otp_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "service_role_only" ON otp_codes
  USING (false);
