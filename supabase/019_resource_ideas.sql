-- ============================================================
-- CountingFive Onboarding — Resources blog idea pipeline
-- Run this entire file in Supabase → SQL Editor
-- ============================================================
-- Tracks brainstormed blog post ideas per content job. Ideas move
-- suggested → approved → drafted (or dismissed). The drafted post itself
-- is repo-first: it lives at content/posts/{slug}.md on the linked repo's
-- draft branch, not in this table — `slug`/`draft_path`/`draft_commit_sha`
-- only record where it landed.
--
-- `status` is the admin-facing lifecycle; `draft_status` is the atomic
-- generation guard (same two-axis split as generated_pages.generation_status).
-- ============================================================

CREATE TABLE resource_ideas (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  content_job_id     uuid        NOT NULL REFERENCES content_jobs(id) ON DELETE CASCADE,
  session_id         uuid        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  title              text        NOT NULL,
  angle              text        DEFAULT NULL,
  target_keyword     text        DEFAULT NULL,
  secondary_keywords jsonb       NOT NULL DEFAULT '[]',
  rationale          text        DEFAULT NULL,
  score              integer     DEFAULT NULL,
  -- { stickiness, sharability, localRelevance, aioAnswerability } — 0-25 each
  score_breakdown    jsonb       NOT NULL DEFAULT '{}',
  -- [{ url, title }] — HEAD-checked before insert; drafting cites ONLY these
  external_links     jsonb       NOT NULL DEFAULT '[]',
  status             text        NOT NULL DEFAULT 'suggested'
                       CHECK (status IN ('suggested', 'approved', 'drafted', 'dismissed')),
  draft_status       text        NOT NULL DEFAULT 'idle'
                       CHECK (draft_status IN ('idle', 'running', 'complete', 'error')),
  slug               text        DEFAULT NULL,
  draft_path         text        DEFAULT NULL,
  draft_commit_sha   text        DEFAULT NULL,
  draft_error        text        DEFAULT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_resource_ideas_job_id     ON resource_ideas(content_job_id);
CREATE INDEX idx_resource_ideas_session_id ON resource_ideas(session_id);
CREATE INDEX idx_resource_ideas_job_status ON resource_ideas(content_job_id, status);

-- One slug per job: a second idea can never claim an already-drafted path.
CREATE UNIQUE INDEX idx_resource_ideas_job_slug
  ON resource_ideas(content_job_id, slug)
  WHERE slug IS NOT NULL;

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY — mirror migration 016 (admins-table membership)
-- ------------------------------------------------------------
-- Pipeline code writes via the service-role client, which bypasses RLS.

ALTER TABLE resource_ideas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage resource_ideas"
  ON resource_ideas FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid()));

-- ------------------------------------------------------------
-- token_usage.stage — admit the new pipeline stages
-- ------------------------------------------------------------
-- recordTokenUsage swallows insert errors by design; without this widening
-- the 'idea'/'resource' stages would silently fail to log.

ALTER TABLE token_usage DROP CONSTRAINT token_usage_stage_check;
ALTER TABLE token_usage ADD CONSTRAINT token_usage_stage_check
  CHECK (stage IN ('keyword', 'outline', 'content', 'idea', 'resource'));
