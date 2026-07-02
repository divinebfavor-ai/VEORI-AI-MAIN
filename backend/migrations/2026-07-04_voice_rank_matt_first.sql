-- ============================================================================
-- VOICE RANKING UPDATE — promote Matt to #1
-- Additive/idempotent. Writes ONLY to veori_voice_library.voice_rank.
-- Does NOT touch voice_name, voice_id, is_active, voice_preview_url, or anything else.
--
-- WHY: The operator judged Matt the most human-sounding lead voice, so he should
-- be #1 in the picker (was #2 in 2026-07-03_voice_rank.sql, behind Vexa). This
-- swaps Matt (1) and Vexa (2); ranks 3-7 are unchanged. This migration reflects
-- the state that was already applied live in Supabase — it exists so git matches
-- the live DB and the order is reproducible on a fresh restore.
--
-- HONESTY NOTE: the assistant cannot listen to audio; this ordering is the
-- operator's own ear-judgment applied via SQL, not an audio evaluation.
--
-- RUN THIS MANUALLY in the Supabase SQL editor if restoring. Review before running.
-- ============================================================================

UPDATE public.veori_voice_library SET voice_rank = 1 WHERE voice_id = 'pwMBn0SsmN1220Aorv15'; -- Matt (male)   — promoted to #1
UPDATE public.veori_voice_library SET voice_rank = 2 WHERE voice_id = 'uwJhTSUhU9LVyeRjWtiC'; -- Vexa (female) — moved to #2
-- Ranks 3-7 unchanged (Kiora 3, Nick 4, Angel 5, Steven 6, Blain 7).

-- Verify: should list the active voices in rank order, Matt first.
-- SELECT voice_rank, voice_name, voice_gender
--   FROM public.veori_voice_library
--  WHERE is_active = true ORDER BY voice_rank NULLS LAST, voice_name;
