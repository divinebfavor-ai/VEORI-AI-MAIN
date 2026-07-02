-- ============================================================================
-- VOICE RANKING  (order the picker by "most human" so operators pick with confidence)
-- Additive/idempotent. Writes ONLY to veori_voice_library.
-- Does NOT touch voice_name, voice_id, is_active, or any other table.
--
-- WHY: Operators want the voices ranked so the most human-sounding one is #1 in
-- the picker. This adds a voice_rank column (lower = higher/better) and getVoice-
-- Library orders by it. The picker shows a "#1 Most human" style badge.
--
-- HONESTY NOTE: the assistant cannot listen to audio, so these ranks are a
-- DEFENSIBLE DEFAULT ordering, not a "listened with my ears" judgment. The order
-- balances the two use-cases (a female + male lead voice near the top) and is
-- meant to be re-ordered by the operator after they preview each one. Re-running
-- this migration re-applies the default; to set a custom order, just UPDATE the
-- voice_rank values (or ask the app to expose reordering later).
--
-- RUN THIS MANUALLY in the Supabase SQL editor. Review before running.
-- ============================================================================

-- Rank column. NULL-able; NULLs sort last so any un-ranked voice never jumps to top.
ALTER TABLE public.veori_voice_library
  ADD COLUMN IF NOT EXISTS voice_rank INTEGER;

-- Seed a default order across the 7 cloned voices. Lower rank = shown first.
-- (Female + male alternating near the top so operators see variety immediately.)
UPDATE public.veori_voice_library SET voice_rank = 1  WHERE voice_id = 'uwJhTSUhU9LVyeRjWtiC'; -- Vexa   (female)
UPDATE public.veori_voice_library SET voice_rank = 2  WHERE voice_id = 'pwMBn0SsmN1220Aorv15'; -- Matt   (male)
UPDATE public.veori_voice_library SET voice_rank = 3  WHERE voice_id = 'hGQkZQUA5RiOXIw7P9iO'; -- Kiora  (female)
UPDATE public.veori_voice_library SET voice_rank = 4  WHERE voice_id = '02N42Ac51lYGp3HHsqw2'; -- Nick   (male)
UPDATE public.veori_voice_library SET voice_rank = 5  WHERE voice_id = 'aVR2rUXJY4MTezzJjPyQ'; -- Angel  (female)
UPDATE public.veori_voice_library SET voice_rank = 6  WHERE voice_id = '6YQMyaUWlj0VX652cY1C'; -- Steven (male)
UPDATE public.veori_voice_library SET voice_rank = 7  WHERE voice_id = 'jHprmvvyQreWpRuutdmV'; -- Blain  (male)

-- Verify: should list the 7 active voices in rank order.
-- SELECT voice_rank, voice_name, voice_gender
--   FROM public.veori_voice_library
--  WHERE is_active = true ORDER BY voice_rank NULLS LAST, voice_name;
