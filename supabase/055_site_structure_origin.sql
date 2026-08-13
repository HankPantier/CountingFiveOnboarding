-- ============================================================
-- CountingFive Onboarding — allow 'site_structure' as an MBP suggestion origin
-- ============================================================
-- The Site Assistant (site-wide structural chat in the content editor: add /
-- delete pages, edit navigation) files a pending MBP suggestion to sync the
-- firm's target niches when audience pages change. Those suggestions use
-- origin = 'site_structure'. Without this the INSERT fails the origin CHECK and
-- the suggestion is silently dropped (insertMbpSuggestion returns filed:false).
-- ============================================================

ALTER TABLE mbp_suggestions DROP CONSTRAINT mbp_suggestions_origin_check;

ALTER TABLE mbp_suggestions
  ADD CONSTRAINT mbp_suggestions_origin_check
  CHECK (origin IN ('page_edit', 'outline_edit', 'sitemap_confirm', 'resource', 'backfill', 'content_edit', 'generate_content', 'site_structure'));
