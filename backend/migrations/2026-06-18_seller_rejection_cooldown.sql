-- ─────────────────────────────────────────────────────────────────────────────
-- seller_profiles.last_rejection_at - rejection cooldown memory (E).
--
-- WHY: a hard "no" / "not interested" / "do not call" / hung-up is a SIGNAL, not a
-- dead end. Without remembering WHEN it happened, the AI re-pitches the exact same
-- offer the day after the seller said no - which burns the lead. This column stamps
-- the moment of the last rejection so the brain (dataMotService.buildAccumulatedIntelligenceBlock)
-- can adapt the re-approach:
--   <14 days  -> do NOT re-pitch; acknowledge the no, lead with something NEW, soft.
--   14–60 days -> enough time passed; re-open warmly ("anything changed on your end?").
--   >60 days  -> stale; treat as a normal touch.
--
-- Additive, nullable, defaults NULL. recordCallIntelligence() writes it best-effort
-- only on a rejection outcome; every existing row simply stays NULL (= no rejection
-- on file) and behavior is unchanged until a real "no" lands.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE seller_profiles
  ADD COLUMN IF NOT EXISTS last_rejection_at timestamptz;
