-- Add the 'owner' (Site Owner) capability to the member capability set.
--
-- A Site Owner is the end client for a single site. Like 'manager' it holds
-- site-scoped content access via manager_clients AND may publish, but it is a
-- locked-down, single-site role: assigned to exactly one content-ready session,
-- dropped straight into that site's editor, and denied Theme Studio, the
-- site-wide assistant, nav/config editing, and every non-content admin surface.
--
-- All of that (exclusivity, single-assignment, UI lockdown, direct landing) is
-- enforced in application code (lib/auth/access.ts + the user-management routes
-- + the editor shell). This migration only widens the DB CHECK so 'owner' is a
-- storable capability.
--
-- No RLS changes: the only capability-scoped policies (audit_runs,
-- audit_messages in 040_capabilities.sql) reference 'auditor' only, and
-- manager_clients policies gate on manager_id = auth.uid() / admin, which apply
-- unchanged to owner rows.

ALTER TABLE admins DROP CONSTRAINT admins_capabilities_valid;

ALTER TABLE admins
  ADD CONSTRAINT admins_capabilities_valid
  CHECK (capabilities <@ ARRAY['manager', 'auditor', 'editor', 'owner']::text[]);
