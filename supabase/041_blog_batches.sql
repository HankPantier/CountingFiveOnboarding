-- ============================================================
-- CountingFive Onboarding — Blog-first multi-client batches
-- Run this entire file in Supabase → SQL Editor (or via the
-- Management API query endpoint).
-- ============================================================
-- Inverts the 1:1 content flow: one admin-authored, AI-refined blog
-- idea fanned out to many clients. Each selected client gets a UNIQUE
-- article written against its own MBP by reusing the existing per-idea
-- pipeline (lib/content/resource-draft-generator.generateResourceDraft).
--
-- The fan-out creates one resource_ideas row per client (the real,
-- per-client idea the existing pipeline drafts), so the generated post
-- still lands at content/posts/{slug}.md on that client's repo draft
-- branch and shows up in its editor Resources panel. These two tables
-- only track the batch → client → idea mapping and per-client run state.
--
-- `blog_batches.status` is the run rollup; `blog_batch_targets.status`
-- is the per-client lifecycle. The atomic generation guard lives on
-- resource_ideas.draft_status (set by generateResourceDraft), same
-- two-axis split as resource_ideas / generated_pages.
-- ============================================================

CREATE TABLE blog_batches (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The locked idea (admin-authored, AI-refined; brand-agnostic until fan-out).
  title              text        NOT NULL,
  angle              text        DEFAULT NULL,
  target_keyword     text        DEFAULT NULL,
  secondary_keywords jsonb       NOT NULL DEFAULT '[]',
  rationale          text        DEFAULT NULL,
  -- Original admin free-text seed, kept for provenance.
  seed               text        DEFAULT NULL,
  -- Author. SET NULL (not CASCADE) so removing a user never erases batch history.
  created_by         uuid        REFERENCES admins(id) ON DELETE SET NULL,
  status             text        NOT NULL DEFAULT 'generating'
                       CHECK (status IN ('generating', 'complete', 'error')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE blog_batch_targets (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id          uuid        NOT NULL REFERENCES blog_batches(id) ON DELETE CASCADE,
  session_id        uuid        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  content_job_id    uuid        NOT NULL REFERENCES content_jobs(id) ON DELETE CASCADE,
  -- The per-client resource_ideas row created for this client. SET NULL if the
  -- idea is later deleted; the target row stays as a record of the run.
  resource_idea_id  uuid        REFERENCES resource_ideas(id) ON DELETE SET NULL,
  status            text        NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'generating', 'complete', 'error', 'skipped')),
  error             text        DEFAULT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_blog_batch_targets_batch_id   ON blog_batch_targets(batch_id);
CREATE INDEX idx_blog_batch_targets_session_id ON blog_batch_targets(session_id);

-- One target per client per batch — re-submitting the same client is a no-op,
-- not a duplicate fan-out.
CREATE UNIQUE INDEX idx_blog_batch_targets_batch_session
  ON blog_batch_targets(batch_id, session_id);

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY — mirror migration 016 / 019 (admins-table membership)
-- ------------------------------------------------------------
-- Pipeline + API code writes via the service-role client, which bypasses RLS;
-- per-client scoping for managers is enforced in app code (getAccessibleSessionIds).
-- These policies are the safety net for any auth/anon-client path.

ALTER TABLE blog_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_batch_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage blog_batches"
  ON blog_batches FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid()));

CREATE POLICY "Admins manage blog_batch_targets"
  ON blog_batch_targets FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid()));
