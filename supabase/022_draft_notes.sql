-- ============================================================
-- CountingFive Onboarding — per-draft writer notes
-- Run this entire file in Supabase → SQL Editor
-- ============================================================
-- Optional admin instructions captured when drafting a resource post
-- (angle emphasis, must-mention items, CTA preference). Injected into the
-- drafting prompt; guarded by the brand-fit check before persistence. An
-- approved off-brand direction is recorded as a marker line inside the
-- notes themselves so the after()-detached worker sees it.
-- ============================================================

ALTER TABLE resource_ideas ADD COLUMN draft_notes text DEFAULT NULL;
