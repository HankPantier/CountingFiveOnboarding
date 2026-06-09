-- ============================================================
-- CountingFive Onboarding — allow 'content_edit' as an MBP suggestion origin
-- ============================================================
-- Direct edits to published website content (page/post markdown, via the
-- content editor or its AI agent) now run the MBP impact review like the
-- content-generation pipeline does. Those suggestions use origin
-- = 'content_edit'.
-- ============================================================

ALTER TABLE mbp_suggestions DROP CONSTRAINT mbp_suggestions_origin_check;

ALTER TABLE mbp_suggestions
  ADD CONSTRAINT mbp_suggestions_origin_check
  CHECK (origin IN ('page_edit', 'outline_edit', 'sitemap_confirm', 'resource', 'backfill', 'content_edit'));
