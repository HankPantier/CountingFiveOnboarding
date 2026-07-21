-- ============================================================
-- CountingFive Onboarding — new-page AI generations
-- Run this entire file in Supabase → SQL Editor
-- ============================================================
-- Tracks the async "AI first draft" for a brand-new page created in the
-- content editor of a published client (phase >= 6, github_repo set). The
-- create-page route writes a minimal starter file synchronously (reserving
-- the slug + nav link), then — for AI mode — inserts a row here and kicks a
-- background job (lib/content/new-page-generator.ts). The row surfaces
-- status/errors so the editor can poll and reload the page when the draft
-- lands. starter_sha is the blob sha of the placeholder page, used for an
-- optimistic overwrite so an admin who hand-edits the starter during the
-- ~90s generation window is never clobbered.
-- ============================================================

CREATE TABLE new_page_generations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  content_job_id  uuid        NOT NULL REFERENCES content_jobs(id) ON DELETE CASCADE,
  session_id      uuid        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  -- content/pages/{slug}.md on the draft branch
  target_path     text        NOT NULL,
  -- root-relative page url (/services/tax)
  page_url        text        NOT NULL,
  title           text        NOT NULL,
  brief           text        DEFAULT NULL,
  -- blob sha of the starter file, for optimistic overwrite by the generator
  starter_sha     text        DEFAULT NULL,
  status          text        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'running', 'complete', 'error')),
  error           text        DEFAULT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_new_page_job_id     ON new_page_generations(content_job_id);
CREATE INDEX idx_new_page_session_id ON new_page_generations(session_id);

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY — mirror migration 016 (admins-table membership).
-- App-level scoping (requireSessionAccess) is the real gate; routes use the
-- service-role client which bypasses RLS. This policy blocks any stray
-- anon/authenticated access, matching oneoff_generations (migration 023).
-- ------------------------------------------------------------

ALTER TABLE new_page_generations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage new_page_generations"
  ON new_page_generations FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid()));

-- token_usage.stage is app-validated since migration 039 (no DB CHECK); the
-- 'new_page' stage is admitted via the TokenStage union in
-- lib/content/token-usage.ts — no constraint change needed here.
