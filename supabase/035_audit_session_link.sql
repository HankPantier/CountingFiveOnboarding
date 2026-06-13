-- ============================================================
-- Revaltus Onboarding — Audit → Session bridge
-- Run this entire file in Supabase → SQL Editor
-- ============================================================
-- Adds an approval step to audits and indexes the existing (nullable)
-- audit_runs.session_id link. Semantics:
--   approved_at IS NOT NULL  → audit approved (unlocks "Start session")
--   session_id  IS NOT NULL  → a session was started from this audit
-- ============================================================

ALTER TABLE audit_runs
  ADD COLUMN approved_at timestamptz DEFAULT NULL,
  ADD COLUMN approved_by uuid DEFAULT NULL REFERENCES admins(id) ON DELETE SET NULL;

CREATE INDEX audit_runs_session_id_idx ON audit_runs(session_id);
