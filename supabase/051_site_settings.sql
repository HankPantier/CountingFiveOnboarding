-- ============================================================
-- CountingFive Onboarding — per-client site settings
-- Run this entire file in Supabase → SQL Editor
-- ============================================================
-- One row per session holding site.config-ish settings the operator manages
-- from the admin (currently the booking/scheduling link that powers the
-- contact drawer's "Book a call"). Synced to the client repo's site.config.ts
-- `booking` block at package time and on-save for published clients. Kept OUT
-- of sessions.schema_data / the MBP — this is site config, not brand profile.
--
-- booking_provider mirrors site.config's BookingConfig.provider union
-- ('none' | 'calendly' | 'iframe'); booking_url is the full scheduling URL.
-- ============================================================

CREATE TABLE site_settings (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid        NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  booking_provider  text        NOT NULL DEFAULT 'none'
                      CHECK (booking_provider IN ('none', 'calendly', 'iframe')),
  booking_url       text        NOT NULL DEFAULT '',
  updated_by        uuid        DEFAULT NULL REFERENCES admins(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_site_settings_session_id ON site_settings(session_id);

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY — mirror migration 050 (admins-table membership).
-- App-level scoping (requireSessionAccess) is the real gate; routes use the
-- service-role client which bypasses RLS. This policy blocks any stray
-- anon/authenticated access.
-- ------------------------------------------------------------

ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage site_settings"
  ON site_settings FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid()));
