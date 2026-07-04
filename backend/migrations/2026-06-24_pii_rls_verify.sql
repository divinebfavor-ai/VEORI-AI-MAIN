-- ─────────────────────────────────────────────────────────────────────────────
-- S4 - PII ROW-LEVEL SECURITY (defense in depth).
--
-- WHY:
--   The backend talks to Postgres with the Supabase SERVICE-ROLE key, which
--   BYPASSES RLS. Tenant isolation is therefore enforced in code TODAY - every
--   route scopes by `.eq('user_id', req.user.id)`. RLS here is a SECOND wall: it
--   protects the most sensitive PII tables if a row is ever reached via the anon
--   key, a Supabase client, the auto-generated REST/Realtime API, or a future
--   direct query that forgets the user filter.
--
-- SAFETY (zero regression):
--   • Enabling RLS does NOT affect the service-role connection the backend uses -
--     the service role keeps full access (BYPASSRLS), so every existing route works
--     byte-for-byte. We add ONLY owner-scoped SELECT policies; writes continue
--     through the service role, so no INSERT/UPDATE/DELETE policy is required.
--   • `ENABLE ROW LEVEL SECURITY` is idempotent; `DROP POLICY IF EXISTS` before each
--     `CREATE POLICY` makes the whole file safe to re-run.
--   • Matches the established precedent in 2026-06-18_buyer_deal_history.sql.
--
-- SCOPE: the highest-sensitivity, user-owned tables. Other tables can adopt the
-- same 3-line block later; this migration intentionally targets PII first.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── bank_accounts - routing/account stubs + encrypted full numbers (S4) ──────
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bank_accounts_select_own ON bank_accounts;
CREATE POLICY bank_accounts_select_own
  ON bank_accounts FOR SELECT
  USING (auth.uid() = user_id);

-- ── leads - seller names, phones, addresses, motivation/financial detail ─────
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leads_select_own ON leads;
CREATE POLICY leads_select_own
  ON leads FOR SELECT
  USING (auth.uid() = user_id);

-- ── buyers - buyer contacts, proof-of-funds, NCA status ──────────────────────
ALTER TABLE buyers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS buyers_select_own ON buyers;
CREATE POLICY buyers_select_own
  ON buyers FOR SELECT
  USING (auth.uid() = user_id);

-- ── deals - contract economics tied to a seller + buyer ──────────────────────
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deals_select_own ON deals;
CREATE POLICY deals_select_own
  ON deals FOR SELECT
  USING (auth.uid() = user_id);

-- ── contracts - executed agreements with signer PII ──────────────────────────
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contracts_select_own ON contracts;
CREATE POLICY contracts_select_own
  ON contracts FOR SELECT
  USING (auth.uid() = user_id);

-- ── funding_requests - operator's funding intents (S4 + F17) ─────────────────
ALTER TABLE funding_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS funding_requests_select_own ON funding_requests;
CREATE POLICY funding_requests_select_own
  ON funding_requests FOR SELECT
  USING (auth.uid() = user_id);

-- VERIFY (run after applying):
--   SELECT relname, relrowsecurity
--   FROM pg_class
--   WHERE relname IN ('bank_accounts','leads','buyers','deals','contracts','funding_requests');
--   -- every relrowsecurity should be `t` (true).
