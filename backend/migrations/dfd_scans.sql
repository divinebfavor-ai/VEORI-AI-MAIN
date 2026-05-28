-- ─── AI DFD Scans Table ───────────────────────────────────────────────────────
-- Tracks every AI-powered zip code scan for history/analytics

CREATE TABLE IF NOT EXISTS public.dfd_scans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES public.users(id) ON DELETE CASCADE,
  zip             TEXT NOT NULL,
  city            TEXT,
  state           TEXT,
  filters         TEXT[] DEFAULT '{}',
  leads_imported  INTEGER DEFAULT 0,
  avg_score       INTEGER DEFAULT 0,
  campaign_id     UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dfd_scans_user    ON public.dfd_scans (user_id);
CREATE INDEX IF NOT EXISTS idx_dfd_scans_created ON public.dfd_scans (created_at DESC);
