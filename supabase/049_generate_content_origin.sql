-- ============================================================
-- CountingFive Onboarding — allow 'generate_content' as an MBP suggestion origin
-- ============================================================
-- The Generate Content assistant (freeform, MBP-grounded content chat opened
-- from /admin/content) files pending MBP suggestions when the conversation
-- surfaces a durable fact worth adding to the profile. Those suggestions use
-- origin = 'generate_content'.
-- ============================================================

ALTER TABLE mbp_suggestions DROP CONSTRAINT mbp_suggestions_origin_check;

ALTER TABLE mbp_suggestions
  ADD CONSTRAINT mbp_suggestions_origin_check
  CHECK (origin IN ('page_edit', 'outline_edit', 'sitemap_confirm', 'resource', 'backfill', 'content_edit', 'generate_content'));
