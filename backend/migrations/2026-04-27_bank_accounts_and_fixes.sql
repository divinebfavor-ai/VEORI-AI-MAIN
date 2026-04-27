-- ─── 2026-04-27: bank_accounts table + phone_numbers column fixes
-- Run in Supabase SQL Editor

-- ─── Bank accounts ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bank_accounts (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                   UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  label                     TEXT NOT NULL DEFAULT 'Primary',
  bank_name                 TEXT NOT NULL,
  account_holder_name       TEXT NOT NULL,
  account_type              TEXT NOT NULL DEFAULT 'Checking',
  routing_number_encrypted  TEXT,
  account_number_encrypted  TEXT,
  routing_last4             TEXT,
  account_last4             TEXT,
  bank_address              TEXT,
  swift_code                TEXT,
  additional_instructions   TEXT,
  is_default                BOOLEAN NOT NULL DEFAULT false,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_user_id ON bank_accounts(user_id);

-- ─── Phone numbers: add missing columns ──────────────────────────────────────
ALTER TABLE phone_numbers
  ADD COLUMN IF NOT EXISTS friendly_name       TEXT,
  ADD COLUMN IF NOT EXISTS area_code           TEXT,
  ADD COLUMN IF NOT EXISTS carrier             TEXT,
  ADD COLUMN IF NOT EXISTS daily_call_limit    INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS vapi_phone_number_id TEXT;

CREATE INDEX IF NOT EXISTS idx_phone_numbers_user_id  ON phone_numbers(user_id);
CREATE INDEX IF NOT EXISTS idx_phone_numbers_vapi_id  ON phone_numbers(vapi_phone_number_id);
