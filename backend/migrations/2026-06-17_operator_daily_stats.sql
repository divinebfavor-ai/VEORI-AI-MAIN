-- ─────────────────────────────────────────────────────────────────────────────
-- operator_daily_stats - per-operator, per-day rollup of outreach + dispo volume.
--
-- WHY: at 1M+ SMS / operator, summing sms_messages live for a 30-day window is a
-- full table scan every dashboard load. This table holds ONE row per operator per
-- day with the day's totals. Analytics endpoints sum these rows for past days
-- (O[days]) and only live-count "today", keeping reporting O(days) not O(messages).
--
-- Populated nightly by analyticsRollup.rollupYesterday() via the RUN_CRON-gated
-- "analytics-rollup" repeatable job (~00:15). Idempotent: re-running a day UPSERTs.
-- Additive only - nothing reads/writes this table except the rollup job + endpoints.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS operator_daily_stats (
  user_id            uuid        NOT NULL,
  stat_date          date        NOT NULL,

  -- Outreach (SMS)
  sms_sent           integer     NOT NULL DEFAULT 0,
  sms_replies        integer     NOT NULL DEFAULT 0,

  -- Voice
  calls_made         integer     NOT NULL DEFAULT 0,
  call_minutes       integer     NOT NULL DEFAULT 0,
  appointments       integer     NOT NULL DEFAULT 0,
  offers_made        integer     NOT NULL DEFAULT 0,

  -- Disposition / revenue
  buyers_blasted     integer     NOT NULL DEFAULT 0,
  deals_closed       integer     NOT NULL DEFAULT 0,
  assignment_revenue numeric     NOT NULL DEFAULT 0,

  updated_at         timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (user_id, stat_date)
);

-- Fast "last N days for this operator" range scans.
CREATE INDEX IF NOT EXISTS idx_operator_daily_stats_user_date
  ON operator_daily_stats (user_id, stat_date DESC);

-- Operators may only read their own rollup rows. The rollup job runs with the
-- service-role key (RLS-bypassing), so no INSERT/UPDATE policy is needed here.
ALTER TABLE operator_daily_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operator_daily_stats_select_own ON operator_daily_stats;
CREATE POLICY operator_daily_stats_select_own
  ON operator_daily_stats
  FOR SELECT
  USING (auth.uid() = user_id);
