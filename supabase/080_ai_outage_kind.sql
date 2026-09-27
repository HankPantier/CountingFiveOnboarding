-- ============================================================
-- 080: ai_service_status records WHICH account-level outage it is
-- ============================================================
--
-- 072's singleton row only stamped credit_exhausted_at, so the admin shell's
-- banner could only say "credits have run out". An account usage limit
-- ("You have reached your specified API usage limits. You will regain access
-- on 2026-10-01 at 00:00 UTC.") pauses every AI feature the same way but needs
-- different wording and has a known end date.
--
--   outage_kind            'credit' | 'usage_limit' — the latest outage seen
--   usage_limit_resets_on  the provider's "regain access on" date, when known
--
-- credit_exhausted_at keeps its role as "last outage failure at" (the banner's
-- self-heal window), so nothing about the existing flow changes.
--
-- The app works BEFORE this migration too: lib/ai/ai-service-status.ts falls
-- back to the 072 columns on a write or read error (a credit outage still shows
-- the credit banner; a usage-limit outage just isn't bannered until applied).
--
-- Idempotent. Run in Supabase → SQL Editor, then regenerate types/database.ts.
-- ============================================================

alter table ai_service_status
  add column if not exists outage_kind text,
  add column if not exists usage_limit_resets_on date;

alter table ai_service_status drop constraint if exists ai_service_status_outage_kind_check;
alter table ai_service_status
  add constraint ai_service_status_outage_kind_check
  check (outage_kind is null or outage_kind in ('credit', 'usage_limit'));

-- VERIFY:
--   select column_name, data_type from information_schema.columns
--    where table_name = 'ai_service_status' order by ordinal_position;
--   -- expect: id, credit_exhausted_at, updated_at, outage_kind (text),
--   --         usage_limit_resets_on (date)
