-- Migration 003: capture error messages on failed research rows
-- Lets the admin UI explain WHY a research page errored (missing API key,
-- rate limit, network, etc.) rather than just showing a red X.

ALTER TABLE research_results
  ADD COLUMN error_message text DEFAULT NULL;
