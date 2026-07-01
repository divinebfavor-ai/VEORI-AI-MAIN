-- ============================================================================
-- OPERATOR SMS OPT-IN PROOF IMAGES  (required for toll-free SMS verification)
-- Additive only. Does NOT change any existing column, default, or constraint.
--
-- WHY: Twilio's Tollfree/Verifications API now REQUIRES `OptInImageUrls` — one or
-- more publicly-accessible image URLs proving how recipients consented to receive
-- texts (screenshot of the web form / checkbox / written consent). Submitting a
-- toll-free verification WITHOUT it fails with:
--     "optInImageUrls is required"
-- which is exactly what the auto-file path (numberProvisioning.submitTollFree-
-- Verification) hit when Veori bought a toll-free number, because it had no images
-- to send.
--
-- This stores the operator's opt-in proof image URLs so the auto-file path can
-- attach them. When empty, the auto-file path SKIPS submitting (never throws) and
-- the operator can file later from Settings once they host their opt-in images.
--
-- RUN THIS MANUALLY in the Supabase SQL editor. Review before running.
-- ============================================================================

-- Publicly-hosted opt-in proof image URLs (Twilio OptInImageUrls). Array of TEXT.
--   NULL / empty  → no proof yet; auto-file skips cleanly, operator files later.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS sms_opt_in_image_urls TEXT[];
