-- Migration 004: SEO depth + content quality gates
--
-- Adds:
--   page_outlines.cta                       — per-page CTA captured at outline review
--   generated_pages.admin_approved_content  — manual review gate before packaging
--   generated_pages.word_count_actual       — actual word count of generated copy
--   generated_pages.word_count_target       — sum of outline.sections.word_count

ALTER TABLE page_outlines
  ADD COLUMN cta jsonb DEFAULT NULL;
-- Shape: { "text": "Schedule a consultation", "url": "/contact" }

ALTER TABLE generated_pages
  ADD COLUMN admin_approved_content boolean NOT NULL DEFAULT false,
  ADD COLUMN word_count_actual int DEFAULT NULL,
  ADD COLUMN word_count_target int DEFAULT NULL;
pl