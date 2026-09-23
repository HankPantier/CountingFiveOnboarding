-- 075: content pipeline hardening (idempotent — safe to re-run).
--
-- 1. Attempt counters so per-item drafting pipelines stop auto-retrying a row
--    that keeps failing. The runners increment on each claim; the sweep cron /
--    self-chain only re-attempt rows under the cap (3); a human "Retry failed"
--    resets the counter to 0.
--      blog_batch_targets            — blog-batch fan-out targets
--      content_job_library_selections — included library articles
--      content_job_article_imports    — verbatim article imports
-- 2. page_outlines.generation_claimed_at — atomic per-row claim for the outline
--    runner, so a chained continuation and a re-trigger can't both generate (and
--    pay for) the same outline. Claimed only while h1 IS NULL; a claim older than
--    the outline route's max duration is treated as stale (dead worker).

ALTER TABLE blog_batch_targets
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

ALTER TABLE content_job_library_selections
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

ALTER TABLE content_job_article_imports
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

ALTER TABLE page_outlines
  ADD COLUMN IF NOT EXISTS generation_claimed_at timestamptz;

-- Verify:
--   SELECT table_name, column_name, data_type, column_default
--   FROM information_schema.columns
--   WHERE (table_name, column_name) IN (
--     ('blog_batch_targets','attempts'),
--     ('content_job_library_selections','attempts'),
--     ('content_job_article_imports','attempts'),
--     ('page_outlines','generation_claimed_at'));
