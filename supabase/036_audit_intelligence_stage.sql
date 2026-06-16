-- ============================================================
-- Revaltus Onboarding — Audit intelligence stage
-- Run this entire file in Supabase → SQL Editor
-- ============================================================
-- Adds the 'researching' progress stage (AI + off-site research) to the
-- audit_runs.audit_status CHECK constraint. The intelligence bundle itself is
-- stored inside the existing result JSONB (audit_runs.result.intelligence) — no
-- new column needed. Postgres auto-named the inline CHECK from migration 034
-- `audit_runs_audit_status_check`.
-- ============================================================

ALTER TABLE audit_runs
  DROP CONSTRAINT IF EXISTS audit_runs_audit_status_check;

ALTER TABLE audit_runs
  ADD CONSTRAINT audit_runs_audit_status_check CHECK (audit_status IN (
    'queued', 'crawling', 'analyzing', 'scoring',
    'researching', 'rendering', 'complete', 'error'
  ));
