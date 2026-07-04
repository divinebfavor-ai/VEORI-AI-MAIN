-- ─────────────────────────────────────────────────────────────────────────────
-- AUDIT HARDENING - consolidated, idempotent schema for the "tighten every gap"
-- sprint. Covers the new columns/tables the hardened code reads/writes:
--
--   F3  - per-campaign + per-lead AI instruction overrides
--           leads.ai_instructions, campaigns.ai_custom_instructions
--   F8  - bilingual EN/ES
--           leads.preferred_language, campaigns.language, users.default_language
--   F9  - buyer proof-of-funds / NCA / tire-kicker flags
--           buyers.proof_of_funds_verified, nca_signed, nca_signed_at,
--           is_tire_kicker  (repair_tolerance already exists)
--   F17 - transactional funding marketplace
--           funding_partners, funding_requests
--
-- SAFETY: every statement is ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT
-- EXISTS - purely additive, no drops, no data loss, safe to re-run. If this
-- migration has NOT been run yet, the hardened code degrades honestly:
--   • language defaults to en-US (every existing call unchanged)
--   • campaign/lead instruction layers are simply empty
--   • buyer-score reads missing flags as false (no crash)
--   • the funding marketplace returns an honest "not set up yet" empty list
--     (Postgres 42P01 / undefined_table handled in routes/funding.js)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── F3 - layered AI instructions ─────────────────────────────────────────────
-- A note specific to ONE lead/person. Most specific layer; wins on conflict with
-- operator/campaign style, but NEVER overrides the NON-NEGOTIABLE call rules.
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS ai_instructions TEXT;

-- A steer specific to a whole list/campaign, layered on top of the operator style.
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS ai_custom_instructions TEXT;

-- ── F8 - bilingual EN/ES ─────────────────────────────────────────────────────
-- Per-lead language preference ('en' | 'es' | 'spanish' | …). NULL = en-US.
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS preferred_language TEXT;

-- Campaign-level default language when a lead has none set.
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS language TEXT;

-- Operator-level fallback language for all of their leads.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS default_language TEXT;

-- ── Caveat - proactive AI disclosure (per-operator opt-in) ───────────────────
-- When TRUE, the live call prompt proactively states the AI is an AI within the
-- first sentences (for stricter jurisdictions / bot-disclosure laws). Defaults
-- FALSE → existing concealed-by-default-unless-asked behavior is byte-for-byte
-- unchanged. The call route degrades safely if this column is absent.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS proactive_ai_disclosure BOOLEAN DEFAULT FALSE;

-- ── Section E - copilot/autopilot operator mode ──────────────────────────────
-- 'manual' | 'copilot' (default) | 'autopilot'. Governs whether AI-recommended
-- actions auto-fire (low-risk + reversible only, autopilot) or wait for operator
-- approval. Defaults to the safest mode so nothing auto-fires until the operator
-- explicitly opts in; high-stakes/irreversible actions ALWAYS need approval.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS operator_mode TEXT DEFAULT 'copilot';

-- ── F9 - buyer vetting flags (proof-of-funds / NCA / tire-kicker) ────────────
ALTER TABLE buyers
  ADD COLUMN IF NOT EXISTS proof_of_funds_verified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS nca_signed              BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS nca_signed_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_tire_kicker          BOOLEAN DEFAULT FALSE;

-- ── F17 - transactional funding marketplace ─────────────────────────────────
-- Vetted funding partners (transactional / EMD / gap / rehab / private). Rows are
-- curated/seeded by the platform (is_public = true) OR added privately by an
-- operator (user_id set, is_public = false). We NEVER fabricate lenders - an empty
-- table is an honest empty marketplace.
CREATE TABLE IF NOT EXISTS funding_partners (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID,             -- NULL = platform-curated; set = operator-private
  name                 TEXT NOT NULL,
  funding_types        TEXT[]  DEFAULT '{}',  -- subset of transactional/emd/gap/rehab/private
  min_amount           NUMERIC,
  max_amount           NUMERIC,
  states               TEXT[]  DEFAULT '{}',  -- empty = nationwide
  fee_structure        TEXT,
  turnaround           TEXT,
  contact_email        TEXT,
  contact_phone        TEXT,
  website              TEXT,
  is_public            BOOLEAN DEFAULT FALSE, -- platform partners = true
  is_active            BOOLEAN DEFAULT TRUE,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

-- Idempotent guards in case an older/partial table already exists.
ALTER TABLE funding_partners
  ADD COLUMN IF NOT EXISTS user_id        UUID,
  ADD COLUMN IF NOT EXISTS name           TEXT,
  ADD COLUMN IF NOT EXISTS funding_types  TEXT[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS min_amount     NUMERIC,
  ADD COLUMN IF NOT EXISTS max_amount     NUMERIC,
  ADD COLUMN IF NOT EXISTS states         TEXT[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS fee_structure  TEXT,
  ADD COLUMN IF NOT EXISTS turnaround     TEXT,
  ADD COLUMN IF NOT EXISTS contact_email  TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone  TEXT,
  ADD COLUMN IF NOT EXISTS website        TEXT,
  ADD COLUMN IF NOT EXISTS is_public      BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_active      BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS created_at     TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_funding_partners_public ON funding_partners(is_public) WHERE is_public = TRUE;
CREATE INDEX IF NOT EXISTS idx_funding_partners_user   ON funding_partners(user_id);

-- An operator's funding request for a specific deal. Records intent only - the
-- platform NEVER moves money; the operator contacts the partner directly.
CREATE TABLE IF NOT EXISTS funding_requests (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL,
  deal_id              UUID,
  partner_id           UUID,
  funding_type         TEXT,             -- transactional/emd/gap/rehab/private
  amount               NUMERIC,
  needed_by            DATE,
  status               TEXT DEFAULT 'requested',
  notes                TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE funding_requests
  ADD COLUMN IF NOT EXISTS user_id      UUID,
  ADD COLUMN IF NOT EXISTS deal_id      UUID,
  ADD COLUMN IF NOT EXISTS partner_id   UUID,
  ADD COLUMN IF NOT EXISTS funding_type TEXT,
  ADD COLUMN IF NOT EXISTS amount       NUMERIC,
  ADD COLUMN IF NOT EXISTS needed_by    DATE,
  ADD COLUMN IF NOT EXISTS status       TEXT DEFAULT 'requested',
  ADD COLUMN IF NOT EXISTS notes        TEXT,
  ADD COLUMN IF NOT EXISTS created_at   TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_funding_requests_user ON funding_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_funding_requests_deal ON funding_requests(deal_id);
