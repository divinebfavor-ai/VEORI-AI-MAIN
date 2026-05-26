-- ============================================================
-- Social Media Post Queue — Feature 29
-- Run this in Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS post_queue (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL CHECK (platform IN ('facebook','instagram','twitter','youtube','tiktok','email')),
  caption       TEXT NOT NULL,
  media_urls    TEXT[] DEFAULT '{}',
  scheduled_at  TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','scheduled','published','failed','cancelled')),
  post_type     TEXT DEFAULT 'manual',   -- 'manual' | 'deal_closed' | 'listing_published' | 'deal_assigned'
  retry_count   INT DEFAULT 0,
  last_error    TEXT,
  published_at  TIMESTAMPTZ,
  platform_post_id TEXT,                 -- ID returned by social platform after publish
  lead_id       UUID,
  listing_id    UUID,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_post_queue_user_id     ON post_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_post_queue_status      ON post_queue(user_id, status);
CREATE INDEX IF NOT EXISTS idx_post_queue_scheduled   ON post_queue(scheduled_at) WHERE status = 'scheduled';

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_post_queue_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_queue_updated_at ON post_queue;
CREATE TRIGGER trg_post_queue_updated_at
  BEFORE UPDATE ON post_queue
  FOR EACH ROW EXECUTE FUNCTION update_post_queue_updated_at();

-- Row Level Security
ALTER TABLE post_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own post queue" ON post_queue;
CREATE POLICY "Users manage own post queue"
  ON post_queue FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
