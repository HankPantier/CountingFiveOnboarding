-- ============================================================
-- CountingFive Onboarding — tighten RLS to admin-table membership
-- ============================================================
-- Migration 001 enabled RLS but granted access to ALL authenticated
-- users via `USING (true) TO authenticated`. Combined with requireAdmin
-- only verifying authentication (not admin-table membership), any
-- Supabase user with a valid session effectively had admin access.
--
-- This migration replaces the loose policies with strict ones that
-- check the caller exists in `admins`.
--
-- PREREQUISITE: before applying this migration, seed your own admin
-- record. Run in the Supabase SQL editor (uncomment + fill in):
--
--   INSERT INTO admins (id, email, name) VALUES (
--     '<your-auth.users.id-uuid-here>',
--     'you@example.com',
--     'Your Name'
--   );
--
-- If you don't seed first, you'll lock yourself out of /admin/*.
-- The admins.id column FKs to auth.users(id) — get the UUID from
-- Supabase → Authentication → Users.
-- ============================================================


-- ------------------------------------------------------------
-- Drop the loose USING (true) policies introduced in 001
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "Admins full access to sessions"        ON sessions;
DROP POLICY IF EXISTS "Admins full access to messages"        ON messages;
DROP POLICY IF EXISTS "Admins full access to assets"          ON assets;
DROP POLICY IF EXISTS "Admins full access to reminders"       ON reminders;
DROP POLICY IF EXISTS "Admins full access to basecamp tokens" ON basecamp_tokens;
DROP POLICY IF EXISTS "Admins full access to content_jobs"      ON content_jobs;
DROP POLICY IF EXISTS "Admins full access to research_results"  ON research_results;
DROP POLICY IF EXISTS "Admins full access to page_outlines"     ON page_outlines;
DROP POLICY IF EXISTS "Admins full access to generated_pages"   ON generated_pages;


-- ------------------------------------------------------------
-- New strict policies — caller must be enrolled in `admins`
-- ------------------------------------------------------------
-- Note: API routes use the service-role client, which bypasses RLS
-- entirely. These policies are the safety net for any code path that
-- accidentally uses the anon/auth client.

CREATE POLICY "Admins manage sessions"
  ON sessions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid()));

CREATE POLICY "Admins manage messages"
  ON messages FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid()));

CREATE POLICY "Admins manage assets"
  ON assets FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid()));

CREATE POLICY "Admins manage reminders"
  ON reminders FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid()));

CREATE POLICY "Admins manage basecamp_tokens"
  ON basecamp_tokens FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid()));

CREATE POLICY "Admins manage content_jobs"
  ON content_jobs FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid()));

CREATE POLICY "Admins manage research_results"
  ON research_results FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid()));

CREATE POLICY "Admins manage page_outlines"
  ON page_outlines FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid()));

CREATE POLICY "Admins manage generated_pages"
  ON generated_pages FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid()));
