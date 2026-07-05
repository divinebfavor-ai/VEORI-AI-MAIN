-- ─── Hot-path indexes for the recurring sweeps (2026-07-05) ──────────────────
-- Scale-readiness audit: the interval sweeps below run every few minutes against
-- tables that only had single-column / user_id indexes, so each tick was a
-- sequential scan once row counts grow (5k operators target). All additive,
-- IF NOT EXISTS, safe to run repeatedly.

-- sequenceEngine.processReadySequences(): status='active' AND next_action_at<=now
-- Partial index keeps it tiny - completed/cancelled rows (the vast majority over
-- time) are excluded entirely.
CREATE INDEX IF NOT EXISTS idx_sequences_active_due
  ON sequences (next_action_at)
  WHERE status = 'active';

-- emailReplyStop.cancelActiveEmailSequences() + enroll-dedup checks look up
-- sequences by lead + status.
CREATE INDEX IF NOT EXISTS idx_sequences_lead_status
  ON sequences (lead_id, status);

-- campaignManager boot rehydration scans campaigns by status='active';
-- dashboards/list endpoints filter by (user_id, status).
CREATE INDEX IF NOT EXISTS idx_campaigns_status
  ON campaigns (status);

CREATE INDEX IF NOT EXISTS idx_campaigns_user_status
  ON campaigns (user_id, status);

-- titleService.pollDueTitleFollowUps() (new sweep, 2026-07-05): due title-company
-- touches still pending. Mirrors idx_follow_ups_due_calls from
-- 2026-07-01_callback_time_precision.sql for the voice-callback sweep.
CREATE INDEX IF NOT EXISTS idx_follow_ups_due_title
  ON follow_ups (next_follow_up_at)
  WHERE contact_type = 'title_company' AND status = 'pending';
