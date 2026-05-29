-- ─── Property Marketing Videos ───────────────────────────────────────────────
-- Stores every AI-generated cinematic property marketing video

CREATE TABLE IF NOT EXISTS public.property_videos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES public.users(id) ON DELETE CASCADE,
  listing_id      UUID,
  style           TEXT DEFAULT 'investment',   -- luxury|investment|family|distressed
  aspect_ratio    TEXT DEFAULT '16:9',         -- 16:9 | 9:16
  script          TEXT,                        -- AI-generated voiceover script
  render_id       TEXT,                        -- Shotstack render ID
  shotstack_env   TEXT DEFAULT 'sandbox',
  status          TEXT DEFAULT 'rendering',    -- rendering|done|failed|draft
  video_url       TEXT,                        -- Final MP4 URL when done
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_property_videos_user    ON public.property_videos (user_id);
CREATE INDEX IF NOT EXISTS idx_property_videos_listing ON public.property_videos (listing_id);
CREATE INDEX IF NOT EXISTS idx_property_videos_status  ON public.property_videos (status);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_property_videos_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_property_videos_updated_at ON public.property_videos;
CREATE TRIGGER trg_property_videos_updated_at
  BEFORE UPDATE ON public.property_videos
  FOR EACH ROW EXECUTE FUNCTION update_property_videos_updated_at();
