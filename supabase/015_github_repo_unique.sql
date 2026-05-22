-- ============================================================
-- CountingFive Onboarding — guard against two content_jobs
-- pointing at the same GitHub repo. Partial UNIQUE so multiple
-- jobs can coexist with NULL (unprovisioned) repos.
-- ============================================================

CREATE UNIQUE INDEX content_jobs_github_repo_unique
  ON content_jobs (github_repo)
  WHERE github_repo IS NOT NULL;
