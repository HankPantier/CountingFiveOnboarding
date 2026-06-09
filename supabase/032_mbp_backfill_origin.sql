-- ============================================================
-- CountingFive Onboarding — allow 'backfill' as an MBP suggestion origin
-- ============================================================
-- The "Fill from what we know" action derives values for empty MBP fields
-- from information already present elsewhere in the profile (positioning
-- statement, niches, service descriptions) and queues them as suggestions
-- for admin approval. These rows use origin = 'backfill'.
-- ============================================================

ALTER TABLE mbp_suggestions DROP CONSTRAINT mbp_suggestions_origin_check;

ALTER TABLE mbp_suggestions
  ADD CONSTRAINT mbp_suggestions_origin_check
  CHECK (origin IN ('page_edit', 'outline_edit', 'sitemap_confirm', 'resource', 'backfill'));
