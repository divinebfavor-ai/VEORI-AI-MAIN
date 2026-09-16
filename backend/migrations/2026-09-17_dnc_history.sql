-- Opt-out history. A START reply used to DELETE the dnc_records row, erasing the
-- evidence that the person had opted out (and when). Rows are now kept: a START
-- sets revoked_at, and every do-not-contact check reads only unrevoked rows.
ALTER TABLE public.dnc_records
  ADD COLUMN IF NOT EXISTS revoked_at     timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_reason text;
CREATE INDEX IF NOT EXISTS dnc_records_active_phone_idx ON public.dnc_records (phone) WHERE revoked_at IS NULL;
