-- ============================================================
-- Revaltus Onboarding — Advisory draft-gate critic for resource/blog drafts
-- Run this entire file in Supabase → SQL Editor (or via the
-- Management API query endpoint).
-- ============================================================
-- critic_review: the same advisory-only LLM-as-judge verdict already written for
-- generated_pages (migration 064), now also written for resource/blog posts once
-- a draft finishes generating. Written in the background; NEVER blocks or
-- regenerates a draft — it only lets the batch UI surface weak drafts for a human
-- ("complete · N flagged") instead of shipping them silently as complete. Same
-- JSON shape as generated_pages.critic_review, including the extended dimensions:
--   { evidence_specificity, information_gain, brand_fidelity, promise_fulfillment,
--     outline_coverage, input_utilization, differentiation (0-10 each),
--     unsupported_claims: string[], missing_sections: string[], notes,
--     critic_model, scored_at, needs_human_review, critic_regen_attempts }
-- ============================================================

ALTER TABLE resource_ideas
  ADD COLUMN IF NOT EXISTS critic_review jsonb DEFAULT NULL;
