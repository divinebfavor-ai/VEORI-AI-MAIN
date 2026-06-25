-- ═══════════════════════════════════════════════════════════════════════════
-- Email Engagement + Deliverability — Resend event ingestion (Tier 1)
-- ADDITIVE ONLY. Idempotent. No data loss. Run manually in Supabase SQL editor.
--
-- WHY: Veori sends email via Resend but captures NO engagement. The #1 cold-email
-- complaint in 2026 is "reply rates flatline and I can't see why." Google/Yahoo
-- also reject senders whose spam-complaint rate crosses 0.3%. To stay measurable
-- AND compliant, we ingest Resend webhook events (delivered/opened/clicked/
-- bounced/complained) and AUTO-SUPPRESS hard bounces + complaints.
--
-- This migration:
--   1. Adds engagement timestamp columns to email_log (all NULLable, no default
--      change → existing rows + existing inserts are byte-for-byte unaffected).
--   2. Adds message_id so a Resend event can be correlated back to its send row.
--   3. Indexes message_id for fast webhook lookups.
-- ═══════════════════════════════════════════════════════════════════════════

-- 0. Self-heal: create email_log if it was never applied to this database
--    (some Supabase projects never ran the root schema.sql). IF NOT EXISTS → an
--    existing table is left byte-for-byte untouched.
CREATE TABLE IF NOT EXISTS email_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid,
  lead_id    uuid,
  deal_id    uuid,
  to_email   text NOT NULL,
  subject    text NOT NULL,
  body       text,
  email_type text,
  sent_at    timestamptz DEFAULT now(),
  status     text DEFAULT 'sent',
  error      text
);

-- 1 + 2. Engagement columns on the existing send log. IF NOT EXISTS → safe to
--        re-run; never drops or rewrites an existing column.
ALTER TABLE email_log ADD COLUMN IF NOT EXISTS message_id   text;
ALTER TABLE email_log ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
ALTER TABLE email_log ADD COLUMN IF NOT EXISTS opened_at    timestamptz;
ALTER TABLE email_log ADD COLUMN IF NOT EXISTS clicked_at   timestamptz;
ALTER TABLE email_log ADD COLUMN IF NOT EXISTS bounced_at   timestamptz;
ALTER TABLE email_log ADD COLUMN IF NOT EXISTS complained_at timestamptz;
ALTER TABLE email_log ADD COLUMN IF NOT EXISTS open_count   integer DEFAULT 0;
ALTER TABLE email_log ADD COLUMN IF NOT EXISTS click_count  integer DEFAULT 0;

-- 3. The webhook correlates an inbound event to a send by Resend message id.
CREATE INDEX IF NOT EXISTS idx_email_log_message_id ON email_log (message_id);

-- Helpful for the analytics surface (per-operator engagement rollups).
CREATE INDEX IF NOT EXISTS idx_email_log_user_sent ON email_log (user_id, sent_at);
