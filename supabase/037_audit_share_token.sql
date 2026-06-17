-- 037_audit_share_token.sql
-- Public, revocable share links for completed audit reports.
--   share_token: random URL-safe token used by the public /audits/<token> route.
--                UNIQUE → also provides the lookup index. NULL = not shared.
--   shared_at:   when sharing was enabled (UX/audit only).

alter table audit_runs
  add column if not exists share_token text unique,
  add column if not exists shared_at timestamptz;
