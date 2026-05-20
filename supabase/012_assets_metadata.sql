-- Add a metadata column to the assets table so uploads can carry contextual
-- linkage data — initially used to bind a team-photo upload to a specific
-- team member by name, set by the chat UI right before the upload happens
-- (the agent stages `_meta.current_team_member_name` on the session and the
-- client UI reads it into the uploaded asset's metadata).
--
-- Schemaless on purpose: future asset categories (e.g., service-card photos,
-- industry-card photos, hero backgrounds) will use the same column with
-- different keys.

ALTER TABLE assets
  ADD COLUMN metadata jsonb DEFAULT NULL;

COMMENT ON COLUMN assets.metadata IS
  'Asset-specific contextual data. Schemaless. Example keys: team_member_name (for team-photo category), bound_block_id (for block-scoped uploads). Builder code reads this at package-assembly time to wire assets into the deliverable.';

-- Index for the most common lookup pattern: "find all team-photo assets for
-- this session" — used by the package builder when joining photos to team
-- members. Partial index because the metadata column is null on >90% of
-- existing rows (logos, brand guides, etc. don't need a member name).
CREATE INDEX IF NOT EXISTS assets_team_member_idx
  ON assets ((metadata->>'team_member_name'))
  WHERE metadata->>'team_member_name' IS NOT NULL;
