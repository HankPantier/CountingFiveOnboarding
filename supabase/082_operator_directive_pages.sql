-- ============================================================
-- 082: Operator-directive page treatment in the content pipeline
-- ============================================================
--
-- The Audit Review "Notes & instructions" cards (schema_data.operator_directives)
-- can say a crawled page must be brought over VERBATIM, or that one page's
-- content is merged into another. The sitemap confirm step now copies that onto
-- each page's pipeline rows so generation honors it:
--
--   page_outlines.generation_mode       'generate' (default AI write) or
--                                       'verbatim' (reproduce the captured
--                                       snapshot; AI writes SEO fields only)
--   page_outlines.source_snapshot_path  private session-assets object
--                                       (snapshots/{sessionId}/{uuid}.md)
--                                       holding the captured markdown
--   page_outlines.merge_source_urls     crawled page paths folded into this
--                                       page by a merge directive
--   research_results.merged_content     text fetched from those pages at
--                                       research time, fed to outline + body
--
-- Additive with safe defaults: existing rows read as plain 'generate' pages.
-- Idempotent. Apply, then regenerate types/database.ts.
-- ============================================================

ALTER TABLE page_outlines
  ADD COLUMN IF NOT EXISTS generation_mode text NOT NULL DEFAULT 'generate',
  ADD COLUMN IF NOT EXISTS source_snapshot_path text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS merge_source_urls text[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'page_outlines_generation_mode_check'
  ) THEN
    ALTER TABLE page_outlines
      ADD CONSTRAINT page_outlines_generation_mode_check
      CHECK (generation_mode IN ('generate', 'verbatim'));
  END IF;
END $$;

ALTER TABLE research_results
  ADD COLUMN IF NOT EXISTS merged_content text DEFAULT NULL;
