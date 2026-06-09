-- ============================================================
-- CountingFive Onboarding — rename Master Firm Profile → Master Business Profile
-- Run this entire file in Supabase → SQL Editor
-- ============================================================
-- Terminology change: "Master Firm Profile" (MFP) is now "Master Business
-- Profile" (MBP). The raw intake markdown column is renamed accordingly.
-- Data-preserving rename; apply in sync with the code deploy that reads/writes
-- sessions.mbp_content.
-- ============================================================

ALTER TABLE sessions RENAME COLUMN mfp_content TO mbp_content;
