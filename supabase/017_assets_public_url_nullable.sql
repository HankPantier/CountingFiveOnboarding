-- ============================================================
-- CountingFive Onboarding — make assets.public_url nullable.
-- The session-assets bucket is private; we no longer store
-- public URLs on insert (admin UIs sign on demand). New rows
-- write NULL.
-- ============================================================

ALTER TABLE assets
  ALTER COLUMN public_url DROP NOT NULL;
