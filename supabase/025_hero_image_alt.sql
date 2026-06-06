-- ============================================================
-- CountingFive Onboarding — hero image alt text
-- Run this entire file in Supabase → SQL Editor
-- ============================================================
-- Model-written literal description of the page's hero photo. Flows to
-- the deliverable frontmatter as hero_image_alt; the template renders it
-- on Hero/HeroSplit instead of empty alt (WCAG + image SEO).

ALTER TABLE generated_pages
  ADD COLUMN hero_image_alt text DEFAULT NULL;
