-- M5: Admin-curated nav configuration.
-- The default `confirmed_sitemap` (set in Phase 2) gives us URL + title +
-- parent for every confirmed page. nav_config lets the admin reorder pages,
-- rename labels for nav-only display, remove pages from nav (without
-- removing them from the site), and optionally specify a header CTA button.
-- buildNavJson() prefers nav_config when present.

ALTER TABLE content_jobs
  ADD COLUMN nav_config jsonb DEFAULT NULL;

COMMENT ON COLUMN content_jobs.nav_config IS
  'Admin-curated nav structure (see types/nav-json.ts NavJson). When non-null, replaces the auto-generated nav from confirmed_sitemap. Set in the Admin Nav Curation step before deliverable assembly.';
