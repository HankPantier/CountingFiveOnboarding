-- ============================================================
-- CountingFive Onboarding — token usage: task dimension + audit link
-- Run this entire file in Supabase → SQL Editor
-- ============================================================
-- Extends migration 018 so token_usage can be reported per CLIENT and per
-- high-level TASK (onboarding / audit / content), not just per content stage.
--
--   task      — the work category the call belongs to. Lets the Token Usage
--               dashboard roll spend up by onboarding vs audit vs content.
--   audit_id  — attribution for audit-stage calls that aren't tied to a
--               client session (standalone audits). When the audit IS linked
--               to a session, session_id is set too and the row rolls up to
--               that client; otherwise it falls into the "Unassigned" bucket.
--
-- The old stage CHECK was content-only; new call sites (onboarding chat, the
-- MBP/audit/content edit modals, audit intelligence, MBP + brand-doc gen) use
-- additional stages. Stage values are now validated by the TokenStage union in
-- lib/content/token-usage.ts rather than a DB constraint, so the CHECK is
-- dropped to avoid a migration every time a stage is added.
-- ============================================================

ALTER TABLE token_usage
  ADD COLUMN IF NOT EXISTS task     text NOT NULL DEFAULT 'content',
  ADD COLUMN IF NOT EXISTS audit_id uuid REFERENCES audit_runs(id) ON DELETE SET NULL;

-- Existing rows are all content-pipeline calls; the DEFAULT already backfills
-- them to 'content'. Constrain task to the three known categories.
ALTER TABLE token_usage
  DROP CONSTRAINT IF EXISTS token_usage_task_check;
ALTER TABLE token_usage
  ADD CONSTRAINT token_usage_task_check
  CHECK (task IN ('onboarding', 'audit', 'content'));

-- Stage is now app-validated (TokenStage union). Drop the content-only CHECK.
ALTER TABLE token_usage
  DROP CONSTRAINT IF EXISTS token_usage_stage_check;

-- Dashboard aggregation indexes: time-range scans, per-client and per-task rollups.
CREATE INDEX IF NOT EXISTS idx_token_usage_created_at ON token_usage(created_at);
CREATE INDEX IF NOT EXISTS idx_token_usage_session_created ON token_usage(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_token_usage_task ON token_usage(task);
CREATE INDEX IF NOT EXISTS idx_token_usage_audit_id ON token_usage(audit_id);

-- RLS (admins-only) is inherited from migration 018 — unchanged.
