-- Migration 005: composite indexes on (content_job_id, page_url)
--
-- Every per-page query in the content pipeline filters by both columns
-- (research-pipeline, outline-generator, content-generator). Existing
-- single-column index on content_job_id helps but a composite avoids the
-- secondary filter and aligns with the natural ordering for status polling.

CREATE INDEX IF NOT EXISTS idx_research_results_job_url
  ON research_results(content_job_id, page_url);

CREATE INDEX IF NOT EXISTS idx_page_outlines_job_url
  ON page_outlines(content_job_id, page_url);

CREATE INDEX IF NOT EXISTS idx_generated_pages_job_url
  ON generated_pages(content_job_id, page_url);
