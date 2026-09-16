-- Post-call actions (deal, follow-up sequence, callback, seller memory, missed-call
-- text) must run exactly once per call. Twilio can deliver the 'completed' status
-- callback more than once, and scoring is re-entrant. The pipeline claims a call by
-- setting this column only where it is still NULL; the losing request does nothing.
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS post_call_processed_at timestamptz;

-- Atomic campaign counters. Called by the post-call pipeline (and the legacy Vapi
-- webhook) as rpc('increment_campaign_stats'); it was referenced but never created,
-- so campaign call/answer/offer counts never moved. SECURITY INVOKER: the backend
-- calls it with the service role; nothing is granted to anon/authenticated.
CREATE OR REPLACE FUNCTION public.increment_campaign_stats(
  p_campaign_id uuid, p_answered integer DEFAULT 0, p_offer_made integer DEFAULT 0
) RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE public.campaigns
     SET leads_called   = COALESCE(leads_called, 0) + 1,
         leads_answered = COALESCE(leads_answered, 0) + GREATEST(COALESCE(p_answered, 0), 0),
         offers_made    = COALESCE(offers_made, 0) + GREATEST(COALESCE(p_offer_made, 0), 0),
         updated_at     = now()
   WHERE id = p_campaign_id;
$$;
REVOKE ALL ON FUNCTION public.increment_campaign_stats(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
