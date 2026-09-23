-- ============================================================
-- Revaltus Onboarding — security + integrity hardening (migration 076)
-- Run in Supabase → SQL Editor. DRY-RUN SECTION 4 (de-dup) FIRST — see below.
-- ============================================================
-- 1. RLS deny-by-default. Every app data path uses the service-role client
--    (lib/supabase/server.ts → createServerClient), which bypasses RLS. The
--    ONLY user-JWT (anon key + session cookie) reads in the codebase are
--    `admins` lookups by the caller's own id:
--      lib/auth/access.ts          getCurrentUser()   .from('admins').eq('id', user.id)
--      lib/auth/require-admin.ts   requireAdmin()     .from('admins').eq('id', user.id)
--      app/api/auth/me/route.ts                        .from('admins').eq('id', user.id)
--    The browser client (lib/supabase/client.ts) is used only for auth calls
--    (signInWithPassword / updateUser) — no table access. So every
--    authenticated/public policy is dropped and a single SELECT-own-row policy
--    on `admins` is recreated. RLS stays ENABLED on every table (no policy =
--    deny for anon/authenticated).
-- 2. FK ON DELETE SET NULL for sessions.approved_by + no_go_phrases.created_by
--    (removing a user must not be blocked by / erase approval + authorship).
-- 3. Partial indexes for the sweep cron's status filters + missing FK indexes.
-- 4. Unique (content_job_id, page_url) on research_results / page_outlines /
--    generated_pages, preceded by a DE-DUP DELETE (clearly marked block).
-- 5. token_usage_model_totals: pinned search_path, EXECUTE revoked from
--    anon/authenticated/public (called only via the service-role client).
-- 6. Declare the session-assets bucket private.
--
-- Idempotent: every statement uses IF EXISTS / IF NOT EXISTS or is a no-op on
-- re-run, except the de-dup DELETEs (which are harmless on re-run — nothing
-- left to delete).
--
-- ------------------------------------------------------------
-- VERIFICATION (run after applying):
--
--   SELECT schemaname, tablename, policyname, roles, cmd, qual
--     FROM pg_policies
--    WHERE schemaname = 'public'
--    ORDER BY tablename, policyname;
--   -- Expected: exactly ONE row — admins / "Read own admin row" / {authenticated} / SELECT.
--   -- Any extra row is a policy created outside the migration history
--   -- (e.g. via the dashboard) — review and drop it by hand.
--
--   SELECT relname, relrowsecurity
--     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
--   -- Expected: zero rows (RLS enabled on every public table).
--
--   SELECT id, public FROM storage.buckets WHERE id = 'session-assets';
--   -- Expected: public = false.
-- ------------------------------------------------------------
-- ============================================================


-- ============================================================
-- 1. RLS deny-by-default
-- ============================================================

-- admins (001) — was FOR ALL with no role (i.e. PUBLIC) — users could UPDATE
-- their own row (role/capabilities → self-escalation).
DROP POLICY IF EXISTS "Admins manage own record"               ON admins;

-- 001 originals (already dropped by 016; repeated for safety on drifted DBs)
DROP POLICY IF EXISTS "Admins full access to sessions"         ON sessions;
DROP POLICY IF EXISTS "Admins full access to messages"         ON messages;
DROP POLICY IF EXISTS "Admins full access to assets"           ON assets;
DROP POLICY IF EXISTS "Admins full access to reminders"        ON reminders;
-- (basecamp_tokens: table dropped in 029, which removed its policies)

-- 002 originals (already dropped by 016)
DROP POLICY IF EXISTS "Admins full access to content_jobs"     ON content_jobs;
DROP POLICY IF EXISTS "Admins full access to research_results" ON research_results;
DROP POLICY IF EXISTS "Admins full access to page_outlines"    ON page_outlines;
DROP POLICY IF EXISTS "Admins full access to generated_pages"  ON generated_pages;

