-- ─── Lead Intelligence Tags
-- Run in Supabase SQL Editor

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS primary_tag     TEXT,
  ADD COLUMN IF NOT EXISTS secondary_tags  TEXT[]    DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tag_confidence  INTEGER   DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tag_reason      TEXT,
  ADD COLUMN IF NOT EXISTS tagged_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_absentee_owner BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_vacant       BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS owner_occupied  BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS years_owned     INTEGER,
  ADD COLUMN IF NOT EXISTS has_lis_pendens BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS foreclosure_stage TEXT,
  ADD COLUMN IF NOT EXISTS probate_case    BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS deed_type       TEXT,
  ADD COLUMN IF NOT EXISTS owner_property_count INTEGER DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_leads_primary_tag    ON leads(primary_tag);
CREATE INDEX IF NOT EXISTS idx_leads_secondary_tags ON leads USING gin(secondary_tags);
