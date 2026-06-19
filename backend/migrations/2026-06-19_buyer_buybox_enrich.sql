-- ─────────────────────────────────────────────────────────────────────────────
-- buyers — enrich the buy-box so matching has more than 3 fields, and add the
-- OPT-IN shared-pool flag.
--
-- WHY: today the buyers row carries only buy_box_states, buy_box_types, max_price.
-- That's too thin to match well at scale — a buyer who says "cash, $80k floor, only
-- Atlanta & Marietta, POF ready" has all of that thrown away. These columns let the
-- AI/regex capture (Step 3) write what the buyer actually told us, and let the
-- matcher (Step 4) filter on it.
--
-- share_to_pool is the OPT-IN consent flag (locked decision): buyers are PRIVATE by
-- default (false) — owner stays user_id — and an operator can flip a buyer into the
-- shared pool so another operator's fitting deal can be matched to them. This
-- migration only ADDS the flag; no fee logic, no cross-operator side effects here.
--
-- All ADD COLUMN IF NOT EXISTS — additive, nullable, idempotent, no drops, no data
-- loss. Every existing row keeps its current behavior (share_to_pool defaults false).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE buyers
  ADD COLUMN IF NOT EXISTS min_price          numeric,                 -- buy-box floor ($ they won't go below)
  ADD COLUMN IF NOT EXISTS property_cities    text[]   DEFAULT '{}',   -- city-level buy box (states too coarse in big metros)
  ADD COLUMN IF NOT EXISTS cash_only          boolean,                 -- true = cash buyer (null = unknown)
  ADD COLUMN IF NOT EXISTS proof_of_funds     boolean,                 -- POF on file (null = unknown)
  ADD COLUMN IF NOT EXISTS source             text,                    -- where the buyer came from: import | reply | manual
  ADD COLUMN IF NOT EXISTS last_contact_at    timestamptz,             -- recency for prioritization
  ADD COLUMN IF NOT EXISTS buybox_updated_at  timestamptz,             -- when AI/regex last refreshed the buy box
  ADD COLUMN IF NOT EXISTS share_to_pool      boolean  DEFAULT false;  -- OPT-IN: expose to cross-operator pool

-- Index the pool flag so the pool-aware matcher (Step 4) can pull shared buyers
-- without a full-table scan. Partial — only the opted-in rows are in the index.
CREATE INDEX IF NOT EXISTS buyers_share_to_pool_idx
  ON buyers (share_to_pool)
  WHERE share_to_pool = true;
