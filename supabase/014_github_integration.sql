-- ============================================================
-- CountingFive Onboarding — GitHub repo integration (editor)
-- Adds the link from a content job to its Phase II repo so the
-- in-admin editor knows which repo to read/write.
-- ============================================================

ALTER TABLE content_jobs
  ADD COLUMN github_repo text DEFAULT NULL;

COMMENT ON COLUMN content_jobs.github_repo IS
  'GitHub repo path in {org}/{name} form (e.g. countingfive/acmetax-site). '
  'NULL until the repo is provisioned. The in-admin editor is gated on this '
  'being non-null AND content_jobs.phase >= 6.';
