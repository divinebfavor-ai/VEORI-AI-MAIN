-- ═══════════════════════════════════════════════════════════════════════
-- VEORI AI - New Features Migration
-- Features: Missed Call Text-Back, SMS Inbox, Lead Pipeline,
--           Follow-Up Sequences UI, Appointment Booking
-- Run in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/xqllxyoeftkbufoungcz/sql
-- ═══════════════════════════════════════════════════════════════════════

-- ─── SMS MESSAGES (create if not already present) ───────────────────────────
CREATE TABLE IF NOT EXISTS sms_messages (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID REFERENCES users(id) ON DELETE CASCADE,
  lead_id             UUID REFERENCES leads(id) ON DELETE SET NULL,
  direction           TEXT NOT NULL,        -- 'inbound' | 'outbound'
  from_number         TEXT,
  to_number           TEXT,
  body                TEXT NOT NULL,
  telnyx_message_id   TEXT,
  status              TEXT DEFAULT 'sent',  -- 'sent' | 'received' | 'failed'
  sent_at             TIMESTAMPTZ DEFAULT NOW(),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_messages_user_id  ON sms_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_sms_messages_lead_id  ON sms_messages(lead_id);
CREATE INDEX IF NOT EXISTS idx_sms_messages_sent_at  ON sms_messages(sent_at DESC);

-- Add read-tracking columns to sms_messages (inbox feature)
ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS is_read   BOOLEAN DEFAULT FALSE;
ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS read_at   TIMESTAMPTZ;

-- ─── MISSED CALLS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS missed_calls (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  operator_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  lead_id         UUID REFERENCES leads(id) ON DELETE SET NULL,
  caller_phone    TEXT NOT NULL,
  called_at       TIMESTAMPTZ NOT NULL,
  direction       TEXT DEFAULT 'outbound', -- 'outbound' = we called them; 'inbound' = they called us
  outcome         TEXT,                    -- 'no_answer' | 'voicemail' | 'not_home'
  sms_sent        BOOLEAN DEFAULT FALSE,
  sms_sent_at     TIMESTAMPTZ,
  sms_message     TEXT,
  replied         BOOLEAN DEFAULT FALSE,
  replied_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_missed_calls_operator_id ON missed_calls(operator_id);
CREATE INDEX IF NOT EXISTS idx_missed_calls_caller_phone ON missed_calls(caller_phone);
CREATE INDEX IF NOT EXISTS idx_missed_calls_called_at   ON missed_calls(called_at DESC);

-- Missed call text-back settings on users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS missed_call_textback_enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS missed_call_message TEXT DEFAULT 'Hi, I just missed your call. I am interested in your property and would love to connect. What is the best time to reach you?';
ALTER TABLE users ADD COLUMN IF NOT EXISTS missed_call_delay_seconds INTEGER DEFAULT 60;

-- ─── LEAD PIPELINE STAGE ──────────────────────────────────────────────────────
-- Separate from 'status' so pipeline stage can be managed independently
ALTER TABLE leads ADD COLUMN IF NOT EXISTS pipeline_stage TEXT DEFAULT 'new';

CREATE INDEX IF NOT EXISTS idx_leads_pipeline_stage ON leads(pipeline_stage);

-- ─── AVAILABILITY SLOTS (Appointment Booking) ────────────────────────────────
CREATE TABLE IF NOT EXISTS availability_slots (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  operator_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  day_of_week     INTEGER NOT NULL,    -- 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  start_time      TIME NOT NULL,
  end_time        TIME NOT NULL,
  buffer_minutes  INTEGER DEFAULT 15,
  max_per_day     INTEGER DEFAULT 10,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_availability_slots_operator_id ON availability_slots(operator_id);

-- ─── APPOINTMENTS - add missing columns ───────────────────────────────────────
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminder_sent     BOOLEAN DEFAULT FALSE;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS confirmation_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS call_notes        TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS motivation_score  INTEGER;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS property_address  TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS lead_name         TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS lead_phone        TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS cancelled_at      TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_appointments_operator_id  ON appointments(user_id);
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled_at ON appointments(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_appointments_status       ON appointments(status);
