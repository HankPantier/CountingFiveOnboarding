-- ============================================================
-- CountingFive Onboarding — pipeline concurrency guards
-- Run this entire file in Supabase → SQL Editor
-- ============================================================
-- 1. resource_ideas.social_status: in-flight lock for social-suggestion
--    generation. Without it a double-click fired two concurrent Claude
--    runs + GitHub write collisions. Mirrors the generation_status
--    pattern from generated_pages (CLAUDE.md content-pipeline rule).
-- 2. oneoff_generations.status admits 'pending': the trigger route now
--    inserts a queued row and the worker claims it atomically
--    (pending → running), so a sweep/retry overlap can't double-run.
-- ============================================================

ALTER TABLE resource_ideas
  ADD COLUMN social_status text NOT NULL DEFAULT 'idle'
    CHECK (social_status IN ('idle', 'running', 'complete', 'error'));

ALTER TABLE oneoff_generations
  ALTER COLUMN status SET DEFAULT 'pending';

ALTER TABLE oneoff_generations DROP CONSTRAINT oneoff_generations_status_check;
ALTER TABLE oneoff_generations ADD CONSTRAINT oneoff_generations_status_check
  CHECK (status IN ('pending', 'running', 'complete', 'error'));
