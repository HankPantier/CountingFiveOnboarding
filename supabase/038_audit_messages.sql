-- Migration 038 — audit_messages
--
-- Adds `audit_messages`: the admin-only conversational "Edit report with AI"
-- chat attached to a completed audit run. Mirrors `mbp_messages` (031): one row
-- per turn, role-checked, cascade-deleted with its audit run. The chat lets an
-- admin direct targeted edits to the AI intelligence sections of
-- `audit_runs.result` (niche/services, competitive, narrative, etc.) without a
-- full re-crawl. Persisted so the conversation reloads when the modal reopens.

CREATE TABLE audit_messages (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_run_id uuid        NOT NULL REFERENCES audit_runs(id) ON DELETE CASCADE,
  role         text        NOT NULL CHECK (role IN ('user', 'assistant')),
  content      text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_messages_run_idx ON audit_messages(audit_run_id, created_at);

ALTER TABLE audit_messages ENABLE ROW LEVEL SECURITY;

-- Admin-only, matching audit_runs (034). App routes use the service-role client
-- and gate with requireAdminUser(); this policy is the fail-safe for any path
-- that reaches the table through the anon/auth client.
CREATE POLICY "Admins manage audit_messages"
  ON audit_messages FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid()));
