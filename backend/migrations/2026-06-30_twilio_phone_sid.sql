-- ============================================================================
-- TWILIO PHONE SID CAPTURE  (enables in-app toll-free SMS verification submit)
-- Additive only. Does NOT change voice, rotation, the pool, or any existing
-- column. Nullable, no data loss.
--
-- WHY: Twilio's toll-free SMS verification API
--   (POST https://messaging.twilio.com/v1/Tollfree/Verifications)
-- REQUIRES the number's Twilio IncomingPhoneNumber SID ("PNxxxx") as
-- TollfreePhoneNumberSid. Today we only store the Vapi number id
-- (vapi_phone_number_id) and never persisted the Twilio PN SID at buy time,
-- so there was no way to programmatically submit a toll-free for SMS
-- verification — the operator had to do it by hand in the Twilio console.
--
-- This column lets buyTollFreeTwilioNumber() record the PN SID at purchase,
-- and the new POST /api/phones/:id/sms-verification/submit route read it back
-- to file the verification request from inside Veori.
--
-- NOTE: existing Vapi-OWNED numbers (provider:'vapi') have no Twilio PN SID
-- and can NOT be toll-free SMS verified — they aren't owned by Twilio. Only
-- numbers bought through Veori's Twilio buy path going forward will have it.
--
-- RUN THIS MANUALLY in the Supabase SQL editor. Review before running.
-- ============================================================================

ALTER TABLE public.phone_numbers
  ADD COLUMN IF NOT EXISTS twilio_phone_number_sid TEXT;  -- Twilio IncomingPhoneNumber SID (PNxxxx)
