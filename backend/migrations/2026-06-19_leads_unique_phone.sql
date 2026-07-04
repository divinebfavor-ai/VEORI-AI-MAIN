-- ─────────────────────────────────────────────────────────────────────────────
-- leads - enforce one lead per (user_id, phone). The DEDUP backbone.
--
-- WHY: the bulk import already tries to `upsert(... onConflict: 'phone,user_id')`,
-- but that ON CONFLICT target only works if a UNIQUE index actually exists. Without
-- it, the upsert silently falls back to a plain INSERT and DUPLICATE homeowners get
-- created across overlapping import batches - same person texted twice = TCPA risk +
-- wasted sends. This migration creates that missing unique index so the upsert path
-- becomes real, and the lead engine's pre-insert dedup gets a hard backstop.
--
-- SAFE ON EXISTING DATA: phones already in the table may contain duplicates. We
-- CANNOT create a unique index while duplicates exist, so step 1 collapses them
-- FIRST - keeping the OLDEST row per (user_id, phone) (the original, with its real
-- created_at + any downstream deals/calls/sms already linked to it) and deleting the
-- newer copies. Rows with a NULL/blank phone are left untouched (the partial index
-- below ignores them - a property with no phone is not a dedup candidate).
--
-- Idempotent: the DELETE is a no-op once clean; the index uses IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Collapse existing duplicates - keep the earliest row per (user_id, phone).
--    Newer duplicates are removed so the unique index can be built. We delete by id
--    to be explicit and avoid touching the surviving original.
DELETE FROM leads l
USING (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY user_id, phone
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM leads
  WHERE phone IS NOT NULL AND btrim(phone) <> ''
) dupes
WHERE l.id = dupes.id
  AND dupes.rn > 1;

-- 2. Unique index on (user_id, phone) - partial, ignoring NULL/blank phones.
--    This is the ON CONFLICT target the bulk-import upsert already references, and
--    the hard guarantee that the same homeowner can't be enrolled twice per operator.
CREATE UNIQUE INDEX IF NOT EXISTS leads_user_phone_unique
  ON leads (user_id, phone)
  WHERE phone IS NOT NULL AND btrim(phone) <> '';
