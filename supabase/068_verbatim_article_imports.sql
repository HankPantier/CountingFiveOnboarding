-- ============================================================
-- Revaltus Onboarding — Verbatim article imports (onboarding)
-- Run this entire file in Supabase → SQL Editor (or via the
-- Management API query endpoint).
-- ============================================================
-- Records which of the CLIENT'S OWN existing blog/resource articles (discovered
-- during the audit crawl) an operator chose to bring into the new site AS-IS —
-- body kept verbatim (no LLM rewrite), wrapped with generated frontmatter,
-- re-hosted images, and carefully injected internal links.
--
-- Mirrors content_job_library_selections (061): the selection is captured while
-- proofing the outline (phase 4), but the site repo isn't provisioned until phase
-- 6 / Deliverables, so we persist the *intent* here and defer the actual import
-- to Deliverables. Site completion + publish are gated on these reaching a
-- terminal status.
--
-- status lifecycle: pending → drafting → complete | error.
-- The source article body is NOT stored here — it is re-read from the audit run's
-- result (audit_runs.result.raw.pages[]) at import time, keyed by source_url.
-- ============================================================

CREATE TABLE content_job_article_imports (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  content_job_id    uuid        NOT NULL REFERENCES content_jobs(id) ON DELETE CASCADE,
  session_id        uuid        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  -- The audit run whose crawl discovered this article (source of the verbatim HTML).
  audit_run_id      uuid        NOT NULL REFERENCES audit_runs(id) ON DELETE CASCADE,
  -- The article's URL on the client's CURRENT site (the crawl key).
  source_url        text        NOT NULL,
  -- The article's title at selection time (display + frontmatter seed).
  source_title      text        DEFAULT NULL,
  -- Assigned at import time: the new post's slug + where it landed on the draft branch.
  slug              text        DEFAULT NULL,
  draft_path        text        DEFAULT NULL,
  draft_commit_sha  text        DEFAULT NULL,
  status            text        NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'drafting', 'complete', 'error')),
  error             text        DEFAULT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cj_article_imports_job     ON content_job_article_imports(content_job_id);
CREATE INDEX idx_cj_article_imports_session ON content_job_article_imports(session_id);

-- One import per (content_job, source_url) — re-picking the same article is a
-- no-op upsert, not a duplicate.
CREATE UNIQUE INDEX idx_cj_article_imports_job_url
  ON content_job_article_imports(content_job_id, source_url);

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY — mirror migration 061 (admins-table membership)
-- ------------------------------------------------------------
-- Pipeline + API code writes via the service-role client, which bypasses RLS;
-- per-client scoping is enforced in app code (requireContentJobAccess). This
-- policy is the safety net for any auth/anon-client path.

ALTER TABLE content_job_article_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage content_job_article_imports"
  ON content_job_article_imports FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid()));

-- ------------------------------------------------------------
-- Review gate — mirror migration 062 (library_reviewed_at)
-- ------------------------------------------------------------
-- Records that the operator made an explicit verbatim-import choice (select +
-- save, or save none) while proofing the outline at phase 4. The phase 4 → 5
-- advance is gated on this, so a direct PATCH can't skip the review step.

ALTER TABLE content_jobs
  ADD COLUMN IF NOT EXISTS articles_reviewed_at timestamptz DEFAULT NULL;

-- Backfill jobs already past the outline stage so an in-flight job isn't blocked.
UPDATE content_jobs
  SET articles_reviewed_at = updated_at
  WHERE phase >= 5 AND articles_reviewed_at IS NULL;
