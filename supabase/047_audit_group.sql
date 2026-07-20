-- ============================================================
-- CountingFive Onboarding — Audit lifecycle folders
-- Run this entire file in Supabase → SQL Editor (or via the
-- Management API query endpoint).
-- ============================================================
-- Groups audits into three pipeline folders so the list stays
-- navigable as volume grows:
--   prospect (default) → working (a session was started from it)
--                      → client (content generated, content_jobs.phase >= 6)
--
-- Orthogonal to audit_status (the run's job state machine). Folders
-- track the business (domain): app code propagates a move across all
-- of a domain's runs and new runs inherit the domain's current folder.
-- Auto-transitions are forward-only; manual moves are authoritative.
-- ============================================================

ALTER TABLE audit_runs
  ADD COLUMN audit_group text NOT NULL DEFAULT 'prospect'
  CHECK (audit_group IN ('prospect', 'working', 'client'));

CREATE INDEX idx_audit_runs_group ON audit_runs(audit_group);

-- ------------------------------------------------------------
-- Backfill existing rows so they land in sensible folders.
-- ------------------------------------------------------------
-- Any audit that spawned a session is at least 'working'.
UPDATE audit_runs SET audit_group = 'working' WHERE session_id IS NOT NULL;

-- A session whose content pipeline reached phase 6 → 'client'.
UPDATE audit_runs a SET audit_group = 'client'
FROM content_jobs c
WHERE a.session_id = c.session_id AND c.phase >= 6;

-- Propagate the most-advanced group across each (domain, created_by) group so a
-- site's re-audits share one folder. created_by may be null (admin deleted).
WITH ranked AS (
  SELECT domain, created_by,
    MAX(CASE audit_group WHEN 'client' THEN 3 WHEN 'working' THEN 2 ELSE 1 END) AS lvl
  FROM audit_runs
  GROUP BY domain, created_by
)
UPDATE audit_runs a
SET audit_group = CASE r.lvl WHEN 3 THEN 'client' WHEN 2 THEN 'working' ELSE 'prospect' END
FROM ranked r
WHERE a.domain = r.domain
  AND a.created_by IS NOT DISTINCT FROM r.created_by
  AND a.audit_group <> (CASE r.lvl WHEN 3 THEN 'client' WHEN 2 THEN 'working' ELSE 'prospect' END);
