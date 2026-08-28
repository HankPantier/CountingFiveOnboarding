-- ============================================================
-- CountingFive Onboarding — per-client pricing plans (static tier cards)
-- Run this entire file in Supabase → SQL Editor
-- ============================================================
-- One row per session holding the standardized pricing-plans config (tier
-- cards, monthly/annual billing toggle + annual discount, shared "all plans
-- include" features, add-ons, intro/disclaimer/CTA). Captured in the admin
-- "Plans" editor and emitted at package time as content/pricing-plans.json for
-- the Phase II template's static <PricingPlans> block. Kept OUT of
-- sessions.schema_data / the MBP on purpose — this is plans-config, not brand.
--
-- Parallel to pricing_calculators (migration 050): /pricing is the plans page,
-- /pricing-calculator is the interactive calculator. A session can ship both.
--
-- `config` is the PricingPlansConfig JSON (types/pricing-plans.ts).
-- `enabled` gates emission: an unpublished/opt-out session ships no plans page.
-- ============================================================

CREATE TABLE pricing_plans (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid        NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  config      jsonb       NOT NULL,
  enabled     boolean     NOT NULL DEFAULT true,
  updated_by  uuid        DEFAULT NULL REFERENCES admins(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pricing_plans_session_id ON pricing_plans(session_id);

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY — mirror migration 050 (admins-table membership).
-- App-level scoping (requireSessionAccess) is the real gate; routes use the
-- service-role client which bypasses RLS. This policy blocks any stray
-- anon/authenticated access.
-- ------------------------------------------------------------

ALTER TABLE pricing_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage pricing_plans"
  ON pricing_plans FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid()));
