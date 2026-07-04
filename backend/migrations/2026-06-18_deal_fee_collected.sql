-- ─────────────────────────────────────────────────────────────────────────────
-- deals.fee_collected_at / deals.fee_collected_amount - the CLOSE RITUAL stamp.
--
-- WHY: when a deal hits status='closed' the assignment fee is the payday - but
-- nothing on the deal row recorded WHEN it was booked or HOW MUCH actually landed.
-- The close ritual (deals.js PATCH /:id/stage, stage='closed') now stamps these
-- two columns so the chart and analytics can show "fee collected $X on <date>"
-- without re-deriving it from contracts or title_logs.
--
-- Additive, nullable, defaults NULL. Every existing deal stays NULL (= not yet
-- booked through the ritual); behavior is unchanged until a deal closes through
-- the stage endpoint. fee_collected_amount mirrors deals.assignment_fee at the
-- moment of close (point-in-time snapshot - assignment_fee can be edited later).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS fee_collected_at     timestamptz,
  ADD COLUMN IF NOT EXISTS fee_collected_amount numeric;
