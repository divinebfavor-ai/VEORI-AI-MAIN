-- VEORI AI - Account review + Starter upgrade flags
-- Additive only. Safe to run repeatedly (IF NOT EXISTS on every column).
-- Nothing here changes existing rows or behavior until the admin manually sets a flag.

-- ─── Feature 1: "deal closed" flag on Starter accounts (manual, admin-settable) ───
-- When an admin sets starter_deal_closed = true on a Starter account, the app shows
-- that operator an in-app prompt inviting them to upgrade to Solo. No calendar cutoff:
-- the ONLY trigger is this manual flag.
ALTER TABLE users ADD COLUMN IF NOT EXISTS starter_deal_closed     BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS starter_deal_closed_at  TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS starter_deal_closed_by  UUID REFERENCES users(id);

-- ─── Feature 2: engagement flag for manual founder review ───
-- Set true when an account is >= 3 full months old and has shown zero hot leads AND
-- zero inbound responses. This flag is for HUMAN review only: it never suspends the
-- account and never messages the operator.
ALTER TABLE users ADD COLUMN IF NOT EXISTS needs_founder_review      BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS founder_review_reason     TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS founder_review_flagged_at TIMESTAMPTZ;

-- Fast lookup of accounts awaiting founder review.
CREATE INDEX IF NOT EXISTS idx_users_needs_founder_review
  ON users(needs_founder_review) WHERE needs_founder_review = true;
