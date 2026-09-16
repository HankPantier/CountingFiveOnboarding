-- ============================================================
-- Revaltus Onboarding — allow 'mbp_chat' as an MBP suggestion origin
-- ============================================================
-- The admin MBP edit chat (app/api/mbp/[id]/chat) no longer writes schema_data
-- directly. It now files pending suggestions for a human approve/dismiss, using
-- origin = 'mbp_chat'. Without this the INSERT fails the origin CHECK and the
-- suggestion is silently dropped.
-- ============================================================

ALTER TABLE mbp_suggestions DROP CONSTRAINT mbp_suggestions_origin_check;

ALTER TABLE mbp_suggestions
  ADD CONSTRAINT mbp_suggestions_origin_check
  CHECK (origin IN ('page_edit', 'outline_edit', 'sitemap_confirm', 'resource', 'backfill', 'content_edit', 'generate_content', 'site_structure', 'pre_gen_enrichment', 'mbp_chat'));
