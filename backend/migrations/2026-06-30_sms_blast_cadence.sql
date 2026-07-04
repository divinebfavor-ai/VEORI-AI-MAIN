-- ─── SMS First: operator-selectable 1× / 2× / 3× blast cadence ────────────────
-- Adds the columns the multi-touch non-responder cadence reads/writes. All
-- additive, nullable, and idempotent - safe to run more than once and a no-op
-- if already applied. No data is modified or removed. Run manually in the
-- Supabase SQL editor.
--
-- Backward compatibility: the application tolerates these columns being absent
-- (campaign start + row inserts retry without them, defaulting to 1× behavior),
-- so running this migration only ENABLES 2×/3× - it never changes existing rows.

-- How many total touches a non-responder gets for this campaign (1, 2, or 3).
-- NULL / unset is treated as 1 (= the original single-blast behavior).
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS sms_blast_count int;

-- Per-lead cadence tracking on the SMS-first tracking rows:
--   touch_count   - how many times this lead has been texted (1 = initial blast).
--   last_touch_at - when the most recent touch was sent; the re-blast loop spaces
--                   touches BLAST_INTERVAL_MS apart off this timestamp.
ALTER TABLE sms_first_leads
  ADD COLUMN IF NOT EXISTS touch_count   int,
  ADD COLUMN IF NOT EXISTS last_touch_at timestamptz;
