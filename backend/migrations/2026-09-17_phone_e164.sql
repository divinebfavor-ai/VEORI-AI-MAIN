-- Phone numbers in E.164 (+1XXXXXXXXXX), enforced by the database.
--
-- WHY: every lead was stored as bare 10 digits ("7045550000"), but Twilio delivers
-- inbound texts and STOP requests from "+17045550000". So:
--   • a seller's reply never matched their lead (dropped as "No lead found");
--   • an opt-out written from the inbound number never matched the lead's phone
--     in the outbound DNC checks.
-- And the leads (user_id, phone) unique index was PARTIAL, which Postgres cannot
-- use as an ON CONFLICT target, so every CSV import chunk failed (42P10).
--
-- Normalizing in each of the ~15 write paths would leave the next one to forget,
-- so a trigger normalizes on every insert/update of phone. Values that are not a
-- US number are left as entered (trimmed); blanks become NULL.

CREATE OR REPLACE FUNCTION public.normalize_us_phone(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN p IS NULL OR btrim(p) = '' THEN NULL
    WHEN regexp_replace(p, '\D', '', 'g') ~ '^1?[2-9][0-9]{2}[2-9][0-9]{6}$'
      THEN '+1' || right(regexp_replace(p, '\D', '', 'g'), 10)
    ELSE btrim(p)
  END
$$;

CREATE OR REPLACE FUNCTION public.trg_normalize_phone() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.phone := public.normalize_us_phone(NEW.phone);
  RETURN NEW;
END
$$;

-- leads: phone becomes optional (Lead Engine records can arrive before skip trace)
ALTER TABLE public.leads ALTER COLUMN phone DROP NOT NULL;
UPDATE public.leads SET phone = public.normalize_us_phone(phone) WHERE phone IS DISTINCT FROM public.normalize_us_phone(phone);
DROP INDEX IF EXISTS public.leads_user_phone_unique;
CREATE UNIQUE INDEX IF NOT EXISTS leads_user_phone_key ON public.leads (user_id, phone);
DROP TRIGGER IF EXISTS leads_normalize_phone ON public.leads;
CREATE TRIGGER leads_normalize_phone BEFORE INSERT OR UPDATE OF phone ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.trg_normalize_phone();

-- buyers
UPDATE public.buyers SET phone = public.normalize_us_phone(phone) WHERE phone IS DISTINCT FROM public.normalize_us_phone(phone);
DROP TRIGGER IF EXISTS buyers_normalize_phone ON public.buyers;
CREATE TRIGGER buyers_normalize_phone BEFORE INSERT OR UPDATE OF phone ON public.buyers
  FOR EACH ROW EXECUTE FUNCTION public.trg_normalize_phone();

-- dnc_records
UPDATE public.dnc_records SET phone = public.normalize_us_phone(phone) WHERE phone IS DISTINCT FROM public.normalize_us_phone(phone);
DROP TRIGGER IF EXISTS dnc_records_normalize_phone ON public.dnc_records;
CREATE TRIGGER dnc_records_normalize_phone BEFORE INSERT OR UPDATE OF phone ON public.dnc_records
  FOR EACH ROW EXECUTE FUNCTION public.trg_normalize_phone();
CREATE INDEX IF NOT EXISTS dnc_records_phone_idx ON public.dnc_records (phone);

REVOKE ALL ON FUNCTION public.trg_normalize_phone() FROM PUBLIC, anon, authenticated;
