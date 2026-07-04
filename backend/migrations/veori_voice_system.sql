-- ════════════════════════════════════════════════════════════════════════════
-- VEORI Voice System (v2) - Twilio + ElevenLabs calling layer
-- ════════════════════════════════════════════════════════════════════════════
-- Part of the Vapi -> Twilio + ElevenLabs reroute. These tables are NEW and
-- additive only. They DO NOT modify or touch any existing table (users, leads,
-- calls, sms_messages, etc.). Run this whole file once in the Supabase SQL editor.
--
-- FK targets confirmed against schema.sql:
--   users.id  (UUID)  - the operator/user table
--   leads.id  (UUID)
-- ════════════════════════════════════════════════════════════════════════════

-- ── Module 1: ElevenLabs voice catalog ──────────────────────────────────────
-- Populated from the ElevenLabs API by the sync script (scripts/syncElevenLabsVoices.js).
-- Operators browse this list to pick their AI caller voice.
CREATE TABLE IF NOT EXISTS veori_voice_library (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voice_id          TEXT NOT NULL,                 -- ElevenLabs voice ID
  voice_name        TEXT NOT NULL,
  voice_preview_url TEXT,
  voice_gender      TEXT,
  voice_accent      TEXT,
  voice_description TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per ElevenLabs voice_id (sync upserts on this).
CREATE UNIQUE INDEX IF NOT EXISTS uq_veori_voice_library_voice_id
  ON veori_voice_library (voice_id);

CREATE INDEX IF NOT EXISTS idx_veori_voice_library_active
  ON veori_voice_library (is_active);


-- ── Module 2: Per-operator voice selection ──────────────────────────────────
-- The operator's chosen ElevenLabs voice + AI caller name for the new call layer.
-- NOTE: this is additive. The existing users.ai_voice_id / users.ai_caller_name
-- columns are left untouched; this table is the v2 source of truth for the
-- Twilio+ElevenLabs engine and falls back to users.* when absent.
CREATE TABLE IF NOT EXISTS veori_operator_voice_settings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  selected_voice_id TEXT,                          -- ElevenLabs voice ID
  ai_caller_name    TEXT NOT NULL DEFAULT 'Sarah',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One settings row per operator (upsert on this).
CREATE UNIQUE INDEX IF NOT EXISTS uq_veori_operator_voice_settings_operator
  ON veori_operator_voice_settings (operator_id);

-- ════════════════════════════════════════════════════════════════════════════
-- The call-log + transcript tables (veori_calls_v2, veori_call_transcripts_v2)
-- are introduced in a later module (Module 5/8). They are intentionally NOT in
-- this file so each module ships its own reviewed SQL, one at a time.
-- ════════════════════════════════════════════════════════════════════════════
