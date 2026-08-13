-- Prompt-cache token accounting. Anthropic bills cache writes at 1.25x the input
-- rate and cache reads at 0.10x, so the batch generators (which now send a large
-- cached static prefix) need the split recorded to cost cached calls correctly.
-- `input_tokens` stays the TOTAL input (uncached + read + write, as the AI SDK
-- reports it); cost_usd derives the priced split. Both default 0 so historical
-- rows and non-cached calls are unaffected.
ALTER TABLE token_usage
  ADD COLUMN IF NOT EXISTS cache_read_input_tokens integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cache_creation_input_tokens integer NOT NULL DEFAULT 0;
