-- ============================================================================
-- SEED OPERATOR'S OWN CLONED VOICES + RETIRE STOCK VOICES
-- Additive/idempotent. Writes ONLY to veori_voice_library (the picker source).
-- Does NOT touch users, veori_operator_voice_settings, or any other table.
--
-- WHY: The library was seeded with 8 stock ElevenLabs voices (Brian, Charlie,
-- Jessica, Liam, Lily, Matilda, River, Will). The operator has cloned 7 of their
-- OWN voices in ElevenLabs and wants the picker to show ONLY those. This:
--   1. Upserts the 7 real cloned voices (real voice_id + chosen display name).
--   2. Deactivates the 8 stock voices (is_active=false) so they vanish from the
--      picker WITHOUT deleting the rows (reversible — flip is_active back to true).
--
-- voice_preview_url is left NULL here; run POST /api/v2/voices/sync (which reads
-- the live ElevenLabs catalog) later to backfill real preview clips + metadata.
-- The call audio does NOT need the preview — resolveOperatorVoiceId + streamTts
-- use voice_id directly.
--
-- RUN THIS MANUALLY in the Supabase SQL editor. Review before running.
-- ============================================================================

-- 1) Upsert the 6 cloned voices. ON CONFLICT keeps the row current if re-run.
INSERT INTO public.veori_voice_library
  (voice_id, voice_name, voice_gender, is_active, updated_at)
VALUES
  ('pwMBn0SsmN1220Aorv15', 'Matt',   'male',   true, now()),
  ('02N42Ac51lYGp3HHsqw2', 'Nick',   'male',   true, now()),
  ('uwJhTSUhU9LVyeRjWtiC', 'Vexa',   'female', true, now()),
  ('hGQkZQUA5RiOXIw7P9iO', 'Kiora',  'female', true, now()),
  ('6YQMyaUWlj0VX652cY1C', 'Steven', 'male',   true, now()),
  ('jHprmvvyQreWpRuutdmV', 'Blain',  'male',   true, now()),
  ('aVR2rUXJY4MTezzJjPyQ', 'Angel',  'female', true, now())
ON CONFLICT (voice_id) DO UPDATE
  SET voice_name   = EXCLUDED.voice_name,
      voice_gender = EXCLUDED.voice_gender,
      is_active    = true,
      updated_at   = now();

-- 2) Retire the stock voices (hidden from picker, rows preserved & reversible).
UPDATE public.veori_voice_library
   SET is_active = false, updated_at = now()
 WHERE voice_id IN (
   'nPczCjzI2devNBz1zQrb', -- Brian
   'IKne3meq5aSn9XLyUdCD', -- Charlie
   'cgSgspJ2msm6clMCkdW9', -- Jessica
   'TX3LPaxmHKxFdv7VOQHJ', -- Liam
   'pFZP5JQG7iQjIQuC4Bku', -- Lily
   'XrExE9yKIg1WjnnlVkGX', -- Matilda
   'SAz9YHcvj6GT2YYXdXww', -- River
   'bIHbv24MWmeRgasZH58o'  -- Will
 );

-- 3) Verify: should list ONLY the 6 cloned voices as active.
-- SELECT voice_id, voice_name, voice_gender, is_active
--   FROM public.veori_voice_library ORDER BY is_active DESC, voice_name;
