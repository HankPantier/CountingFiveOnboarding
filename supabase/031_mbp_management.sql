-- ============================================================
-- CountingFive Onboarding — MBP management
-- ============================================================
-- The MBP (Master Business Profile) is the structured `schema_data`
-- on `sessions`. This migration adds two supporting tables:
--   1. mbp_suggestions — AI-proposed MBP updates triggered when content
--      is added/edited; reviewed (approve/dismiss) by admins. Nothing
--      mutates schema_data without admin approval.
--   2. mbp_messages — the admin-only conversational MBP edit chat. Kept
--      separate from `messages` so the client transcript view (which
--      renders all `messages`) is not polluted.
--
-- Scoping is enforced in app code (API routes use the service-role
-- client, which bypasses RLS). The policies below are the safety net.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Suggested MBP updates awaiting admin review
-- ------------------------------------------------------------
CREATE TABLE mbp_suggestions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  origin      text        NOT NULL
                          CHECK (origin IN ('page_edit', 'outline_edit', 'sitemap_confirm', 'resource')),
  source_ref  text,
  changes     jsonb       NOT NULL,   -- { "<fieldPath>": { currentValue?, proposedValue, rationale } }
  summary     text        NOT NULL,
  status      text        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'approved', 'dismissed', 'superseded')),
  dedupe_key  text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid        REFERENCES admins(id) ON DELETE SET NULL
);

CREATE INDEX idx_mbp_suggestions_session ON mbp_suggestions(session_id);
CREATE INDEX idx_mbp_suggestions_status  ON mbp_suggestions(session_id, status);
-- At most one live pending suggestion per field-set per session.
CREATE UNIQUE INDEX uq_mbp_suggestions_pending
  ON mbp_suggestions(session_id, dedupe_key) WHERE status = 'pending';

ALTER TABLE mbp_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage mbp_suggestions"
  ON mbp_suggestions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins a WHERE a.id = auth.uid() AND a.role = 'admin'));

-- Managers may read (view-only) suggestions for their assigned clients.
CREATE POLICY "Managers read assigned mbp_suggestions"
  ON mbp_suggestions FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM manager_clients mc
    WHERE mc.session_id = mbp_suggestions.session_id AND mc.manager_id = auth.uid()
  ));


-- ------------------------------------------------------------
-- 2. Admin MBP edit conversation (admin-only)
-- ------------------------------------------------------------
CREATE TABLE mbp_messages (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role       text        NOT NULL CHECK (role IN ('user', 'assistant')),
  content    text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mbp_messages_session ON mbp_messages(session_id, created_at);

ALTER TABLE mbp_messages ENABLE ROW LEVEL SECURITY;

-- Admin-only: the MBP edit chat is not available to managers.
CREATE POLICY "Admins manage mbp_messages"
  ON mbp_messages FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins a WHERE a.id = auth.uid() AND a.role = 'admin'));
