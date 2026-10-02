-- ============================================================
-- 085: Design Studio locks — freeze an area or a site-wide lever
-- ============================================================
--
-- An admin (through the design chat or a lock chip) can lock:
--   kind 'area'   key = a CSS target (data-block / data-component id, e.g.
--                 'service-cards', 'navbar'). Its look is frozen: the Studio
--                 writes scoped custom-property pins into the `locks`
--                 fragment of design-overrides.css from `snapshot`, and no
--                 chat edit / concept may change that target's CSS.
--   kind 'lever'  key = 'palette' | 'fonts' | 'tokens' | 'treatments' |
--                 'style' | 'layout:<preset>'. No chat edit, concept or
--                 Controls PATCH may change it.
--
-- snapshot (area only): { vars, darkVars, fonts, globalRules } captured from
-- the draft theme at lock time (lib/design/lock-pins.ts).
--
-- Idempotent. Run in Supabase → SQL Editor, then regenerate types/database.ts.
-- ============================================================

CREATE TABLE IF NOT EXISTS design_locks (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind        text        NOT NULL CHECK (kind IN ('area', 'lever')),
  key         text        NOT NULL CHECK (char_length(key) BETWEEN 1 AND 64),
  label       text        NOT NULL DEFAULT '' CHECK (char_length(label) <= 120),
  snapshot    jsonb       DEFAULT NULL,
  created_by  uuid        DEFAULT NULL REFERENCES admins(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, kind, key)
);

CREATE INDEX IF NOT EXISTS design_locks_session_idx ON design_locks (session_id);

ALTER TABLE design_locks ENABLE ROW LEVEL SECURITY;

-- Admin tier only, like every design_* table (migration 078).
DROP POLICY IF EXISTS "Admin tier manages design_locks" ON design_locks;
CREATE POLICY "Admin tier manages design_locks"
  ON design_locks FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid() AND admins.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid() AND admins.role = 'admin'));

-- ------------------------------------------------------------
-- Verify (read-only; run after applying):
--   SELECT rowsecurity FROM pg_tables WHERE tablename = 'design_locks';   -- true
--   SELECT policyname FROM pg_policies WHERE tablename = 'design_locks';  -- 1 row
-- ------------------------------------------------------------
