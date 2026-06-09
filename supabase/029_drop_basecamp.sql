-- ============================================================
-- CountingFive Onboarding — remove Basecamp integration
-- Run this entire file in Supabase → SQL Editor
-- ============================================================
-- The product pivoted away from Basecamp. Drop the singleton token table and
-- the per-session project pointer. Dropping the table also removes its RLS
-- policy. Safe to apply after the Basecamp code is removed (nothing reads
-- these objects anymore).
-- ============================================================

ALTER TABLE sessions DROP COLUMN IF EXISTS basecamp_project_id;
DROP TABLE IF EXISTS basecamp_tokens;