-- 016 — any member (incl. editors/owners/auditors) had full table access
DROP POLICY IF EXISTS "Admins manage sessions"                 ON sessions;
DROP POLICY IF EXISTS "Admins manage messages"                 ON messages;
DROP POLICY IF EXISTS "Admins manage assets"                   ON assets;
DROP POLICY IF EXISTS "Admins manage reminders"                ON reminders;
DROP POLICY IF EXISTS "Admins manage content_jobs"             ON content_jobs;
DROP POLICY IF EXISTS "Admins manage research_results"         ON research_results;
DROP POLICY IF EXISTS "Admins manage page_outlines"            ON page_outlines;
DROP POLICY IF EXISTS "Admins manage generated_pages"          ON generated_pages;

-- 018
DROP POLICY IF EXISTS "Admins manage token_usage"              ON token_usage;
-- 019
DROP POLICY IF EXISTS "Admins manage resource_ideas"           ON resource_ideas;
-- 023
DROP POLICY IF EXISTS "Admins manage oneoff_generations"       ON oneoff_generations;
-- 030
DROP POLICY IF EXISTS "Managers read own assignments"          ON manager_clients;
DROP POLICY IF EXISTS "Admins manage assignments"              ON manager_clients;
-- 031
DROP POLICY IF EXISTS "Admins manage mbp_suggestions"          ON mbp_suggestions;
DROP POLICY IF EXISTS "Managers read assigned mbp_suggestions" ON mbp_suggestions;
DROP POLICY IF EXISTS "Admins manage mbp_messages"             ON mbp_messages;
-- 034 (replaced in 040) + 040
DROP POLICY IF EXISTS "Admins manage audit_runs"               ON audit_runs;
DROP POLICY IF EXISTS "Admins manage all audit_runs"           ON audit_runs;
DROP POLICY IF EXISTS "Auditors access own audit_runs"         ON audit_runs;
-- 038 (replaced in 040) + 040
DROP POLICY IF EXISTS "Admins manage audit_messages"           ON audit_messages;
DROP POLICY IF EXISTS "Admins manage all audit_messages"       ON audit_messages;
DROP POLICY IF EXISTS "Auditors access own audit_messages"     ON audit_messages;
-- 041
DROP POLICY IF EXISTS "Admins manage blog_batches"             ON blog_batches;
DROP POLICY IF EXISTS "Admins manage blog_batch_targets"       ON blog_batch_targets;
-- 046
DROP POLICY IF EXISTS "Admins manage audit_batches"            ON audit_batches;
-- 048
DROP POLICY IF EXISTS "Admins manage new_page_generations"     ON new_page_generations;
-- 050
DROP POLICY IF EXISTS "Admins manage pricing_calculators"      ON pricing_calculators;
-- 051
DROP POLICY IF EXISTS "Admins manage site_settings"            ON site_settings;
-- 061
DROP POLICY IF EXISTS "Admins manage content_job_library_selections" ON content_job_library_selections;
-- 063
DROP POLICY IF EXISTS "Admins manage pricing_plans"            ON pricing_plans;
-- 066 (no TO clause → PUBLIC)
DROP POLICY IF EXISTS "content_edit_stats admin read"          ON content_edit_stats;
-- 068
DROP POLICY IF EXISTS "Admins manage content_job_article_imports" ON content_job_article_imports;

-- Tables that already had RLS enabled with NO policies (unchanged, listed for
-- completeness): rate_limit_events (044), task_progress (057),
-- wordpress_sites (067), no_go_phrases (069), ai_service_status (072).

-- The one user-JWT read path: a signed-in user may read ONLY their own row.
DROP POLICY IF EXISTS "Read own admin row" ON admins;
CREATE POLICY "Read own admin row"
  ON admins FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- Belt-and-suspenders: RLS stays on for every table (no-op where already on).
ALTER TABLE admins                         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets                         ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_jobs                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_results               ENABLE ROW LEVEL SECURITY;
ALTER TABLE page_outlines                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_pages                ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_usage                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_ideas                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE oneoff_generations             ENABLE ROW LEVEL SECURITY;
ALTER TABLE manager_clients                ENABLE ROW LEVEL SECURITY;
ALTER TABLE mbp_suggestions                ENABLE ROW LEVEL SECURITY;
ALTER TABLE mbp_messages                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_runs                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_messages                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_batches                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_batch_targets             ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_events              ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_batches                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE new_page_generations           ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_calculators            ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_settings                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_progress                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_job_library_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_plans                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_edit_stats             ENABLE ROW LEVEL SECURITY;
ALTER TABLE wordpress_sites                ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_job_article_imports    ENABLE ROW LEVEL SECURITY;
ALTER TABLE no_go_phrases                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_service_status              ENABLE ROW LEVEL SECURITY;

