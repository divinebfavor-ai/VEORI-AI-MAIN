-- Free tier daily call tracking
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS free_calls_today INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS free_calls_date  DATE;
