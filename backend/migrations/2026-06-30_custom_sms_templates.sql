-- ─── Custom SMS templates: operator-authored, guard-railed wholesale-RE copy ──
-- Lets operators save their OWN SMS outreach text (or AI-generated drafts) and
-- point a campaign blast at one. All additive, nullable, idempotent - safe to run
-- more than once and a no-op if already applied. No existing data is modified.
-- Run manually in the Supabase SQL editor.
--
-- Backward compatibility: every send path defaults to the existing built-in
-- per-tag templates when no custom template is selected, so running this migration
-- only ENABLES custom copy - it never changes how current campaigns behave.

-- A saved, reusable SMS template owned by one operator.
--   body            - the template text with {first_name}/{address}/{city}/{operator} tokens.
--   lead_type       - optional tag this template is meant for (pre_foreclosure, probate, …);
--                     NULL = a general template usable for any lead.
--   ai_generated    - TRUE if drafted by the AI generator (vs hand-written).
--   moderation_*    - the result of the wholesale-RE guardrail at save time.
CREATE TABLE IF NOT EXISTS public.sms_templates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  body              TEXT NOT NULL,
  lead_type         TEXT,
  ai_generated      BOOLEAN     DEFAULT FALSE,
  moderation_status TEXT        DEFAULT 'approved',   -- approved | rejected (only approved ever stored)
  moderation_reason TEXT,
  is_active         BOOLEAN     DEFAULT TRUE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Fast "this operator's active templates" lookup.
CREATE INDEX IF NOT EXISTS idx_sms_templates_user
  ON public.sms_templates (user_id, is_active);

-- Let a campaign blast use a saved custom template instead of the built-in copy.
-- Nullable → existing campaigns keep using the built-in per-tag templates.
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS custom_sms_template_id UUID REFERENCES public.sms_templates(id) ON DELETE SET NULL;
