-- ============================================================
-- 081: Design Studio chat state — the "Fix in chat" concept persists
-- ============================================================
--
-- "Fix in chat" handed a run concept to the chat for ONE turn only: the
-- concept's bundle rode with that message, and every follow-up turn lost it.
-- The chat has no row of its own (design_chat_messages is per message), so this
-- one-row-per-session table holds the chat's durable state:
--
--   adopted_concept_id  the concept the chat keeps in context until a turn
--                       commits a version, the admin clears it, or the chat is
--                       cleared. Validated on every turn exactly like the
--                       per-message id (a READY concept of THIS session).
--                       ON DELETE SET NULL: a deleted run drops it.
--
-- The app works BEFORE this migration too: lib/design/chat-store.ts reads and
-- writes this table fail-soft (a missing table just means the hand-off lasts
-- one turn, as before).
--
-- Idempotent. Run in Supabase → SQL Editor, then regenerate types/database.ts.
-- ============================================================

CREATE TABLE IF NOT EXISTS design_chat_state (
  session_id          uuid        PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  adopted_concept_id  uuid        DEFAULT NULL REFERENCES design_concepts(id) ON DELETE SET NULL,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE design_chat_state ENABLE ROW LEVEL SECURITY;

-- Admin tier only, like every design_* table (migration 078).
DROP POLICY IF EXISTS "Admin tier manages design_chat_state" ON design_chat_state;
CREATE POLICY "Admin tier manages design_chat_state"
  ON design_chat_state FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid() AND admins.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid() AND admins.role = 'admin'));

-- ------------------------------------------------------------
-- Verify (read-only; run after applying):
--   SELECT rowsecurity FROM pg_tables WHERE tablename = 'design_chat_state';           -- true
--   SELECT policyname FROM pg_policies WHERE tablename = 'design_chat_state';          -- 1 row
-- ------------------------------------------------------------
