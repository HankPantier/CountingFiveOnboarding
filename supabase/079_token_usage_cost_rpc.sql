-- ============================================================
-- 079: token_usage_model_totals returns the stored (cache-aware) cost, plus
--      missing FK indexes on the Design Studio tables.
-- ============================================================
--
-- 1. token_usage_model_totals (044, hardened in 076) summed only input/output
--    tokens and the dashboard re-priced them, ignoring cache reads (0.1x,
--    0.05x on Opus 5.5) and cache writes (1.25x / 2x for 1h). Every chat and
--    Design Studio call caches its prompt, so the dashboard overstated cached
--    input up to ~10x. recordTokenUsage already stores the correct cost in
--    token_usage.cost_usd; the RPC now sums it. The return type changes, so
--    the function is DROPPED and re-created (CREATE OR REPLACE can't change
--    OUT columns), then 076's search_path pin + grants are re-applied.
--
--    The app works BEFORE this migration too: app/admin/dashboard/page.tsx
--    uses the returned cost_usd when present and falls back to re-pricing
--    input/output when it is absent.
--
-- 2. design_versions.concept_id (ON DELETE SET NULL) and
--    design_chat_messages.version_id (ON DELETE SET NULL) had no index, so
--    deleting a concept (retry path) seq-scans design_versions.
--
-- Idempotent: safe to re-run.
--
-- VERIFICATION (run after applying):
--   SELECT * FROM token_usage_model_totals();          -- has a cost_usd column
--   SELECT sum(cost_usd) FROM token_usage;              -- equals sum of the above
--   SELECT indexname FROM pg_indexes
--    WHERE indexname IN ('design_versions_concept_id_idx',
--                        'design_chat_messages_version_id_idx');  -- 2 rows
-- ============================================================

DROP FUNCTION IF EXISTS public.token_usage_model_totals(timestamptz);

CREATE FUNCTION public.token_usage_model_totals(since timestamptz DEFAULT NULL)
RETURNS TABLE(model text, input_tokens bigint, output_tokens bigint, cost_usd numeric)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    model,
    coalesce(sum(input_tokens), 0)::bigint  AS input_tokens,
    coalesce(sum(output_tokens), 0)::bigint AS output_tokens,
    coalesce(sum(cost_usd), 0)::numeric     AS cost_usd
  FROM token_usage
  WHERE since IS NULL OR created_at >= since
  GROUP BY model
$$;

REVOKE EXECUTE ON FUNCTION public.token_usage_model_totals(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.token_usage_model_totals(timestamptz) TO service_role;


CREATE INDEX IF NOT EXISTS design_versions_concept_id_idx
  ON design_versions (concept_id) WHERE concept_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS design_chat_messages_version_id_idx
  ON design_chat_messages (version_id) WHERE version_id IS NOT NULL;
