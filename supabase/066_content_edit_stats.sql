-- ============================================================
-- CountingFive Onboarding — per-page edit-activity cache
-- Run this entire file in Supabase → SQL Editor.
-- ============================================================
-- The content editor is git-native: every edit (AI or manual) is a commit to the
-- draft branch. Computing per-page edit counts + churn means walking commit
-- history with a getCommit call per commit — too slow to do on every panel load.
-- This table caches the aggregated per-file stats, keyed by the draft HEAD sha,
-- so repeat loads are instant and only NEW commits since the cached HEAD are
-- walked. It is a pure cache (safe to truncate; it self-rebuilds on next view).
-- ============================================================

CREATE TABLE IF NOT EXISTS content_edit_stats (
  session_id  uuid PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  head_sha    text NOT NULL,                 -- draft HEAD the stats were computed at
  stats       jsonb NOT NULL,                -- per-file aggregation (EditStatsAggregate)
  computed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE content_edit_stats ENABLE ROW LEVEL SECURITY;

-- Admin-only (mirrors token_usage). API routes use the service-role client and
-- bypass RLS; this policy is the belt-and-suspenders for any anon/authed access.
CREATE POLICY "content_edit_stats admin read" ON content_edit_stats
  FOR SELECT USING (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid()));
