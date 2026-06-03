-- ============================================================
-- CountingFive Onboarding — widen assets.asset_category CHECK
-- Run this entire file in Supabase → SQL Editor
-- ============================================================
-- Migration 001 constrained asset_category to ('logo','headshot','photo',
-- 'other'), but the codebase has since grown two more writers:
--   - 'team-photo'  — admin Team Photos panel + agent Phase 3 photo capture
--                     (app/api/upload/confirm tags via _meta.current_team_member_name)
--   - 'stock-photo' — Pexels resolver (lib/content/stock-photo-resolver.ts)
-- Inserts with those values violate the CHECK and surface in the admin UI
-- as "Failed to record asset". The stock-photo resolver swallows the same
-- failure with a console.warn, which can silently drop CREDITS attribution.
-- ============================================================

ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_asset_category_check;
ALTER TABLE assets ADD CONSTRAINT assets_asset_category_check
  CHECK (asset_category IN (
    'logo', 'headshot', 'photo', 'other',
    'team-photo', 'stock-photo'
  ));
