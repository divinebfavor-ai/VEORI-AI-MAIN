-- ─── Feedback / Bug Reports Table ────────────────────────────────────────────
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.feedback (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  user_email   TEXT,
  type         TEXT NOT NULL DEFAULT 'bug',   -- bug | feature | complaint | other
  subject      TEXT NOT NULL,
  description  TEXT NOT NULL,
  page         TEXT,                          -- which page they were on
  status       TEXT NOT NULL DEFAULT 'open',  -- open | in_progress | resolved | dismissed
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_feedback_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;
CREATE TRIGGER trg_feedback_updated_at
  BEFORE UPDATE ON public.feedback
  FOR EACH ROW EXECUTE PROCEDURE public.set_feedback_updated_at();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_feedback_user_id   ON public.feedback (user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_status    ON public.feedback (status);
CREATE INDEX IF NOT EXISTS idx_feedback_created   ON public.feedback (created_at DESC);

-- RLS — users can only insert/read their own; service role reads all
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users insert own feedback"  ON public.feedback FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "Users read own feedback"    ON public.feedback FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role full access"   ON public.feedback USING (true) WITH CHECK (true);
