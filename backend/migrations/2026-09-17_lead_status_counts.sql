-- Dashboard pipeline counts. analytics.js read every lead's status into Node and
-- counted there; PostgREST caps a select at 1,000 rows, so any operator with more
-- than 1,000 leads saw wrong counts. One grouped query, index-backed.
CREATE INDEX IF NOT EXISTS leads_user_status_idx ON public.leads (user_id, status);

CREATE OR REPLACE FUNCTION public.lead_status_counts(p_user_id uuid)
RETURNS TABLE (status text, count bigint)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(l.status, 'new') AS status, COUNT(*)::bigint AS count
    FROM public.leads l
   WHERE l.user_id = p_user_id
   GROUP BY COALESCE(l.status, 'new')
$$;
REVOKE ALL ON FUNCTION public.lead_status_counts(uuid) FROM PUBLIC, anon, authenticated;
