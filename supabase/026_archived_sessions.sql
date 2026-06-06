-- ============================================================
-- CountingFive Onboarding — session archival
-- Run this entire file in Supabase → SQL Editor
-- ============================================================
-- Soft-archive for finished engagements: archived sessions drop out of
-- the default dashboard list (and the inactivity-reminder cron) without
-- deleting any data. Restore derives status from current_phase.

ALTER TABLE sessions DROP CONSTRAINT sessions_status_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_status_check
  CHECK (status IN ('pending', 'in_progress', 'completed', 'approved', 'archived'));
