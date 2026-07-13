-- VEORI AI - Twilio subaccount provisioning (Solo tier and above)
-- Additive only. Safe to run repeatedly.
--
-- Every Solo-and-above customer gets their OWN isolated Twilio subaccount so their
-- numbers, messaging, A2P registration and usage are fully separated from every other
-- customer and from the Veori master account. We store the subaccount SID (and status)
-- against the user record. Starter accounts do NOT get a subaccount.

ALTER TABLE users ADD COLUMN IF NOT EXISTS twilio_subaccount_sid           TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS twilio_subaccount_status        TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS twilio_subaccount_friendly_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS twilio_subaccount_created_at     TIMESTAMPTZ;

-- One subaccount per customer: the SID must be unique across users (ignores NULLs).
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_twilio_subaccount_sid
  ON users(twilio_subaccount_sid) WHERE twilio_subaccount_sid IS NOT NULL;
