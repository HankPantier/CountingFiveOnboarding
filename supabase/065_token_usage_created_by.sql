-- ============================================================
-- CountingFive Onboarding — per-user token attribution
-- Run this entire file in Supabase → SQL Editor.
-- ============================================================
-- Adds `created_by` to token_usage so every AI call attributes to a person, and
-- to content_jobs so background content generation (which runs under after()/cron
-- with no live user at record time) can carry the kickoff user. recordTokenUsage
-- resolves the actor from audit_id → audit_runs.created_by / content_job_id →
-- content_jobs.created_by when the caller can't pass it directly.
-- ON DELETE SET NULL (not CASCADE) so removing an admin never erases spend history.
-- ============================================================

-- 1. Attribution column on token_usage.
ALTER TABLE token_usage
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES admins(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_token_usage_created_by ON token_usage(created_by);

-- 2. Carry the kickoff user into background content generation.
ALTER TABLE content_jobs
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES admins(id) ON DELETE SET NULL;

-- 3. Best-effort backfill of existing rows (rows we can confidently attribute;
--    everything else stays null = "Unattributed" in the dashboard).

-- 3a. Audit-linked rows → the admin who triggered the audit.
UPDATE token_usage tu
   SET created_by = ar.created_by
  FROM audit_runs ar
 WHERE tu.created_by IS NULL
   AND tu.audit_id = ar.id
   AND ar.created_by IS NOT NULL;

-- 3b. Content rows whose job traces to a blog batch → the batch author.
UPDATE token_usage tu
   SET created_by = bb.created_by
  FROM blog_batch_targets bbt
  JOIN blog_batches bb ON bb.id = bbt.batch_id
 WHERE tu.created_by IS NULL
   AND tu.content_job_id = bbt.content_job_id
   AND bb.created_by IS NOT NULL;

-- RLS (admins-only) is inherited from migration 018 — unchanged.
