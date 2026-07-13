-- VEORI AI - A2P 10DLC registration (per-customer brand, ISV model)
-- Additive only. Safe to re-run.
--
-- Each Solo+ customer registers their OWN A2P brand + campaign inside their Twilio
-- subaccount. This tracks the resumable, approval-gated registration state and the
-- business-identity data the brand requires. Ends by populating a2p_messaging_service_sid,
-- which smsRotation.js already consumes as the operator's registered sender.

-- ── Registration state machine ──
ALTER TABLE users ADD COLUMN IF NOT EXISTS a2p_registration_step     TEXT DEFAULT 'not_started';
ALTER TABLE users ADD COLUMN IF NOT EXISTS a2p_customer_profile_sid  TEXT;   -- BU… secondary customer profile
ALTER TABLE users ADD COLUMN IF NOT EXISTS a2p_trust_bundle_sid      TEXT;   -- BU… A2P trust bundle (TrustProduct)
ALTER TABLE users ADD COLUMN IF NOT EXISTS a2p_brand_sid             TEXT;   -- BN… brand registration
ALTER TABLE users ADD COLUMN IF NOT EXISTS a2p_brand_status          TEXT;   -- PENDING | APPROVED | FAILED
ALTER TABLE users ADD COLUMN IF NOT EXISTS a2p_campaign_sid          TEXT;   -- campaign (usAppToPerson)
ALTER TABLE users ADD COLUMN IF NOT EXISTS a2p_campaign_status       TEXT;   -- PENDING | VERIFIED/ACTIVE | FAILED
ALTER TABLE users ADD COLUMN IF NOT EXISTS a2p_messaging_service_sid TEXT;   -- MG… final sender (consumed by smsRotation)
ALTER TABLE users ADD COLUMN IF NOT EXISTS a2p_last_error            TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS a2p_updated_at            TIMESTAMPTZ;

-- ── Business identity required for the brand (per customer) ──
-- Reuses existing columns where present (legal_name/entity_name, ein, website,
-- business_email/phone, mailing_address/city/state/zip). These add the pieces A2P
-- requires that were not collected before.
ALTER TABLE users ADD COLUMN IF NOT EXISTS business_type                 TEXT;  -- LLC | CORPORATION | PARTNERSHIP | SOLE_PROPRIETOR | NON_PROFIT
ALTER TABLE users ADD COLUMN IF NOT EXISTS business_industry             TEXT;  -- vertical, e.g. REAL_ESTATE
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_type                  TEXT DEFAULT 'private'; -- private | public | non-profit | government
ALTER TABLE users ADD COLUMN IF NOT EXISTS business_iso_country          TEXT DEFAULT 'US';
ALTER TABLE users ADD COLUMN IF NOT EXISTS authorized_rep_first_name     TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS authorized_rep_last_name      TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS authorized_rep_email          TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS authorized_rep_phone          TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS authorized_rep_job_position   TEXT;

CREATE INDEX IF NOT EXISTS idx_users_a2p_step ON users(a2p_registration_step)
  WHERE a2p_registration_step IS NOT NULL AND a2p_registration_step <> 'not_started';
