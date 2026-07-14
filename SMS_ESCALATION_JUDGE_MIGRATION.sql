-- VEORI AI - Judgment-based SMS -> voice escalation. Additive, safe to re-run.
--
-- Replaces the fixed score-threshold escalation with a per-message AI decision
-- (continue_sms | escalate_call | close_out). We log the decision, the AI's reasoning,
-- and the background PMI score at each step so decisions can be reviewed and tuned. The
-- full text history already lives in sms_messages.

CREATE TABLE IF NOT EXISTS sms_decisions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID REFERENCES users(id) ON DELETE CASCADE,
  lead_id            UUID REFERENCES leads(id) ON DELETE CASCADE,
  inbound_message_id TEXT,
  pmi_score          INTEGER,            -- background motivation score at this point
  pmi_signals        JSONB,              -- tracked signals (context, not the deciding rule)
  action             TEXT NOT NULL,      -- continue_sms | escalate_call | close_out
  reasoning          TEXT,               -- the AI's stated reason for this decision
  needs_human_review BOOLEAN DEFAULT false,
  message_count      INTEGER,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sms_decisions_lead ON sms_decisions(lead_id, created_at);

-- Set when the AI wants to call but the background score shows no motivation at all: a
-- human sanity-checks before the call is placed (this flags, it does not auto-block).
ALTER TABLE leads ADD COLUMN IF NOT EXISTS needs_human_review  BOOLEAN DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS human_review_reason TEXT;
