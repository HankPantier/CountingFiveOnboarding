-- ============================================================
-- CountingFive Onboarding — Per-page angle/POV + advisory draft-gate critic
-- Run this entire file in Supabase → SQL Editor (or via the
-- Management API query endpoint).
-- ============================================================
-- angle: an optional per-page "point of view / information-gain" directive the
-- operator sets while proofing the outline at phase 4. Threaded into body
-- generation so the page is shaped around the firm's unique take. Distinct from
-- admin_notes (which also carries the "⚠ Needs review" fallback marker) so the
-- two never collide. Mirrors resource_ideas.angle.
--
-- critic_review: an advisory-only LLM-as-judge score written in the background
-- (Next.js after()) once a page finishes generating. It NEVER blocks or
-- regenerates — purely informational for the admin during proofing. Shape:
--   { evidence_specificity, information_gain, brand_fidelity, promise_fulfillment
--     (0-10 each), unsupported_claims: string[], notes, critic_model, scored_at }
-- ============================================================

ALTER TABLE page_outlines
  ADD COLUMN IF NOT EXISTS angle text DEFAULT NULL;

ALTER TABLE generated_pages
  ADD COLUMN IF NOT EXISTS critic_review jsonb DEFAULT NULL;
