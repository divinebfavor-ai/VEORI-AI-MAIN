-- ─── Operator Phone Numbers: billing, lifecycle, multi-number foundation
-- Run in Supabase SQL Editor

-- Add billing + lifecycle columns to phone_numbers
ALTER TABLE phone_numbers
  ADD COLUMN IF NOT EXISTS monthly_cost    NUMERIC       DEFAULT 2.15,
  ADD COLUMN IF NOT EXISTS purchased_at   TIMESTAMPTZ   DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS released_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_primary     BOOLEAN       DEFAULT false,
  ADD COLUMN IF NOT EXISTS release_reason TEXT;

-- Ensure only one primary number per operator
CREATE UNIQUE INDEX IF NOT EXISTS idx_phone_numbers_user_primary
  ON phone_numbers(user_id) WHERE is_primary = true AND released_at IS NULL;

-- Index for fast active-number lookups
CREATE INDEX IF NOT EXISTS idx_phone_numbers_active
  ON phone_numbers(user_id, is_active, released_at);
