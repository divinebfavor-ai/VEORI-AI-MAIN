-- ═══════════════════════════════════════════════════════════════════════════
-- Feature C - Email Campaigns: opt-out / suppression (CAN-SPAM compliance)
-- ADDITIVE ONLY. Idempotent. No data loss. Run manually in Supabase SQL editor.
--
-- WHY: Veori already sends email via Resend (emailService.js) and runs
-- multi-channel drips (sequenceEngine.js), but there is NO email unsubscribe
-- anywhere. CAN-SPAM requires a working opt-out. These two tables add it:
--   • email_suppressions   - per-operator do-not-email list (checked before send)
--   • email_optout_tokens   - one-click unsubscribe links emailed in every drip
-- ═══════════════════════════════════════════════════════════════════════════

-- Per-operator suppression list. A send is blocked when (user_id, lower(email))
-- exists here. Reason is free-text ('unsubscribe', 'bounce', 'complaint', etc).
CREATE TABLE IF NOT EXISTS email_suppressions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  email       text NOT NULL,
  lead_id     uuid,
  reason      text DEFAULT 'unsubscribe',
  created_at  timestamptz DEFAULT now(),
  UNIQUE (user_id, email)
);

CREATE INDEX IF NOT EXISTS idx_email_suppressions_user_email
  ON email_suppressions (user_id, lower(email));

-- One-click unsubscribe tokens. Each outbound drip email embeds a link with one
-- of these tokens; hitting the public route suppresses the address.
CREATE TABLE IF NOT EXISTS email_optout_tokens (
  token       text PRIMARY KEY,
  user_id     uuid NOT NULL,
  lead_id     uuid,
  email       text NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_optout_tokens_email
  ON email_optout_tokens (lower(email));
