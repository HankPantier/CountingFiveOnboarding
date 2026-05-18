-- M2: Page-level hero annotations for Phase II.
-- These columns capture the hero block configuration that Claude declares in
-- the page-level frontmatter during Phase 5 content generation. The
-- assembler in the Phase II client-site template reads these to render the
-- correct hero variant.

ALTER TABLE generated_pages
  ADD COLUMN hero_block text NOT NULL DEFAULT 'page-header',
  ADD COLUMN hero_variant text DEFAULT NULL,
  ADD COLUMN hero_image text DEFAULT NULL;

COMMENT ON COLUMN generated_pages.hero_block IS
  'Block ID for the page opener: hero, hero-split, or page-header. Defaults to page-header.';

COMMENT ON COLUMN generated_pages.hero_variant IS
  'Variant for hero/hero-split (image|video|slider|image-right|image-left). Null for page-header.';

COMMENT ON COLUMN generated_pages.hero_image IS
  'Filename of the hero image from session-uploaded assets. Null if no image needed.';
