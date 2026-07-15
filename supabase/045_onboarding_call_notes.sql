-- ============================================================
-- Revaltus Onboarding — Rep-driven onboarding: call notes
-- Run this entire file in Supabase → SQL Editor
-- ============================================================
-- Onboarding now happens on a live call the rep drives. This adds:
--   call_notes         — freeform notes the rep captures during the call
--   notes_extracted_at — set when the agent extracts notes into schema_data
--                        (drives which onboarding stage the admin UI shows)
--   created_by         — the rep/admin who created the session (auditability;
--                        sessions previously tracked no author)
-- ============================================================

ALTER TABLE sessions
  ADD COLUMN call_notes text DEFAULT NULL,
  ADD COLUMN notes_extracted_at timestamptz DEFAULT NULL,
  ADD COLUMN created_by uuid DEFAULT NULL REFERENCES admins(id) ON DELETE SET NULL;
