-- ============================================================
-- Revaltus Onboarding — Site Audit feature
-- Run this entire file in Supabase → SQL Editor
-- ============================================================
-- Adds `audit_runs`: one row per on-demand site audit. Mirrors the
-- content_jobs status/guard conventions. A "site" is grouped by its
-- normalized `domain` so multiple runs can be diffed for score deltas.
--
-- The full structured result is stored in `result` (JSONB), typed in app
-- code as `AuditResult` from types/audit-result.ts. The report is always
-- re-rendered from this JSON — never stored as pre-baked HTML.
-- ============================================================


-- ------------------------------------------------------------
-- TABLE
-- ------------------------------------------------------------

CREATE TABLE audit_runs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who triggered it. Kept even if the admin is later removed.
  created_by      uuid        REFERENCES admins(id) ON DELETE SET NULL,

  -- Optional link to an onboarding session (e.g. auditing a prospect's
  -- current site during onboarding). Null for standalone audits.
  session_id      uuid        REFERENCES sessions(id) ON DELETE SET NULL,

  url             text        NOT NULL,
  -- Normalized host (lowercased, no www., no trailing slash). Group key
  -- for delta tracking across runs.
  domain          text        NOT NULL,
  site_name       text        DEFAULT NULL,
  max_pages       integer     NOT NULL DEFAULT 50,
  -- Optional customer segments to check content against.
  focus_segments  text[]      DEFAULT NULL,

  audit_status    text        NOT NULL DEFAULT 'queued'
                    CHECK (audit_status IN (
                      'queued', 'crawling', 'analyzing', 'scoring',
                      'rendering', 'complete', 'error'
                    )),
  -- Human-readable progress line for the UI.
  status_detail   text        DEFAULT NULL,

  started_at      timestamptz DEFAULT NULL,
  completed_at    timestamptz DEFAULT NULL,

  overall_score   integer     DEFAULT NULL,   -- 0–100, null until complete
  overall_grade   text        DEFAULT NULL,   -- A–F
  category_scores jsonb       DEFAULT NULL,   -- { performance:{score,grade}, ... }
  result          jsonb       DEFAULT NULL,   -- full AuditResult; report renders from this

  error_message   text        DEFAULT NULL,   -- set when audit_status='error'
  pages_crawled   integer     DEFAULT NULL,

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_runs_domain_idx     ON audit_runs(domain);
CREATE INDEX audit_runs_created_at_idx ON audit_runs(created_at DESC);


-- ------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ------------------------------------------------------------
-- API routes use the service-role client, which bypasses RLS; manager
-- scoping for audits is admin-only in v1 and enforced in app code via
-- requireAdminUser(). This policy is the safety net for any code path
-- that accidentally uses the anon/auth client. Mirrors migration 016.

ALTER TABLE audit_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage audit_runs"
  ON audit_runs FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid()));
