-- ============================================================
-- CountingFive Onboarding — research_results.updated_at
-- Run this entire file in Supabase → SQL Editor
-- ============================================================
--
-- Adds an updated_at column to research_results so the restart endpoint
-- can detect stale 'running' rows (orphaned by a crashed pipeline) and
-- safely reset them. Backfills existing rows with the migration time.
-- Application code is responsible for setting updated_at on each UPDATE,
-- matching the convention used by content_jobs and page_outlines.

ALTER TABLE research_results
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_research_results_status_updated
  ON research_results(research_status, updated_at);
