-- ============================================================
-- CountingFive Onboarding — token / API-cost tracking
-- Run this entire file in Supabase → SQL Editor
-- ============================================================
-- Persists one row per Claude call made by the content-generation
-- pipeline (keyword research, outline generation, content generation).
-- Token usage was previously logged to the console only; this table
-- gives billing visibility per content job and per stage.
--
-- cost_usd is an estimate computed at insert time from the per-model
-- rates in lib/content/token-usage.ts. Treat it as indicative, not an
-- invoice — re-pricing historical rows requires the rate at the time.
-- ============================================================

CREATE TABLE token_usage (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  content_job_id  uuid        REFERENCES content_jobs(id) ON DELETE CASCADE,
  session_id      uuid        REFERENCES sessions(id) ON DELETE CASCADE,
  stage           text        NOT NULL
                    CHECK (stage IN ('keyword', 'outline', 'content')),
  page_url        text        DEFAULT NULL,
  model           text        NOT NULL,
  input_tokens    integer     NOT NULL DEFAULT 0,
  output_tokens   integer     NOT NULL DEFAULT 0,
  cost_usd        numeric(10,6) NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_token_usage_job_id     ON token_usage(content_job_id);
CREATE INDEX idx_token_usage_session_id ON token_usage(session_id);

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY — mirror migration 016 (admins-table membership)
-- ------------------------------------------------------------
-- Pipeline code writes via the service-role client, which bypasses RLS.
-- This policy is the safety net for any code path that accidentally
-- uses the anon/auth client.

ALTER TABLE token_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage token_usage"
  ON token_usage FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid()));
