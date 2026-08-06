-- ============================================================
-- CountingFive Onboarding — Theme Studio preview URL override
-- Run this entire file in Supabase → SQL Editor
-- ============================================================
-- The deployed URL the Theme Studio live preview should fetch and re-skin, for
-- when it differs from the client repo's site.config.ts `siteUrl`. Typical case:
-- a Vercel preview deployment (e.g. https://acme.vercel.app) while the client
-- is still being built, before DNS is switched to the final domain.
--
-- NULL → the preview falls back to site.config.ts `siteUrl` on the main branch.
-- App-validated (http(s) URL) in the /theme/preview-url route; no CHECK here.
-- ============================================================

ALTER TABLE content_jobs
  ADD COLUMN IF NOT EXISTS preview_url text;
