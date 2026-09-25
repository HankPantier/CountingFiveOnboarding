-- ============================================================
-- 078: Design Studio — inputs, runs, concepts, versions, chat
-- Run this entire file in Supabase → SQL Editor.
-- IDEMPOTENT: every CREATE uses IF NOT EXISTS and every policy is dropped and
-- recreated, so re-running the file is safe. It never alters or drops an
-- existing table or its data.
-- ============================================================
-- Admin-only feature (docs/superpowers/specs/2026-09-24-design-studio-design.md).
-- App routes gate with requireDesignAdmin() and use the service-role client
-- (bypasses RLS). The admin-TIER policies below (admins.role = 'admin') block
-- every stray anon/authenticated path, including member/manager/editor/owner
-- accounts that pass the older admins-membership policies.
--
-- design_inputs is deliberately separate from `assets`: nothing here may leak
-- into deliverables. Images live in the PRIVATE session-assets bucket under
-- design/{session_id}/…; only the storage path is stored (signed URLs only).
--
-- updated_at is stamped by the app on every write (no trigger — matches the
-- rest of the schema); the sweep cron keys on it. design_versions and
-- design_chat_messages are append-only, so they carry created_at only.
--
-- design_runs / design_concepts / design_chat_messages are created now (unused
-- until P3–P5) so later phases need no migration.
-- ============================================================

CREATE TABLE IF NOT EXISTS design_inputs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind            text        NOT NULL
                    CHECK (kind IN ('inspiration_url', 'inspiration_image', 'competitor_url', 'current_site')),
  url             text        DEFAULT NULL CHECK (url IS NULL OR char_length(url) <= 300),
  label           text        DEFAULT NULL CHECK (label IS NULL OR char_length(label) <= 120),
  notes           text        DEFAULT NULL CHECK (notes IS NULL OR char_length(notes) <= 2000),
  storage_path    text        DEFAULT NULL CHECK (storage_path IS NULL OR storage_path LIKE 'design/%'),
  capture_status  text        NOT NULL DEFAULT 'none'
                    CHECK (capture_status IN ('none', 'pending', 'ok', 'error')),
  capture_error   text        DEFAULT NULL CHECK (capture_error IS NULL OR char_length(capture_error) <= 500),
  captured_at     timestamptz DEFAULT NULL,
  archived        boolean     NOT NULL DEFAULT false,
  created_by      uuid        DEFAULT NULL REFERENCES admins(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- URL kinds need a url; uploaded images never have one.
  CONSTRAINT design_inputs_url_matches_kind CHECK ((kind = 'inspiration_image') = (url IS NULL))
);

CREATE TABLE IF NOT EXISTS design_runs (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       uuid          NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  status           text          NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued', 'capturing', 'generating', 'refining', 'ready', 'applied', 'cancelled', 'error')),
  stage            text          DEFAULT NULL,
  admin_brief      text          DEFAULT NULL CHECK (admin_brief IS NULL OR char_length(admin_brief) <= 4000),
  palette_freedom  text          NOT NULL DEFAULT 'evolve'
                     CHECK (palette_freedom IN ('keep', 'evolve', 'free')),
  concept_count    integer       NOT NULL DEFAULT 3 CHECK (concept_count BETWEEN 1 AND 3),
  -- The design_inputs the admin picked for this run (RunLauncher, P3).
  input_ids        uuid[]        NOT NULL DEFAULT '{}',
  capabilities     jsonb         NOT NULL DEFAULT '{}'::jsonb,
  base_snapshot    jsonb         DEFAULT NULL,
  cost_usd         numeric(10,4) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  cost_cap_usd     numeric(10,4) NOT NULL DEFAULT 4 CHECK (cost_cap_usd > 0),
  max_revisions    integer       NOT NULL DEFAULT 2 CHECK (max_revisions BETWEEN 0 AND 5),
  error            text          DEFAULT NULL,
  created_by       uuid          DEFAULT NULL REFERENCES admins(id) ON DELETE SET NULL,
  created_at       timestamptz   NOT NULL DEFAULT now(),
  updated_at       timestamptz   NOT NULL DEFAULT now()
);

-- One active run per session. Terminal statuses (ready/applied/cancelled/error)
-- release the slot; the sweep cron errors a stalled active run after 15 min.
CREATE UNIQUE INDEX IF NOT EXISTS design_runs_one_active_per_session
  ON design_runs (session_id)
  WHERE status IN ('queued', 'capturing', 'generating', 'refining');

