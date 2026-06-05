-- ============================================================
-- CountingFive Onboarding — one-off content generations
-- Run this entire file in Supabase → SQL Editor
-- ============================================================
-- Free-form admin asks grounded in client knowledge ("LinkedIn bio for
-- <team member>", "new hero title for <page>"). Each run stores the prompt,
-- the references the resolver detected, and the generated options so the
-- history is browsable per client.
-- ============================================================

CREATE TABLE oneoff_generations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  content_job_id  uuid        NOT NULL REFERENCES content_jobs(id) ON DELETE CASCADE,
  session_id      uuid        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  prompt          text        NOT NULL,
  -- resolved references: { pageUrl?: string, teamMemberName?: string }
  context         jsonb       NOT NULL DEFAULT '{}',
  -- [{ label: string, text: string }]
  options         jsonb       NOT NULL DEFAULT '[]',
  status          text        NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'complete', 'error')),
  error           text        DEFAULT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_oneoff_job_id     ON oneoff_generations(content_job_id);
CREATE INDEX idx_oneoff_session_id ON oneoff_generations(session_id);

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY — mirror migration 016 (admins-table membership)
-- ------------------------------------------------------------

ALTER TABLE oneoff_generations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage oneoff_generations"
  ON oneoff_generations FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid()));

-- ------------------------------------------------------------
-- token_usage.stage — admit the one-off stage
-- ------------------------------------------------------------

ALTER TABLE token_usage DROP CONSTRAINT token_usage_stage_check;
ALTER TABLE token_usage ADD CONSTRAINT token_usage_stage_check
  CHECK (stage IN ('keyword', 'outline', 'content', 'idea', 'resource', 'social', 'oneoff'));
