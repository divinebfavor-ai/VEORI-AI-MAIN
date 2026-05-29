-- Referral system
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS referral_code    TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS referred_by      UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS referral_credits NUMERIC(10,2) DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.referrals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  referred_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  plan              TEXT,
  plan_amount       NUMERIC(10,2),
  status            TEXT DEFAULT 'pending',    -- pending | active | cancelled
  month1_commission NUMERIC(10,2) DEFAULT 0,
  month1_paid       BOOLEAN DEFAULT FALSE,
  recurring_rate    NUMERIC(5,4) DEFAULT 0.03, -- 3%
  total_earned      NUMERIC(10,2) DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(referred_id)
);

CREATE TABLE IF NOT EXISTS public.referral_payments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id   UUID NOT NULL REFERENCES public.referrals(id) ON DELETE CASCADE,
  referrer_id   UUID NOT NULL REFERENCES public.users(id),
  referred_id   UUID NOT NULL REFERENCES public.users(id),
  amount        NUMERIC(10,2) NOT NULL,
  type          TEXT NOT NULL,  -- month1 | recurring
  status        TEXT DEFAULT 'pending', -- pending | paid
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals (referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON public.referrals (referred_id);
CREATE INDEX IF NOT EXISTS idx_ref_payments_referrer ON public.referral_payments (referrer_id);
