-- ============================================================
-- CountingFive Onboarding — Content type dimension
-- Run this entire file in Supabase → SQL Editor (or via the
-- Management API query endpoint).
-- ============================================================
-- Adds a content_type to the long-form content pipeline so operators can
-- pick blog / thought-leadership / article / case-study up front. All types
-- still draft through lib/content/resource-draft-generator.generateResourceDraft
-- and land at content/posts/{slug}.md under /resources; the type only changes
-- the drafting prompt (length/structure/voice), the schema.org markup, and a
-- content_type frontmatter tag.
--
-- The column carries through both workflows:
--   blog_batches.content_type        → chosen for the whole batch
--   blog_batch_targets.content_type  → copied per client (audit trail)
--   resource_ideas.content_type      → the source of truth the drafter reads
--
-- Default 'blog' backfills every existing row to today's behavior.
-- The OneOffPanel snippet tool (oneoff_generations) is intentionally excluded:
-- it produces short copy, not long-form typed content.
-- ============================================================

ALTER TABLE resource_ideas
  ADD COLUMN content_type text NOT NULL DEFAULT 'blog'
    CHECK (content_type IN ('blog', 'thought-leadership', 'article', 'case-study'));

ALTER TABLE blog_batches
  ADD COLUMN content_type text NOT NULL DEFAULT 'blog'
    CHECK (content_type IN ('blog', 'thought-leadership', 'article', 'case-study'));

ALTER TABLE blog_batch_targets
  ADD COLUMN content_type text NOT NULL DEFAULT 'blog'
    CHECK (content_type IN ('blog', 'thought-leadership', 'article', 'case-study'));
