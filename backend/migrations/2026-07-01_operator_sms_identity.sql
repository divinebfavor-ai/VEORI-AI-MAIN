-- ============================================================================
-- OPERATOR BUSINESS IDENTITY  (for automatic toll-free SMS verification)
-- Additive only. Does NOT change any existing column, default, or constraint.
--
-- WHY: Veori buys + verifies toll-free numbers FOR the operator (operators never
-- touch Twilio). Twilio's toll-free SMS verification (Tollfree/Verifications)
-- requires the OPERATOR'S business identity: legal name, business address, a
-- contact person, opt-in type, and a use-case summary + sample message. Today the
-- `users` table stores company_name / legal_name / entity_type / business_email /
-- website, but is MISSING the address + contact-person + opt-in/use-case fields
-- Twilio needs. Without them the auto-submit can't file a coherent verification.
--
-- These columns are read by numberProvisioning.submitTollFreeVerification() right
-- after Veori buys a toll-free number, so verification fires automatically.
--
-- RUN THIS MANUALLY in the Supabase SQL editor. Review before running.
-- ============================================================================

-- Business mailing address (BusinessStreetAddress / City / State / Postal / Country).
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS business_street          TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS business_street2         TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS business_city            TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS business_state           TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS business_postal_code     TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS business_country         TEXT DEFAULT 'US';

-- Authorized contact person (BusinessContactFirstName / LastName / Email / Phone).
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS contact_first_name       TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS contact_last_name        TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS contact_email            TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS contact_phone            TEXT;

-- Toll-free SMS verification descriptors (Twilio enums + free text).
--   sms_business_type   one of PRIVATE_PROFIT/PUBLIC_PROFIT/SOLE_PROPRIETOR/NON_PROFIT/GOVERNMENT
--   sms_opt_in_type     one of VERBAL/WEB_FORM/PAPER_FORM/VIA_TEXT/MOBILE_QR_CODE/IMPORT
--   sms_use_case_summary  what the operator texts leads (UseCaseSummary)
--   sms_message_sample    an example outbound text (ProductionMessageSample)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS sms_business_type        TEXT DEFAULT 'PRIVATE_PROFIT';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS sms_opt_in_type          TEXT DEFAULT 'VERBAL';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS sms_use_case_summary     TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS sms_message_sample       TEXT;
