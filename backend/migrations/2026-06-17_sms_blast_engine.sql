-- ============================================================================
-- HEAVY-SCALE SMS BLAST ENGINE  (Phase 1)
-- Additive only. Does NOT change existing SMS, voice, or metering behavior.
--
-- Adds:
--   * Per-number SMS throttle + rotation bookkeeping on phone_numbers
--     (mirrors the existing voice columns daily_calls_made / daily_call_limit /
--      last_reset_date, but for SMS — so the SMS rotator can spread load across
--      numbers and respect carrier-safe daily caps).
--   * sms_dead_letter — forensics + manual-replay surface for permanently failed
--     queued sends (after BullMQ exhausts retries).
--   * sms_first_leads.enqueue_job_id — ties a queued row to its BullMQ job for
--     idempotency / cancellation.
--   * buyer_campaigns counters (sms_sent / sms_replies) for the dispo blast.
--
-- RUN THIS MANUALLY in the Supabase SQL editor. Review before running.
-- ============================================================================

-- ── Per-number SMS throttle + rotation bookkeeping ──────────────────────────
-- Real phone_numbers columns in use today: number, is_toll_free, is_active,
-- user_id, last_used, released_at, health_status. These are NEW and SMS-only;
-- they do not touch the voice dialer's daily_calls_made / daily_call_limit.
ALTER TABLE public.phone_numbers
  ADD COLUMN IF NOT EXISTS sms_enabled         BOOLEAN     DEFAULT TRUE,   -- include this number in SMS rotation
  ADD COLUMN IF NOT EXISTS sms_daily_limit     INTEGER     DEFAULT 1000,   -- carrier-safe daily ceiling per number
  ADD COLUMN IF NOT EXISTS sms_sent_today      INTEGER     DEFAULT 0,      -- SMS sent today on this number
  ADD COLUMN IF NOT EXISTS sms_last_reset_date DATE,                        -- when sms_sent_today was last zeroed
  ADD COLUMN IF NOT EXISTS sms_last_used_at    TIMESTAMPTZ;                 -- LRU marker for fair rotation

-- Fast "next eligible sender" lookup: an operator's SMS-enabled, active,
-- non-released numbers, least-recently-used first.
CREATE INDEX IF NOT EXISTS idx_phone_numbers_sms_rotation
  ON public.phone_numbers (user_id, sms_enabled, is_active, sms_last_used_at)
  WHERE released_at IS NULL;

-- ── Dead-letter: permanently failed queued sends ────────────────────────────
CREATE TABLE IF NOT EXISTS public.sms_dead_letter (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id  UUID REFERENCES public.users(id),
  lead_id      UUID,
  campaign_id  UUID,
  to_phone     TEXT,
  body         TEXT,
  error        TEXT,
  attempts     INTEGER     DEFAULT 0,
  job_id       TEXT,
  failed_at    TIMESTAMPTZ DEFAULT NOW(),
  replayed     BOOLEAN     DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_sms_dead_letter_operator
  ON public.sms_dead_letter (operator_id);

-- ── Tie a queued sms_first_leads row to its BullMQ job ──────────────────────
-- (sms_first_leads is created live; this just adds a column if the table exists.)
ALTER TABLE public.sms_first_leads
  ADD COLUMN IF NOT EXISTS enqueue_job_id TEXT;

-- ── Buyer-campaign blast counters (Phase 2 dispo) ───────────────────────────
ALTER TABLE public.buyer_campaigns
  ADD COLUMN IF NOT EXISTS sms_sent    INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sms_replies INTEGER DEFAULT 0;

-- ── Seed: turn on SMS rotation for existing active numbers ──────────────────
-- Leaves released numbers alone. Initializes the reset marker to today so the
-- first daily-reset detection works (mirrors last_reset_date convention).
UPDATE public.phone_numbers
  SET sms_enabled = TRUE,
      sms_last_reset_date = CURRENT_DATE
  WHERE is_active = TRUE
    AND released_at IS NULL
    AND sms_last_reset_date IS NULL;
