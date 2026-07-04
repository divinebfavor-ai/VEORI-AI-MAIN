-- ─── VEORI: Seller Photo Upload Feature ─────────────────────────────────────
-- Run in Supabase SQL Editor before deploying.

-- ─── 1. Lead Photos Table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_photos (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id      UUID        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url          TEXT        NOT NULL,
  storage_path TEXT,
  source       TEXT        DEFAULT 'seller_upload',  -- 'seller_upload' | 'street_view' | 'operator_upload'
  file_name    TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_photos_lead_id ON lead_photos(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_photos_user_id ON lead_photos(user_id);

-- ─── 2. Photo Upload Tokens Table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS photo_upload_tokens (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  token      TEXT        UNIQUE NOT NULL,
  lead_id    UUID        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_count INTEGER     DEFAULT 0,
  sent_via   TEXT,       -- 'sms' | 'email' | 'manual'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_photo_tokens_token   ON photo_upload_tokens(token);
CREATE INDEX IF NOT EXISTS idx_photo_tokens_lead_id ON photo_upload_tokens(lead_id);

-- ─── 3. RLS - no direct client access ────────────────────────────────────────
ALTER TABLE lead_photos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE photo_upload_tokens ENABLE ROW LEVEL SECURITY;