CREATE TABLE IF NOT EXISTS design_concepts (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid          NOT NULL REFERENCES design_runs(id) ON DELETE CASCADE,
  session_id      uuid          NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  position        integer       NOT NULL CHECK (position BETWEEN 0 AND 2),
  status          text          NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'generating', 'refining', 'ready', 'rejected', 'error')),
  bundle          jsonb         DEFAULT NULL,
  initial_bundle  jsonb         DEFAULT NULL,
  critique        jsonb         DEFAULT NULL,
  iterations      integer       NOT NULL DEFAULT 0 CHECK (iterations >= 0),
  screenshots     jsonb         NOT NULL DEFAULT '[]'::jsonb,
  cost_usd        numeric(10,4) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  error           text          DEFAULT NULL,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT design_concepts_run_position_key UNIQUE (run_id, position)
);

CREATE TABLE IF NOT EXISTS design_versions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          uuid        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  version_no          integer     NOT NULL CHECK (version_no >= 0),
  source              text        NOT NULL
                        CHECK (source IN ('baseline', 'concept', 'chat', 'revert', 'import')),
  bundle              jsonb       NOT NULL,
  summary             text        DEFAULT NULL CHECK (summary IS NULL OR char_length(summary) <= 500),
  concept_id          uuid        DEFAULT NULL REFERENCES design_concepts(id) ON DELETE SET NULL,
  applied_commit_sha  text        DEFAULT NULL,
  -- FULL post-apply blob shas of the four theme files (drift compares to this).
  applied_blobs       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  screenshots         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_by          uuid        DEFAULT NULL REFERENCES admins(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT design_versions_session_version_key UNIQUE (session_id, version_no)
);

CREATE TABLE IF NOT EXISTS design_chat_messages (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role            text        NOT NULL CHECK (role IN ('user', 'assistant')),
  content         text        NOT NULL DEFAULT '',
  parts           jsonb       DEFAULT NULL,
  -- Attachments are referenced by id only (spec); images live in storage.
  attachment_ids  uuid[]      NOT NULL DEFAULT '{}',
  version_id      uuid        DEFAULT NULL REFERENCES design_versions(id) ON DELETE SET NULL,
  created_by      uuid        DEFAULT NULL REFERENCES admins(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_design_inputs_session   ON design_inputs (session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_design_inputs_pending   ON design_inputs (updated_at) WHERE capture_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_design_runs_session     ON design_runs (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_design_concepts_run     ON design_concepts (run_id);
CREATE INDEX IF NOT EXISTS idx_design_concepts_session ON design_concepts (session_id);
CREATE INDEX IF NOT EXISTS idx_design_chat_session     ON design_chat_messages (session_id, created_at);

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY — admin tier only. Mirrors migration 048's shape, but
-- narrowed to admins.role = 'admin' (members never reach the Design Studio).
-- ------------------------------------------------------------

ALTER TABLE design_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_concepts ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin tier manages design_inputs" ON design_inputs;
CREATE POLICY "Admin tier manages design_inputs"
  ON design_inputs FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid() AND admins.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid() AND admins.role = 'admin'));

DROP POLICY IF EXISTS "Admin tier manages design_runs" ON design_runs;
CREATE POLICY "Admin tier manages design_runs"
  ON design_runs FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid() AND admins.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid() AND admins.role = 'admin'));

DROP POLICY IF EXISTS "Admin tier manages design_concepts" ON design_concepts;
CREATE POLICY "Admin tier manages design_concepts"
  ON design_concepts FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid() AND admins.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid() AND admins.role = 'admin'));

DROP POLICY IF EXISTS "Admin tier manages design_versions" ON design_versions;
CREATE POLICY "Admin tier manages design_versions"
  ON design_versions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid() AND admins.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid() AND admins.role = 'admin'));

DROP POLICY IF EXISTS "Admin tier manages design_chat_messages" ON design_chat_messages;
CREATE POLICY "Admin tier manages design_chat_messages"
  ON design_chat_messages FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid() AND admins.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid() AND admins.role = 'admin'));

-- ------------------------------------------------------------
-- Verify (read-only; run after applying):
--   SELECT table_name FROM information_schema.tables
--    WHERE table_schema = 'public' AND table_name LIKE 'design\_%' ORDER BY 1;          -- 5 rows
--   SELECT tablename, rowsecurity FROM pg_tables WHERE tablename LIKE 'design\_%';      -- all true
--   SELECT tablename, policyname FROM pg_policies WHERE tablename LIKE 'design\_%';     -- 5 rows
--   SELECT indexname FROM pg_indexes WHERE indexname = 'design_runs_one_active_per_session'; -- 1 row
-- ------------------------------------------------------------
