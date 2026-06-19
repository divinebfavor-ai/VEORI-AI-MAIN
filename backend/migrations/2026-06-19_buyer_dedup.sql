-- ─────────────────────────────────────────────────────────────────────────────
-- buyers — enforce one buyer per (user_id, phone). The BUY-side dedup backbone.
--
-- WHY: the leads table got this fix (2026-06-19_leads_unique_phone.sql) but the
-- buyers table never did. buyers.js /bulk dedups ONLY in-memory per request plus a
-- per-operator phone pre-check — at 30k-buyer import scale, two overlapping batches
-- (or two concurrent imports) race past that JS check and create DUPLICATE buyers:
-- the same cash buyer blasted twice on every future deal = wasted sends + TCPA risk,
-- and a split buy-box profile (capture lands on one copy, matching reads the other).
-- This migration creates the missing UNIQUE index so the upsert path in buyers.js
-- becomes real and the in-memory dedup gets a hard database backstop.
--
-- SAFE ON EXISTING DATA: phones already in the table may contain duplicates. A unique
-- index CANNOT be built while duplicates exist, so step 1 collapses them FIRST —
-- keeping the OLDEST row per (user_id, phone) (the original, with its real created_at
-- and any buyer_deal_history / buyer_campaigns already linked to it) and deleting the
-- newer copies. Rows with a NULL/blank phone are left untouched (the partial index
-- ignores them — an email-only buyer is not a phone-dedup candidate).
--
-- Idempotent: the DELETE is a no-op once clean; the index uses IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Collapse existing duplicates — keep the earliest row per (user_id, phone).
--    Newer duplicates are removed so the unique index can be built. We delete by id
--    to be explicit and avoid touching the surviving original.
DELETE FROM buyers b
USING (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY user_id, phone
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM buyers
  WHERE phone IS NOT NULL AND btrim(phone) <> ''
) dupes
WHERE b.id = dupes.id
  AND dupes.rn > 1;

-- 2. Unique index on (user_id, phone) — partial, ignoring NULL/blank phones.
--    This is the ON CONFLICT target the bulk-import upsert references, and the hard
--    guarantee that the same cash buyer can't be enrolled twice per operator.
CREATE UNIQUE INDEX IF NOT EXISTS buyers_user_phone_unique
  ON buyers (user_id, phone)
  WHERE phone IS NOT NULL AND btrim(phone) <> '';
