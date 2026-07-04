-- ─────────────────────────────────────────────────────────────────────────────
-- buyer_deal_history - per-buyer × per-deal outcome log (the BUYER-side brain).
--
-- WHY: the `buyers` table already holds a buyer's STATIC buy-box (states, types,
-- max_price, repair_tolerance, notes). `buyer_campaigns` is per-DEAL (how a blast
-- went), not per-BUYER. Nothing today remembers, for one buyer, which deals they
-- were offered and how each one landed - so the AI re-pitches a buyer with zero
-- memory of their actual track record.
--
-- This table is that record: ONE row per buyer×deal touch with the outcome. From
-- it, dataMotService.getBuyerIntelligence() derives a buyer's real pattern (deals
-- won vs passed, typical % of ARV they buy at, last outcome, common pass reason)
-- and injects it into the buyer-call system prompt. So the AI can say "Last two I
-- sent you, you passed on heavy rehab - this one's a light cosmetic, fits you."
--
-- Additive only. Written best-effort by the dispo/assign path; read by the buyer
-- brain. A missing row simply means "no history yet" and the prompt is unchanged.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS buyer_deal_history (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  buyer_id        uuid        NOT NULL,
  deal_id         uuid,
  user_id         uuid        NOT NULL,

  -- Snapshot of what this buyer was offered (point-in-time; deals/ARV change later).
  offered_price   numeric,
  arv             numeric,
  property_state  text,
  property_type   text,

  -- How the touch landed. offered -> interested -> won, or passed/lost.
  --   offered    = blasted / pitched, no response yet
  --   interested = replied YES / engaged
  --   passed     = explicitly not interested in THIS deal
  --   won        = assigned to this buyer (they bought)
  --   lost       = deal fell through after they engaged
  outcome         text        NOT NULL DEFAULT 'offered',
  reason          text,                            -- free-text "why" (e.g. "repairs too heavy")

  created_at      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (id)
);

-- Fast "all history for this buyer, newest first" - the read pattern of the brain.
CREATE INDEX IF NOT EXISTS idx_buyer_deal_history_buyer
  ON buyer_deal_history (buyer_id, created_at DESC);

-- One outcome row per (buyer, deal) - re-touching a deal UPSERTs rather than piling
-- duplicates. deal_id may be null (ad-hoc pitch), so the unique guard is partial.
CREATE UNIQUE INDEX IF NOT EXISTS uq_buyer_deal_history_buyer_deal
  ON buyer_deal_history (buyer_id, deal_id)
  WHERE deal_id IS NOT NULL;

-- Operators may only read their own buyer history. Writes go through the
-- service-role key (RLS-bypassing), so no INSERT/UPDATE policy is needed here.
ALTER TABLE buyer_deal_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS buyer_deal_history_select_own ON buyer_deal_history;
CREATE POLICY buyer_deal_history_select_own
  ON buyer_deal_history
  FOR SELECT
  USING (auth.uid() = user_id);
