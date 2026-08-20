-- 056: per-page generation attempt counter. The batch runner auto-retries an
-- errored page on a chained invocation (a single transient 529/timeout no longer
-- becomes a permanent "1 failed"). This counter bounds that: after MAX_ATTEMPTS
-- the page is treated as terminally failed and lands in ERRORS.md, so a
-- genuinely un-generatable page can't be retried indefinitely and burn tokens.
-- Incremented on each atomic 'running' claim in generateSinglePage.
ALTER TABLE generated_pages ADD COLUMN IF NOT EXISTS generation_attempts integer NOT NULL DEFAULT 0;
