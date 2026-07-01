-- ============================================================================
-- CALLBACK / APPOINTMENT TIME PRECISION
-- Additive only. Does NOT change any existing column, default, or constraint.
--
-- WHY: When a seller says "call me back around 5" or "let's meet Tuesday at 2",
-- the AI end-of-call handler (routes/vapi.js) previously HARDCODED every
-- appointment to tomorrow at 10:00 AM and never scheduled the callback at all.
-- The seller's actual requested time was never read off the transcript.
--
-- This adds columns to store the parsed requested time so:
--   1. appointments.scheduled_at is set to the REAL time the seller asked for.
--   2. follow_ups.next_follow_up_at holds the REAL callback time, and a BullMQ
--      delayed job fires the callback at that exact moment.
--
-- The time itself is extracted by dualAIService.parseCallTime() (already used
-- for SMS) applied to the voice transcript. These columns just persist it.
--
-- RUN THIS MANUALLY in the Supabase SQL editor. Review before running.
-- ============================================================================

-- appointments: keep an audit of exactly what the seller asked for + confidence.
-- scheduled_at (existing) is still the operative time; these are the raw parse.
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS requested_time_raw   TEXT,         -- what the seller literally said, e.g. "around 5 tomorrow"
  ADD COLUMN IF NOT EXISTS requested_timezone   TEXT,         -- IANA tz parsed from context (nullable)
  ADD COLUMN IF NOT EXISTS time_confidence      INTEGER,      -- 0-100 parser confidence
  ADD COLUMN IF NOT EXISTS source               TEXT DEFAULT 'ai_call'; -- how it was booked

-- follow_ups: mark rows that are scheduled voice CALLBACKS (vs sms/email nudges)
-- and record the parse confidence. next_follow_up_at (existing, NOT NULL) already
-- holds the callback time; these are additive metadata only.
ALTER TABLE public.follow_ups
  ADD COLUMN IF NOT EXISTS requested_time_raw   TEXT,
  ADD COLUMN IF NOT EXISTS time_confidence      INTEGER,
  ADD COLUMN IF NOT EXISTS bullmq_job_id        TEXT;         -- the scheduled-call job id (for cancel/replay)

-- Fast lookup of due voice callbacks.
CREATE INDEX IF NOT EXISTS idx_follow_ups_due_calls
  ON public.follow_ups (next_follow_up_at)
  WHERE follow_up_type = 'call' AND status = 'scheduled';
