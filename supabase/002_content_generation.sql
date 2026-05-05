-- ============================================================
-- CountingFive Onboarding — Content Generation Schema
-- Run this entire file in Supabase → SQL Editor
-- ============================================================


-- ------------------------------------------------------------
-- NEW COLUMNS ON sessions
-- ------------------------------------------------------------

ALTER TABLE sessions
  ADD COLUMN content_generation_phase integer DEFAULT NULL,
  ADD COLUMN content_generation_started_at timestamptz DEFAULT NULL;


-- ------------------------------------------------------------
-- NEW TABLES
-- ------------------------------------------------------------

CREATE TABLE content_jobs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  phase             integer     NOT NULL DEFAULT 1,
  palette           jsonb       DEFAULT NULL,
  confirmed_sitemap jsonb       DEFAULT NULL,
  status            text        NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'complete', 'error')),
  error_message     text        DEFAULT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX content_jobs_session_id_idx ON content_jobs(session_id);

CREATE TABLE research_results (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  content_job_id      uuid        NOT NULL REFERENCES content_jobs(id) ON DELETE CASCADE,
  page_url            text        NOT NULL,
  page_title          text        NOT NULL,
  target_keyword      text        DEFAULT NULL,
  secondary_keywords  jsonb       DEFAULT '[]',
  competitor_references jsonb     DEFAULT '[]',
  existing_content    text        DEFAULT NULL,
  research_status     text        NOT NULL DEFAULT 'pending'
                        CHECK (research_status IN ('pending', 'running', 'complete', 'error')),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE page_outlines (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  content_job_id    uuid        NOT NULL REFERENCES content_jobs(id) ON DELETE CASCADE,
  page_url          text        NOT NULL,
  page_title        text        NOT NULL,
  h1                text        DEFAULT NULL,
  sections          jsonb       DEFAULT '[]',
  target_keyword    text        DEFAULT NULL,
  admin_approved    boolean     NOT NULL DEFAULT false,
  admin_notes       text        DEFAULT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE generated_pages (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  content_job_id      uuid        NOT NULL REFERENCES content_jobs(id) ON DELETE CASCADE,
  page_url            text        NOT NULL,
  page_title          text        NOT NULL,
  content_markdown    text        DEFAULT NULL,
  meta_title          text        DEFAULT NULL,
  meta_description    text        DEFAULT NULL,
  target_keyword      text        DEFAULT NULL,
  secondary_keywords  jsonb       DEFAULT '[]',
  answer_block        text        DEFAULT NULL,
  schema_markup_type  text        DEFAULT NULL,
  eeat_signals        jsonb       DEFAULT '[]',
  internal_links      jsonb       DEFAULT '[]',
  faq_block           jsonb       DEFAULT '[]',
  llm_citation_note   text        DEFAULT NULL,
  url_slug            text        DEFAULT NULL,
  canonical_url       text        DEFAULT NULL,
  generation_status   text        NOT NULL DEFAULT 'pending'
                        CHECK (generation_status IN ('pending', 'running', 'complete', 'error')),
  created_at          timestamptz NOT NULL DEFAULT now()
);


-- ------------------------------------------------------------
-- INDEXES
-- ------------------------------------------------------------

CREATE INDEX idx_research_results_job_id   ON research_results(content_job_id);
CREATE INDEX idx_page_outlines_job_id      ON page_outlines(content_job_id);
CREATE INDEX idx_generated_pages_job_id    ON generated_pages(content_job_id);


-- ------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ------------------------------------------------------------

ALTER TABLE content_jobs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE page_outlines    ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_pages  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access to content_jobs"
  ON content_jobs FOR ALL TO authenticated USING (true);

CREATE POLICY "Admins full access to research_results"
  ON research_results FOR ALL TO authenticated USING (true);

CREATE POLICY "Admins full access to page_outlines"
  ON page_outlines FOR ALL TO authenticated USING (true);

CREATE POLICY "Admins full access to generated_pages"
  ON generated_pages FOR ALL TO authenticated USING (true);
