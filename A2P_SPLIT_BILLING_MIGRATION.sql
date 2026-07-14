-- VEORI AI - Split billing on A2P approval. Additive, safe to re-run.
--
-- When a customer's A2P registration is APPROVED, billing switches from "bundled"
-- (Veori absorbs the Twilio cost) to "split": Veori charges the platform fee AND a
-- metered Twilio-usage passthrough to the customer's Stripe card-on-file, as TWO separate
-- charges. Twilio cannot bill a subaccount's card directly, so both charges run through
-- Veori's Stripe; Veori pays Twilio for the subaccount usage.

ALTER TABLE users ADD COLUMN IF NOT EXISTS a2p_billing_mode        TEXT DEFAULT 'bundled'; -- 'bundled' | 'split'
ALTER TABLE users ADD COLUMN IF NOT EXISTS a2p_split_activated_at  TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS a2p_platform_charge_id  TEXT;   -- Stripe PaymentIntent (platform fee)
ALTER TABLE users ADD COLUMN IF NOT EXISTS a2p_usage_charge_id     TEXT;   -- Stripe PaymentIntent (usage passthrough)
