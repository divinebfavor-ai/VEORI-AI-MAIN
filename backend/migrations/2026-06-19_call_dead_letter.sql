-- ─────────────────────────────────────────────────────────────────────────────
-- Call-outcome dead-letter — never silently lose a completed call.
--
-- WHY: when Vapi fires end-of-call-report, handleCallEnded matches the call row by
-- vapi_call_id, with a phone-number fallback. If BOTH miss (e.g. the initial
-- vapi_call_id write lost a race, or Vapi dialed a number we can't reconcile) the
-- old code logged a warning and returned — the call's outcome, transcript,
-- duration and recording URL were lost forever. At 80k+ outreach that is real,
-- unrecoverable deal intelligence gone.
--
-- This table is the forensic + manual-reconcile surface: every orphaned end-of-call
-- report lands here with everything we received, so an operator (or a later
-- reconcile job) can match it back to a lead and replay the outcome.
--
-- Mirrors the sms_dead_letter pattern (additive, idempotent, no drops).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.call_dead_letter (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vapi_call_id   TEXT,
  dialed_phone   TEXT,
  ended_reason   TEXT,
  duration_seconds INTEGER,
  transcript     TEXT,
  recording_url  TEXT,
  raw_event      JSONB,          -- the full webhook payload for full recovery
  error          TEXT,           -- why we couldn't match (e.g. 'no_call_record')
  failed_at      TIMESTAMPTZ DEFAULT NOW(),
  reconciled     BOOLEAN     DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_call_dead_letter_vapi
  ON public.call_dead_letter (vapi_call_id);

CREATE INDEX IF NOT EXISTS idx_call_dead_letter_phone
  ON public.call_dead_letter (dialed_phone);

CREATE INDEX IF NOT EXISTS idx_call_dead_letter_open
  ON public.call_dead_letter (reconciled) WHERE reconciled = FALSE;
