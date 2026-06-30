-- ============================================================================
-- TOLL-FREE SMS CARRIER VERIFICATION  (deliverability hardening)
-- Additive only. Does NOT change voice, rotation, or the existing pool's
-- `verified_status` column (that one means "pool number ready to assign").
--
-- WHY: smsService.sendSMS() uses an operator's toll-free number as the default
-- SMS sender (tier 2, when they have no A2P 10DLC Messaging Service). US carriers
-- SILENTLY FILTER / BLOCK SMS sent from a toll-free number that has not completed
-- toll-free verification (TransUnion / carrier registration). Today we have no
-- record of whether a toll-free is SMS-verified, so unverified toll-free numbers
-- can be chosen as the sender and their texts never reach the lead.
--
-- This adds a dedicated, SMS-ONLY verification status so the sender picker can
-- skip un-verified toll-free numbers and fall back to a deliverable sender.
--
-- RUN THIS MANUALLY in the Supabase SQL editor. Review before running.
-- ============================================================================

-- Carrier SMS verification state for toll-free numbers.
--   'unverified' — never submitted for toll-free SMS verification (default).
--   'pending'    — submitted to Twilio/carrier, awaiting approval.
--   'verified'   — approved; safe to send SMS from this toll-free number.
-- Local numbers (non toll-free) ignore this column entirely — their SMS path is
-- A2P 10DLC via a Messaging Service, gated separately.
ALTER TABLE public.phone_numbers
  ADD COLUMN IF NOT EXISTS sms_verification_status  TEXT        DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS sms_verification_sid     TEXT,        -- Twilio toll-free verification request SID (HHxxxx)
  ADD COLUMN IF NOT EXISTS sms_verification_at      TIMESTAMPTZ; -- when status last changed

-- Fast "deliverable toll-free SMS sender" lookup.
CREATE INDEX IF NOT EXISTS idx_phone_numbers_tollfree_sms_verified
  ON public.phone_numbers (user_id, is_toll_free, sms_verification_status)
  WHERE released_at IS NULL;
