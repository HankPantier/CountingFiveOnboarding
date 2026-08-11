-- Add the 'editor' capability to the member capability set.
--
-- An editor is a content role like 'manager' (site-scoped content access via
-- manager_clients) but is denied the two live-mutating editor actions: Publish
-- and Rollback. Enforcement of that denial lives in application code
-- (lib/auth/access.ts canPublish + the publish/rollback routes); this migration
-- only widens the DB CHECK so 'editor' is a storable capability.
--
-- No RLS changes: the only capability-scoped policies (audit_runs,
-- audit_messages in 040_capabilities.sql) reference 'auditor' only, and
-- manager_clients policies gate on manager_id = auth.uid() / admin, which apply
-- unchanged to editor rows.

ALTER TABLE admins DROP CONSTRAINT admins_capabilities_valid;

ALTER TABLE admins
  ADD CONSTRAINT admins_capabilities_valid
  CHECK (capabilities <@ ARRAY['manager', 'auditor', 'editor']::text[]);
