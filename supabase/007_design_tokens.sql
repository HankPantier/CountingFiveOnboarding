ALTER TABLE content_jobs
  ADD COLUMN design_tokens jsonb DEFAULT NULL;

COMMENT ON COLUMN content_jobs.design_tokens IS
  'Locked Design System tokens (type pairing, roundness, density, visual feel). Set in admin Phase 1 alongside palette.';
