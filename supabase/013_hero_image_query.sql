-- Add a column for the Pexels search query Claude generates alongside each
-- hero image during Phase 5 content generation. The builder uses this at
-- deliverable assembly time to fetch a matching photo (combined with a
-- brand-aware visual-style suffix derived from palette + tone) and persist
-- it as a regular session asset.
--
-- Subject-only by design: "tax season paperwork accountant" rather than
-- "tax season paperwork accountant, professional photography, cool tone".
-- Visual style modifiers are appended by lib/content/visual-style-derivation.ts
-- at fetch time so style can be re-derived without re-running Claude.

ALTER TABLE generated_pages
  ADD COLUMN hero_image_query text DEFAULT NULL;

COMMENT ON COLUMN generated_pages.hero_image_query IS
  '3-8 word SUBJECT-only Pexels search query emitted by Phase I content generation. Visual style suffix is appended by the builder at fetch time. Null for page-header heroes where no photo is needed.';
