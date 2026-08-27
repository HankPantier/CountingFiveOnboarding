-- ============================================================
-- CountingFive Onboarding — Industry (vertical) dimension
-- Run this entire file in Supabase → SQL Editor (or via the
-- Management API query endpoint).
-- ============================================================
-- Adds an industry tag to the long-form content pipeline so operators can
-- classify bulk/library content by vertical (tax & accounting today; more
-- verticals later) and filter by it when selecting library articles to include
-- in a new site during onboarding.
--
-- Mirrors the content_type dimension (migration 059). The column carries through
-- both workflows:
--   blog_batches.industry        → chosen for the whole batch (infer-then-confirm)
--   blog_batch_targets.industry  → copied per client (audit trail)
--   resource_ideas.industry      → the source of truth downstream filtering reads
--
-- Default 'tax-accounting' backfills every existing row to today's reality.
-- To add a vertical later: widen each CHECK constraint AND add the value to
-- lib/content/industries.ts (Industry union).
-- ============================================================

ALTER TABLE resource_ideas
  ADD COLUMN industry text NOT NULL DEFAULT 'tax-accounting'
    CHECK (industry IN ('tax-accounting'));

ALTER TABLE blog_batches
  ADD COLUMN industry text NOT NULL DEFAULT 'tax-accounting'
    CHECK (industry IN ('tax-accounting'));

ALTER TABLE blog_batch_targets
  ADD COLUMN industry text NOT NULL DEFAULT 'tax-accounting'
    CHECK (industry IN ('tax-accounting'));

-- Filtering the library by industry during onboarding selection.
CREATE INDEX IF NOT EXISTS idx_blog_batches_industry ON blog_batches(industry);
