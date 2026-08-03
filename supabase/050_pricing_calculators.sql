-- ============================================================
-- CountingFive Onboarding — per-client pricing calculators
-- Run this entire file in Supabase → SQL Editor
-- ============================================================
-- One row per session holding the standardized pricing-calculator config
-- (service-line rates, size/complexity multipliers, add-ons, implementation
-- fee, CTA). Captured in the admin "Pricing Calculator" editor and emitted at
-- package time as content/pricing-calculator.json for the Phase II template's
-- interactive <PricingCalculator> block. Kept OUT of sessions.schema_data /
-- the MBP on purpose — pricing is calculator-config, not brand profile.
--
-- `config` is the PricingCalculatorConfig JSON (types/pricing-calculator.ts).
-- `enabled` gates emission: an unpublished/opt-out session ships no calculator.
-- ============================================================

CREATE TABLE pricing_calculators (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid        NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  config      jsonb       NOT NULL,
  enabled     boolean     NOT NULL DEFAULT true,
  updated_by  uuid        DEFAULT NULL REFERENCES admins(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pricing_calc_session_id ON pricing_calculators(session_id);

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY — mirror migration 048 (admins-table membership).
-- App-level scoping (requireSessionAccess) is the real gate; routes use the
-- service-role client which bypasses RLS. This policy blocks any stray
-- anon/authenticated access.
-- ------------------------------------------------------------

ALTER TABLE pricing_calculators ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage pricing_calculators"
  ON pricing_calculators FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid()));
