-- ============================================================
-- CountingFive Onboarding — Initial Schema
-- Run this entire file in Supabase → SQL Editor
-- ============================================================


-- ------------------------------------------------------------
-- TABLES (run in this order — foreign key dependencies matter)
-- ------------------------------------------------------------

CREATE TABLE admins (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sessions (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  website_url              TEXT        NOT NULL,
  status                   TEXT        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'in_progress', 'completed', 'approved')),
  current_phase            INTEGER     NOT NULL DEFAULT 0 CHECK (current_phase BETWEEN 0 AND 7),
  schema_data              JSONB       NOT NULL DEFAULT '{}',
  gap_list                 JSONB       NOT NULL DEFAULT '[]',
  mfp_content              TEXT,
  client_email             TEXT,
  processing               BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at             TIMESTAMPTZ,
  approved_at              TIMESTAMPTZ,
  approved_by              UUID        REFERENCES admins(id),
  basecamp_project_id      TEXT,
  pdf_url                  TEXT,
  reminder_count           INTEGER     NOT NULL DEFAULT 0,
  content_generation_ready BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE TABLE messages (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role       TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
  content    TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE assets (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     UUID        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  file_name      TEXT        NOT NULL,
  storage_path   TEXT        NOT NULL,
  public_url     TEXT        NOT NULL,
  mime_type      TEXT        NOT NULL,
  file_size_bytes INTEGER,
  asset_category TEXT        CHECK (asset_category IN ('logo', 'headshot', 'photo', 'other')),
  uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE reminders (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  days_inactive INTEGER     NOT NULL
);

CREATE TABLE basecamp_tokens (
  id            INTEGER     PRIMARY KEY DEFAULT 1,
  access_token  TEXT        NOT NULL,
  refresh_token TEXT        NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT singleton CHECK (id = 1)
);


-- ------------------------------------------------------------
-- INDEXES
-- ------------------------------------------------------------

CREATE INDEX idx_sessions_status        ON sessions(status);
CREATE INDEX idx_sessions_last_activity ON sessions(last_activity_at);
CREATE INDEX idx_messages_session_id    ON messages(session_id);
CREATE INDEX idx_assets_session_id      ON assets(session_id);
CREATE INDEX idx_reminders_session_id   ON reminders(session_id);


-- ------------------------------------------------------------
-- ROW LEVEL SECURITY
-- All data access goes through the service role key (bypasses
-- RLS), so anon gets nothing by default. Authenticated admins
-- get full access for the admin dashboard.
-- ------------------------------------------------------------

ALTER TABLE admins          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets          ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE basecamp_tokens ENABLE ROW LEVEL SECURITY;

-- Admins can only manage their own auth record
CREATE POLICY "Admins manage own record"
  ON admins FOR ALL
  USING (auth.uid() = id);

-- Authenticated admins have full access to all other tables
CREATE POLICY "Admins full access to sessions"
  ON sessions FOR ALL TO authenticated USING (true);

CREATE POLICY "Admins full access to messages"
  ON messages FOR ALL TO authenticated USING (true);

CREATE POLICY "Admins full access to assets"
  ON assets FOR ALL TO authenticated USING (true);

CREATE POLICY "Admins full access to reminders"
  ON reminders FOR ALL TO authenticated USING (true);

CREATE POLICY "Admins full access to basecamp tokens"
  ON basecamp_tokens FOR ALL TO authenticated USING (true);
