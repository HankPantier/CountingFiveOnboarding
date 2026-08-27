-- ============================================================
-- CountingFive Onboarding — Library content selections (onboarding)
-- Run this entire file in Supabase → SQL Editor (or via the
-- Management API query endpoint).
-- ============================================================
-- Records which existing bulk/library blog ideas an operator chose to include
-- in a NEW site while proofing the content outline (content_jobs.phase = 4).
--
-- The selection is captured at phase 4, but the client's site has no repo yet
-- (repos are provisioned at phase 6 / Deliverables), and the blog-batch drafting
-- pipeline only drafts for clients with a provisioned repo at phase >= 6. So we
-- persist the *intent* here and defer the actual re-draft to Deliverables: once
-- the repo exists, each selection is fanned out (via the existing insertBatchTargets
-- + runBlogBatch path, which creates a per-client resource_ideas row and drafts a
-- UNIQUE article against this client's MBP). Site completion is gated on these
-- reaching a terminal status.
--
-- status lifecycle: pending → drafting → complete | error.
-- resource_idea_id is backfilled when the phase-6 fan-out creates the per-client idea.
-- ============================================================

CREATE TABLE content_job_library_selections (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  content_job_id   uuid        NOT NULL REFERENCES content_jobs(id) ON DELETE CASCADE,
  session_id       uuid        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  -- The library blog_batch the operator chose to include.
  batch_id         uuid        NOT NULL REFERENCES blog_batches(id) ON DELETE CASCADE,
  -- The per-client resource_ideas row created at phase-6 fan-out. SET NULL if the
  -- idea is later deleted; the selection row stays as a record.
  resource_idea_id uuid        REFERENCES resource_ideas(id) ON DELETE SET NULL,
  status           text        NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'drafting', 'complete', 'error')),
  error            text        DEFAULT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cj_library_selections_job     ON content_job_library_selections(content_job_id);
CREATE INDEX idx_cj_library_selections_session ON content_job_library_selections(session_id);

-- One selection per (content_job, batch) — re-picking the same library item is a
-- no-op upsert, not a duplicate.
CREATE UNIQUE INDEX idx_cj_library_selections_job_batch
  ON content_job_library_selections(content_job_id, batch_id);

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY — mirror migration 041 (admins-table membership)
-- ------------------------------------------------------------
-- Pipeline + API code writes via the service-role client, which bypasses RLS;
-- per-client scoping is enforced in app code (requireContentJobAccess). This
-- policy is the safety net for any auth/anon-client path.

ALTER TABLE content_job_library_selections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage content_job_library_selections"
  ON content_job_library_selections FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid()));
