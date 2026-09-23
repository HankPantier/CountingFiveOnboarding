-- 077: optimistic-concurrency version for sessions.schema_data / gap_list.
--
-- Several writers read schema_data, spend seconds-to-minutes in an AI call, and
-- write the whole blob back. Without a version check a concurrent write (an
-- operator's inline MBP edit, an audit-review submit, a suggestion approval) is
-- silently overwritten. App code now writes with
--   UPDATE ... WHERE id = $id AND schema_version = $read_version
-- and re-reads + re-applies on a miss (lib/session/schema-cas.ts).
--
-- The trigger bumps the version on EVERY write that changes schema_data,
-- gap_list, status or current_phase (so an approval or phase move landing
-- mid-write also forces a re-read), and writers that don't use the CAS helper still
-- invalidate readers that do. Callers never set schema_version themselves.
--
-- Apply BEFORE deploying the code that reads schema_version.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS schema_version bigint NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION bump_session_schema_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.schema_data IS DISTINCT FROM OLD.schema_data
     OR NEW.gap_list IS DISTINCT FROM OLD.gap_list
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.current_phase IS DISTINCT FROM OLD.current_phase THEN
    NEW.schema_version := OLD.schema_version + 1;
  ELSE
    NEW.schema_version := OLD.schema_version;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION bump_session_schema_version() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sessions_bump_schema_version ON sessions;
CREATE TRIGGER sessions_bump_schema_version
  BEFORE UPDATE ON sessions
  FOR EACH ROW
  EXECUTE FUNCTION bump_session_schema_version();

-- Verify:
--   SELECT column_name, data_type, column_default FROM information_schema.columns
--    WHERE table_name = 'sessions' AND column_name = 'schema_version';
--   SELECT tgname FROM pg_trigger WHERE tgname = 'sessions_bump_schema_version';
