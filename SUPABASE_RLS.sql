-- ============================================================
-- VEORI AI — Row Level Security (RLS) Policies
-- Run this once in Supabase SQL Editor
-- This is defense-in-depth: even if backend has a bug,
-- operators cannot see each other's data at the DB level.
-- ============================================================

-- NOTE: We use the service role key in the backend, which bypasses RLS.
-- RLS protects against direct Supabase client access (anon/authenticated keys).
-- It also protects if we ever switch to Supabase Auth in the future.

-- ── Enable RLS on all operator-data tables ──────────────────

ALTER TABLE leads              ENABLE ROW LEVEL SECURITY;
ALTER TABLE calls              ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns          ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals              ENABLE ROW LEVEL SECURITY;
ALTER TABLE follow_ups         ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sequences          ENABLE ROW LEVEL SECURITY;
ALTER TABLE tcpa_log           ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_numbers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE buyers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_activity      ENABLE ROW LEVEL SECURITY;
ALTER TABLE title_companies    ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;

-- ── Drop any existing policies (clean slate) ───────────────

DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- ── Helper: service_role bypasses everything ────────────────
-- Our backend uses service_role so all app queries are unaffected.
-- These policies only apply to anon / authenticated direct connections.

-- ── leads ──────────────────────────────────────────────────
CREATE POLICY "leads: owner only" ON leads
  FOR ALL USING (auth.uid()::text = user_id::text);

-- ── calls ──────────────────────────────────────────────────
CREATE POLICY "calls: owner only" ON calls
  FOR ALL USING (auth.uid()::text = user_id::text);

-- ── campaigns ──────────────────────────────────────────────
CREATE POLICY "campaigns: owner only" ON campaigns
  FOR ALL USING (auth.uid()::text = user_id::text);

-- ── deals ──────────────────────────────────────────────────
CREATE POLICY "deals: owner only" ON deals
  FOR ALL USING (auth.uid()::text = user_id::text);

-- ── follow_ups ─────────────────────────────────────────────
CREATE POLICY "follow_ups: owner only" ON follow_ups
  FOR ALL USING (auth.uid()::text = user_id::text);

-- ── conversations ──────────────────────────────────────────
CREATE POLICY "conversations: owner only" ON conversations
  FOR ALL USING (auth.uid()::text = user_id::text);

-- ── notifications ──────────────────────────────────────────
CREATE POLICY "notifications: owner only" ON notifications
  FOR ALL USING (auth.uid()::text = operator_id::text);

-- ── sequences ──────────────────────────────────────────────
CREATE POLICY "sequences: owner only" ON sequences
  FOR ALL USING (auth.uid()::text = user_id::text);

-- ── tcpa_log ───────────────────────────────────────────────
CREATE POLICY "tcpa_log: owner only" ON tcpa_log
  FOR ALL USING (auth.uid()::text = user_id::text);

-- ── phone_numbers ──────────────────────────────────────────
CREATE POLICY "phones: owner only" ON phone_numbers
  FOR ALL USING (auth.uid()::text = user_id::text);

-- ── buyers ─────────────────────────────────────────────────
CREATE POLICY "buyers: owner only" ON buyers
  FOR ALL USING (auth.uid()::text = user_id::text);

-- ── contracts ──────────────────────────────────────────────
CREATE POLICY "contracts: owner only" ON contracts
  FOR ALL USING (auth.uid()::text = user_id::text);

-- ── deal_activity ──────────────────────────────────────────
CREATE POLICY "deal_activity: owner only" ON deal_activity
  FOR ALL USING (auth.uid()::text = user_id::text);

-- ── title_companies ────────────────────────────────────────
CREATE POLICY "title_companies: owner only" ON title_companies
  FOR ALL USING (auth.uid()::text = user_id::text);

-- ── password_reset_tokens — no direct client access ────────
CREATE POLICY "prt: no direct access" ON password_reset_tokens
  FOR ALL USING (false);  -- service_role only

-- ── users — operators can only read/update their own row ───
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users: own row only" ON users
  FOR ALL USING (auth.uid()::text = id::text);

-- ============================================================
-- Done. Service role (backend) bypasses all of the above.
-- Direct client access (anon key) is now restricted per-operator.
-- ============================================================
