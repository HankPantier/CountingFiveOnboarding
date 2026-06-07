-- ============================================================
-- CountingFive Onboarding — reverse-link audit trail
-- Run this entire file in Supabase → SQL Editor
-- ============================================================
-- Records which existing posts were auto-edited to link back to a newly
-- drafted post. Written after the main draft push, in a second commit on the
-- draft branch. Each entry: { slug, path, anchorText, insertedInto }.
-- Non-fatal feature: failure to populate never blocks the draft.
-- ============================================================

ALTER TABLE resource_ideas
  ADD COLUMN reverse_links jsonb NOT NULL DEFAULT '[]';