-- New accounts default to the non-privileged tier (030 defaulted to 'admin').
-- The app (app/api/admin/users) and scripts/seed-admin.mjs always pass role
-- explicitly, so this only affects hand-written inserts.
ALTER TABLE admins ALTER COLUMN role SET DEFAULT 'member';


-- ============================================================
-- 2. FK ON DELETE SET NULL (default constraint names from 001 / 069)
-- ============================================================

ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_approved_by_fkey;
ALTER TABLE sessions
  ADD CONSTRAINT sessions_approved_by_fkey
  FOREIGN KEY (approved_by) REFERENCES admins(id) ON DELETE SET NULL;

ALTER TABLE no_go_phrases DROP CONSTRAINT IF EXISTS no_go_phrases_created_by_fkey;
ALTER TABLE no_go_phrases
  ADD CONSTRAINT no_go_phrases_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES admins(id) ON DELETE SET NULL;


-- ============================================================
-- 3. Indexes — sweep-cron status filters (partial) + FK columns
-- ============================================================

-- Sweep / resume filters (app/api/cron/sweep-stuck-jobs). Partial on the
-- non-terminal states so the indexes stay tiny.
CREATE INDEX IF NOT EXISTS idx_generated_pages_active_status
  ON generated_pages(generation_status, content_job_id)
  WHERE generation_status IN ('pending', 'running', 'error');
CREATE INDEX IF NOT EXISTS idx_resource_ideas_draft_running
  ON resource_ideas(updated_at)
  WHERE draft_status = 'running';
CREATE INDEX IF NOT EXISTS idx_resource_ideas_social_running
  ON resource_ideas(updated_at)
  WHERE social_status = 'running';
CREATE INDEX IF NOT EXISTS idx_cj_library_selections_active_status
  ON content_job_library_selections(status, updated_at)
  WHERE status IN ('pending', 'drafting', 'error');
CREATE INDEX IF NOT EXISTS idx_cj_article_imports_active_status
  ON content_job_article_imports(status, updated_at)
  WHERE status IN ('pending', 'drafting', 'error');
CREATE INDEX IF NOT EXISTS idx_blog_batch_targets_active_status
  ON blog_batch_targets(status, updated_at)
  WHERE status IN ('pending', 'generating');
CREATE INDEX IF NOT EXISTS idx_oneoff_active_status
  ON oneoff_generations(status, updated_at)
  WHERE status IN ('running');
CREATE INDEX IF NOT EXISTS idx_new_page_active_status
  ON new_page_generations(status, updated_at)
  WHERE status IN ('pending', 'running');
CREATE INDEX IF NOT EXISTS idx_audit_runs_active_status
  ON audit_runs(audit_status, created_at)
  WHERE audit_status NOT IN ('complete', 'error');

-- FK indexes (unindexed FK columns → seq scans on parent delete / joins)
CREATE INDEX IF NOT EXISTS idx_blog_batch_targets_content_job_id
  ON blog_batch_targets(content_job_id);
CREATE INDEX IF NOT EXISTS idx_blog_batch_targets_resource_idea_id
  ON blog_batch_targets(resource_idea_id);
CREATE INDEX IF NOT EXISTS idx_cj_library_selections_batch_id
  ON content_job_library_selections(batch_id);
CREATE INDEX IF NOT EXISTS idx_cj_library_selections_resource_idea_id
  ON content_job_library_selections(resource_idea_id);
CREATE INDEX IF NOT EXISTS idx_cj_article_imports_audit_run_id
  ON content_job_article_imports(audit_run_id);
CREATE INDEX IF NOT EXISTS idx_task_progress_content_job_id
  ON task_progress(content_job_id);
CREATE INDEX IF NOT EXISTS idx_sessions_approved_by
  ON sessions(approved_by);
