-- Phase I → Phase II: dedicated hero subheadline.
-- Until now the Phase II Hero/HeroSplit/PageHeader components used
-- meta_description as the subheadline, which forced one string to do two
-- jobs (SERP teaser AND on-page hero copy). This column lets the content
-- generator emit a punchier, benefit-led line for the hero specifically,
-- while meta_description stays optimized for search snippets.

ALTER TABLE generated_pages
  ADD COLUMN hero_subhead text DEFAULT NULL;

COMMENT ON COLUMN generated_pages.hero_subhead IS
  'Benefit-led hero subheadline (12-18 words). Distinct from meta_description, which targets SERP snippets. Phase II falls back to meta_description when this is null.';
