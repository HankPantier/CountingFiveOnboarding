-- ============================================================
-- Revaltus Onboarding — allow 'pre_gen_enrichment' as an MBP suggestion origin
-- ============================================================
-- The pre-generation enrichment pass (lib/mbp/pre-gen-enrichment.ts) runs before
-- the first content generation to deepen the content-critical MBP fields (niche
-- depth, positioning, voice) from the site audit + call notes, filing pending
-- suggestions for admin review. Those suggestions use origin =
-- 'pre_gen_enrichment'. Without this the INSERT fails the origin CHECK and the
-- suggestion is silently dropped.
-- ============================================================

ALTER TABLE mbp_suggestions DROP CONSTRAINT mbp_suggestions_origin_check;

ALTER TABLE mbp_suggestions
  ADD CONSTRAINT mbp_suggestions_origin_check
  CHECK (origin IN ('page_edit', 'outline_edit', 'sitemap_confirm', 'resource', 'backfill', 'content_edit', 'generate_content', 'site_structure', 'pre_gen_enrichment'));