CREATE INDEX IF NOT EXISTS idx_sessions_created_by
  ON sessions(created_by);
CREATE INDEX IF NOT EXISTS idx_mbp_suggestions_resolved_by
  ON mbp_suggestions(resolved_by);


-- ============================================================
-- 4. Unique (content_job_id, page_url) on the per-page pipeline tables
-- ============================================================
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- DE-DUP BLOCK — DESTRUCTIVE. DRY-RUN FIRST.
--
-- Deletes duplicate rows per (content_job_id, page_url), keeping ONE row per
-- key: the most complete, then the newest. To dry-run, replace each
-- `DELETE FROM <t> WHERE id IN (...)` with `SELECT * FROM <t> WHERE id IN (...)`
-- (or run just the inner `SELECT id FROM ranked WHERE rn > 1`) and review.
-- Recommended: run the whole migration inside BEGIN; ... ROLLBACK; once to
-- see the row counts, then for real.
--
-- Nothing references these tables' ids by FK, so no cascades fire.
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- research_results: prefer research_status='complete', then newest.
DELETE FROM research_results
 WHERE id IN (
   SELECT id FROM (
     SELECT id,
            row_number() OVER (
              PARTITION BY content_job_id, page_url
              ORDER BY (research_status = 'complete') DESC NULLS LAST,
                       updated_at DESC NULLS LAST,
                       created_at DESC,
                       id DESC
            ) AS rn
       FROM research_results
   ) ranked
   WHERE rn > 1
 );

-- page_outlines: prefer admin-approved, then generated (h1 set), then newest.
DELETE FROM page_outlines
 WHERE id IN (
   SELECT id FROM (
     SELECT id,
            row_number() OVER (
              PARTITION BY content_job_id, page_url
              ORDER BY admin_approved DESC NULLS LAST,
                       (h1 IS NOT NULL) DESC NULLS LAST,
                       updated_at DESC NULLS LAST,
                       created_at DESC,
                       id DESC
            ) AS rn
       FROM page_outlines
   ) ranked
   WHERE rn > 1
 );

-- generated_pages: prefer generation_status='complete', then approved content,
-- then has a body, then newest (no updated_at column — use started/created).
DELETE FROM generated_pages
 WHERE id IN (
   SELECT id FROM (
     SELECT id,
            row_number() OVER (
              PARTITION BY content_job_id, page_url
              ORDER BY (generation_status = 'complete') DESC NULLS LAST,
                       admin_approved_content DESC NULLS LAST,
                       (content_markdown IS NOT NULL) DESC NULLS LAST,
                       generation_started_at DESC NULLS LAST,
                       created_at DESC,
                       id DESC
            ) AS rn
       FROM generated_pages
   ) ranked
   WHERE rn > 1
 );
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
-- END DE-DUP BLOCK
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- The unique indexes supersede the non-unique idx_*_job_url indexes from 005
-- for lookups; those are dropped to avoid double write cost.
CREATE UNIQUE INDEX IF NOT EXISTS uq_research_results_job_url
  ON research_results(content_job_id, page_url);
CREATE UNIQUE INDEX IF NOT EXISTS uq_page_outlines_job_url
  ON page_outlines(content_job_id, page_url);
CREATE UNIQUE INDEX IF NOT EXISTS uq_generated_pages_job_url
  ON generated_pages(content_job_id, page_url);

DROP INDEX IF EXISTS idx_research_results_job_url;
DROP INDEX IF EXISTS idx_page_outlines_job_url;
DROP INDEX IF EXISTS idx_generated_pages_job_url;


-- ============================================================
-- 5. token_usage_model_totals (044) — pin search_path, service-role only
-- ============================================================

ALTER FUNCTION public.token_usage_model_totals(timestamptz) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.token_usage_model_totals(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.token_usage_model_totals(timestamptz) TO service_role;


-- ============================================================
-- 6. session-assets bucket is private (no storage.objects policy for
--    authenticated/anon — all access is service-role + signed URLs)
-- ============================================================

UPDATE storage.buckets SET public = false WHERE id = 'session-assets';
