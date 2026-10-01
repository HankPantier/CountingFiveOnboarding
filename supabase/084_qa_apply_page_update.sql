-- ============================================================
-- 084: qa_apply_page_update — server-side CAS for the Apply/Dismiss-one-
--      finding route (app/api/content-jobs/[id]/pages/[pageId]/qa-findings)
-- ============================================================
-- The route's CAS used `.eq('content_markdown', <full body>)` via PostgREST.
-- A read-only probe against prod PostgREST confirmed a 12k-char body passes
-- (200) but a 30k-char body is rejected outright (400) — the filter value
-- blows the query-string length before it can even compare. Pages are capped
-- at 50k chars (app/api/content-jobs/[id]/pages/[pageId]/route.ts), so the
-- CAS must move server-side into a function the app calls via
-- `supabase.rpc(...)` (no raw SQL in app code — the SQL lives only here).
--
-- The function takes the expected state as plain scalars instead of the full
-- body:
--   - p_expected_content_md5: md5 hex of the content the caller read, or NULL
--     to skip that check entirely (used for `dismiss`, which never touches
--     content — a concurrent, unrelated content edit must not 409 it).
--   - p_expected_rev: the `QaReview.rev` counter the caller read (defaults to
--     0 for a review with no `rev` yet). `applyOneFinding` bumps `rev` by 1
--     on every call, so this doubles as an optimistic-lock version on the
--     qa_review column itself.
-- Either mismatch returns zero rows; the route maps that to a 409.
--
-- SECURITY INVOKER (not DEFINER): this function does not need to bypass RLS
-- — the route already runs on the service-role client, which bypasses RLS on
-- its own. INVOKER avoids granting this function any privilege beyond its
-- caller's.
--
-- Idempotent: CREATE OR REPLACE; safe to re-run.
--
-- VERIFICATION (run after applying):
--   SELECT qa_apply_page_update(
--     '00000000-0000-0000-0000-000000000000'::uuid,
--     '00000000-0000-0000-0000-000000000000'::uuid,
--     NULL, 0, '{}'::jsonb, false, NULL, NULL, NULL);  -- 0 rows, no error
-- ============================================================

CREATE OR REPLACE FUNCTION public.qa_apply_page_update(
  p_page_id uuid,
  p_job_id uuid,
  p_expected_content_md5 text,
  p_expected_rev integer,
  p_qa_review jsonb,
  p_content_changed boolean,
  p_content text,
  p_meta_title text,
  p_meta_description text
)
RETURNS SETOF generated_pages
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE generated_pages
  SET
    qa_review = p_qa_review,
    content_markdown = CASE WHEN p_content_changed THEN p_content ELSE content_markdown END,
    meta_title = CASE WHEN p_content_changed THEN p_meta_title ELSE meta_title END,
    meta_description = CASE WHEN p_content_changed THEN p_meta_description ELSE meta_description END,
    admin_approved_content = CASE WHEN p_content_changed THEN false ELSE admin_approved_content END
  WHERE id = p_page_id
    AND content_job_id = p_job_id
    AND (p_expected_content_md5 IS NULL OR md5(coalesce(content_markdown, '')) = p_expected_content_md5)
    AND coalesce((qa_review->>'rev')::int, 0) = p_expected_rev
  RETURNING *
$$;

REVOKE ALL ON FUNCTION public.qa_apply_page_update(
  uuid, uuid, text, integer, jsonb, boolean, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qa_apply_page_update(
  uuid, uuid, text, integer, jsonb, boolean, text, text, text
) TO service_role;
