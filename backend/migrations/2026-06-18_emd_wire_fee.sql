-- ─────────────────────────────────────────────────────────────────────────────
-- Post-contract deal lifecycle — EMD lifecycle + wire instructions + fee suggester.
--
-- WHY: once a buyer says YES the deal needs three things the schema couldn't track:
--   1. EMD (Earnest Money Deposit) lifecycle — the buyer's commitment signal. The
--      buyer-YES path auto-REQUESTS it; the operator manually CONFIRMs receipt.
--   2. Wire / escrow instructions — where the title company wants funds wired. A
--      DEFAULT lives on the title_companies profile; a per-deal OVERRIDE lives on
--      title_logs (a title co issues deal-specific sub-accounts).
--   3. Assignment-fee suggestion audit — the AI suggests a per-deal figure from the
--      spread (NO fixed band); we persist the suggestion + its basis for the record.
--
-- SECURITY: wire columns store ONLY a last-4 reference + free-text human
-- instructions. Full bank account / routing numbers are sensitive financial
-- credentials — they are NOT stored in plaintext here. The operator records the
-- instructions; the system keeps last-4 for reference/matching only.
--
-- All ADD COLUMN IF NOT EXISTS — additive, nullable, idempotent, no drops, no data
-- loss. Every existing row keeps its current behavior (emd_status defaults 'none',
-- emd_refundable defaults false = NON-refundable per the locked decision).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. deals — EMD lifecycle + fee-suggestion audit
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS emd_status                text    DEFAULT 'none',  -- none | requested | received | refunded | forfeited
  ADD COLUMN IF NOT EXISTS emd_amount                numeric,
  ADD COLUMN IF NOT EXISTS emd_refundable            boolean DEFAULT false,   -- default NON-refundable
  ADD COLUMN IF NOT EXISTS emd_requested_at          timestamptz,
  ADD COLUMN IF NOT EXISTS emd_received_at           timestamptz,
  ADD COLUMN IF NOT EXISTS emd_held_by               text,                    -- 'title' | 'operator' | free text
  ADD COLUMN IF NOT EXISTS assignment_fee_suggested  numeric,                 -- AI's suggested figure
  ADD COLUMN IF NOT EXISTS assignment_fee_basis      jsonb;                   -- {spread, arv, mao, ask, seller_cost, reason}

-- 2. title_companies — DEFAULT wire/escrow instructions (last-4 + text only)
ALTER TABLE title_companies
  ADD COLUMN IF NOT EXISTS wire_bank_name       text,
  ADD COLUMN IF NOT EXISTS wire_account_name    text,
  ADD COLUMN IF NOT EXISTS wire_routing_last4   text,
  ADD COLUMN IF NOT EXISTS wire_account_last4   text,
  ADD COLUMN IF NOT EXISTS wire_instructions    text;

-- 3. title_logs — PER-DEAL wire override + EMD mirror (deal-scoped isolation)
ALTER TABLE title_logs
  ADD COLUMN IF NOT EXISTS wire_bank_name       text,
  ADD COLUMN IF NOT EXISTS wire_account_name    text,
  ADD COLUMN IF NOT EXISTS wire_routing_last4   text,
  ADD COLUMN IF NOT EXISTS wire_account_last4   text,
  ADD COLUMN IF NOT EXISTS wire_instructions    text,
  ADD COLUMN IF NOT EXISTS emd_status           text,
  ADD COLUMN IF NOT EXISTS emd_amount           numeric;
