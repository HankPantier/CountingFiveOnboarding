-- ============================================================
-- CountingFive Onboarding — Manager role + per-client access
-- ============================================================
-- Introduces a second user tier. Until now every row in `admins`
-- was an unrestricted admin. This migration adds:
--   1. admins.role — 'admin' (full access) or 'manager' (scoped).
--      DEFAULT 'admin' so the existing rows stay admins.
--   2. manager_clients — many-to-many link granting a manager
--      access to a chosen subset of sessions (clients).
--
-- Access scoping is enforced in application code (API routes use the
-- service-role client, which bypasses RLS). The RLS policies below are
-- the safety net for any path that uses the auth/anon client. The
-- existing session/messages/assets/content policies (migration 016)
-- are intentionally left unchanged: a manager is still a row in
-- `admins`, so those `EXISTS (admins ...)` checks still hold, and the
-- subset enforcement lives in lib/auth/access.ts.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Role column on admins
-- ------------------------------------------------------------
ALTER TABLE admins
  ADD COLUMN role text NOT NULL DEFAULT 'admin'
  CHECK (role IN ('admin', 'manager'));


-- ------------------------------------------------------------
-- 2. Manager → client (session) assignments
-- ------------------------------------------------------------
CREATE TABLE manager_clients (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id uuid        NOT NULL REFERENCES admins(id)   ON DELETE CASCADE,
  session_id uuid        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (manager_id, session_id)
);

CREATE INDEX idx_manager_clients_manager ON manager_clients(manager_id);
CREATE INDEX idx_manager_clients_session ON manager_clients(session_id);

ALTER TABLE manager_clients ENABLE ROW LEVEL SECURITY;

-- A manager may read its own assignment rows (auth-client safety net so
-- a manager can resolve its own scope). Writes go through service-role.
CREATE POLICY "Managers read own assignments"
  ON manager_clients FOR SELECT TO authenticated
  USING (manager_id = auth.uid());

-- Admins manage all assignment rows.
CREATE POLICY "Admins manage assignments"
  ON manager_clients FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins a WHERE a.id = auth.uid() AND a.role = 'admin'));
