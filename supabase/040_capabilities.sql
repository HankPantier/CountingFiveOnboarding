-- ============================================================
-- CountingFive Onboarding — Capabilities model (Auditor role)
-- ============================================================
-- Replaces the single-role tier with a capabilities model so a user
-- can hold more than one non-admin power at once (e.g. manager AND
-- auditor). After this migration:
--
--   admins.role        — account tier: 'admin' (superuser, can do
--                        anything) or 'member' (non-admin). The old
--                        'manager' value becomes 'member'.
--   admins.capabilities — text[] of non-admin powers a member holds:
--                        'manager' (site-scoped content access, via
--                        manager_clients) and/or 'auditor' (own-audit
--                        access, scoped by audit_runs.created_by).
--                        Ignored for admins (they pass everything).
--
-- Scope enforcement stays in application code (API routes use the
-- service-role client, which bypasses RLS) — see lib/auth/access.ts.
-- The RLS policies below are the safety net for any auth/anon-client
-- path, mirroring migrations 016 / 030 / 034.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Capabilities column
-- ------------------------------------------------------------
ALTER TABLE admins
  ADD COLUMN capabilities text[] NOT NULL DEFAULT '{}';

ALTER TABLE admins
  ADD CONSTRAINT admins_capabilities_valid
  CHECK (capabilities <@ ARRAY['manager', 'auditor']::text[]);


-- ------------------------------------------------------------
-- 2. Backfill + redefine role as the account tier (admin | member)
-- ------------------------------------------------------------
-- Existing managers keep their scope: they become members holding the
-- 'manager' capability (manager_clients rows are untouched).
UPDATE admins SET capabilities = ARRAY['manager'] WHERE role = 'manager';
UPDATE admins SET role = 'member' WHERE role = 'manager';

ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_role_check;
ALTER TABLE admins ADD CONSTRAINT admins_role_check CHECK (role IN ('admin', 'member'));


-- ------------------------------------------------------------
-- 3. RLS — audits reachable by their owner (auditor) as well as admins
-- ------------------------------------------------------------
-- Tightens the migration-034 policy (which granted every admins-table
-- member) to true admins, and adds an owner-scoped policy for auditors.

DROP POLICY IF EXISTS "Admins manage audit_runs" ON audit_runs;

CREATE POLICY "Admins manage all audit_runs"
  ON audit_runs FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins a WHERE a.id = auth.uid() AND a.role = 'admin'));

CREATE POLICY "Auditors access own audit_runs"
  ON audit_runs FOR ALL TO authenticated
  USING (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM admins a
      WHERE a.id = auth.uid() AND 'auditor' = ANY (a.capabilities)
    )
  );

DROP POLICY IF EXISTS "Admins manage audit_messages" ON audit_messages;

CREATE POLICY "Admins manage all audit_messages"
  ON audit_messages FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins a WHERE a.id = auth.uid() AND a.role = 'admin'));

CREATE POLICY "Auditors access own audit_messages"
  ON audit_messages FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM audit_runs r
      JOIN admins a ON a.id = auth.uid()
      WHERE r.id = audit_messages.audit_run_id
        AND r.created_by = auth.uid()
        AND 'auditor' = ANY (a.capabilities)
    )
  );
