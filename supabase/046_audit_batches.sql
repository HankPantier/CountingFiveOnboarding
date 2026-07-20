-- ============================================================
-- CountingFive Onboarding — Batch site audits
-- Run this entire file in Supabase → SQL Editor (or via the
-- Management API query endpoint).
-- ============================================================
-- Lets an admin paste many URLs and queue them as one batch that
-- runs strictly one-by-one. Each URL is a normal audit_runs row
-- (it already owns the per-run status machine, results, and error
-- state), so this migration only adds a batch rollup table plus the
-- grouping FK. The sequential runner lives in lib/audit/batch-runner.ts,
-- modeled on lib/content/blog-batch-runner.ts.
--
-- audit_batches.status is the run rollup; the per-URL lifecycle stays
-- on audit_runs.audit_status. Keeping the unit as audit_runs means every
-- batched audit also appears in the normal audits list and report views
-- with zero extra plumbing.
-- ============================================================

CREATE TABLE audit_batches (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  label        text        DEFAULT NULL,
  total_count  integer     NOT NULL,
  -- Author. SET NULL (not CASCADE) so removing a user never erases batch history.
  created_by   uuid        REFERENCES admins(id) ON DELETE SET NULL,
  status       text        NOT NULL DEFAULT 'running'
                 CHECK (status IN ('running', 'complete', 'error')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Group each queued audit under its batch. SET NULL keeps a run (and its
-- report) intact if the batch row is ever deleted.
ALTER TABLE audit_runs
  ADD COLUMN audit_batch_id uuid REFERENCES audit_batches(id) ON DELETE SET NULL;

CREATE INDEX idx_audit_runs_batch_id ON audit_runs(audit_batch_id);

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY — mirror migration 041 (admins-table membership)
-- ------------------------------------------------------------
-- Pipeline + API code writes via the service-role client, which bypasses RLS;
-- admin-only scoping is enforced in app code (requireAdminUser). This policy is
-- the safety net for any auth/anon-client path.
ALTER TABLE audit_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage audit_batches"
  ON audit_batches FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid()));
