-- ============================================================
-- CountingFive Onboarding — Library-content review gate
-- Run this entire file in Supabase → SQL Editor (or via the
-- Management API query endpoint).
-- ============================================================
-- Records that the operator made an explicit library-content inclusion choice
-- (select + save, or save none) while proofing the outline at phase 4. Content
-- generation (the phase 4 → 5 advance) is gated on this being set, so a direct
-- PATCH can't skip the review step the OutlinePhase UI already enforces.
--
-- Stamped by POST /api/content-jobs/[id]/library on every save (including the
-- zero-selection "continue without extra content" case).
-- ============================================================

ALTER TABLE content_jobs
  ADD COLUMN IF NOT EXISTS library_reviewed_at timestamptz DEFAULT NULL;

-- Backfill jobs that already passed the outline stage (phase >= 5) so an existing
-- in-flight job can't be blocked from re-triggering generation. New jobs stamp
-- themselves when the operator saves the library panel at phase 4.
UPDATE content_jobs
  SET library_reviewed_at = updated_at
  WHERE phase >= 5 AND library_reviewed_at IS NULL;
