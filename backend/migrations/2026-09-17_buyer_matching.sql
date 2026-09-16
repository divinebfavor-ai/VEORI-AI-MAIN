-- Buyer matching + reply tracking. Production had 0 buyers when this ran.
--
-- 1. buyers (user_id, phone) uniqueness. routes/buyers.js upserts ON CONFLICT
--    (user_id, phone), but the index from 2026-06-19_buyer_dedup.sql was never
--    applied - and as a PARTIAL index it could not serve as an ON CONFLICT target
--    anyway. Result: adding any buyer with a phone failed. A plain unique index
--    works: NULL phones never conflict with each other; the API stores blank as NULL.
UPDATE public.buyers SET phone = NULL WHERE phone IS NOT NULL AND btrim(phone) = '';
DELETE FROM public.buyers b USING (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id, phone ORDER BY created_at ASC, id ASC) AS rn
  FROM public.buyers WHERE phone IS NOT NULL
) d WHERE b.id = d.id AND d.rn > 1;
CREATE UNIQUE INDEX IF NOT EXISTS buyers_user_phone_key ON public.buyers (user_id, phone);
CREATE INDEX IF NOT EXISTS buyers_phone_idx ON public.buyers (phone) WHERE phone IS NOT NULL;

-- 2. Buy-box columns the matcher and the Buyers page use (2026-06-19 enrich was never applied).
ALTER TABLE public.buyers
  ADD COLUMN IF NOT EXISTS min_price         numeric,
  ADD COLUMN IF NOT EXISTS property_cities   text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS buy_box_zips      text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cash_only         boolean,
  ADD COLUMN IF NOT EXISTS proof_of_funds    boolean,
  ADD COLUMN IF NOT EXISTS source            text,
  ADD COLUMN IF NOT EXISTS last_contact_at   timestamptz,
  ADD COLUMN IF NOT EXISTS buybox_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS share_to_pool     boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS buyers_share_to_pool_idx ON public.buyers (share_to_pool) WHERE share_to_pool = true;

-- 3. Buyer replies were inserted with buyer_id, a column sms_messages never had, so
--    every buyer reply failed to save.
ALTER TABLE public.sms_messages ADD COLUMN IF NOT EXISTS buyer_id uuid REFERENCES public.buyers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS sms_messages_buyer_sent_idx ON public.sms_messages (buyer_id, sent_at DESC) WHERE buyer_id IS NOT NULL;

-- 4. buyer_deal_history upserts ON CONFLICT (buyer_id, deal_id); the partial unique
--    index could not serve that target, so every outcome write failed.
DROP INDEX IF EXISTS public.uq_buyer_deal_history_buyer_deal;
CREATE UNIQUE INDEX IF NOT EXISTS buyer_deal_history_buyer_deal_key ON public.buyer_deal_history (buyer_id, deal_id);

-- 5. Which deal each buyer was actually sent, and what they said. A buyer's YES is
--    matched to a deal they were offered - never guessed.
CREATE TABLE IF NOT EXISTS public.buyer_deal_offers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  buyer_id    uuid NOT NULL REFERENCES public.buyers(id) ON DELETE CASCADE,
  deal_id     uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES public.buyer_campaigns(id) ON DELETE SET NULL,
  match_type  text NOT NULL DEFAULT 'buy_box' CHECK (match_type IN ('buy_box', 'fallback')),
  status      text NOT NULL DEFAULT 'sent' CHECK (status IN ('queued', 'sent', 'interested', 'passed', 'assigned', 'not_selected', 'send_failed')),
  sent_at     timestamptz NOT NULL DEFAULT now(),
  replied_at  timestamptz,
  reply_body  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deal_id, buyer_id)
);
CREATE INDEX IF NOT EXISTS buyer_deal_offers_buyer_idx ON public.buyer_deal_offers (buyer_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS buyer_deal_offers_deal_idx  ON public.buyer_deal_offers (deal_id, status);
CREATE INDEX IF NOT EXISTS buyer_deal_offers_user_idx  ON public.buyer_deal_offers (user_id, created_at DESC);
ALTER TABLE public.buyer_deal_offers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS buyer_deal_offers_owner_read ON public.buyer_deal_offers;
CREATE POLICY buyer_deal_offers_owner_read ON public.buyer_deal_offers
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- 6. Atomic campaign counters (texts sent, replies, interested buyers).
CREATE OR REPLACE FUNCTION public.increment_buyer_campaign(
  p_campaign_id uuid, p_replies integer DEFAULT 0, p_interested integer DEFAULT 0, p_sent integer DEFAULT 0
) RETURNS void LANGUAGE sql SET search_path = public AS $$
  UPDATE public.buyer_campaigns
     SET sms_sent          = COALESCE(sms_sent, 0) + GREATEST(COALESCE(p_sent, 0), 0),
         sms_replies       = COALESCE(sms_replies, 0) + GREATEST(COALESCE(p_replies, 0), 0),
         buyers_interested = COALESCE(buyers_interested, 0) + GREATEST(COALESCE(p_interested, 0), 0)
   WHERE id = p_campaign_id;
$$;
REVOKE ALL ON FUNCTION public.increment_buyer_campaign(uuid, integer, integer, integer) FROM PUBLIC, anon, authenticated;
