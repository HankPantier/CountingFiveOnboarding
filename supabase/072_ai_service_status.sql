-- ============================================================
-- Revaltus Onboarding — global AI service status (credit outage flag)
-- Run this entire file in Supabase → SQL Editor.
-- ============================================================
-- A single global row tracking when a Claude API call last failed because the
-- account ran out of credits (Anthropic returns "credit balance is too low").
-- Because a credit outage takes down EVERY AI feature at once, the admin shell
-- reads this to show one proactive banner ("credits have run out — add credits")
-- instead of operators discovering it one failed click at a time.
--
-- Written server-side: set on a classified 'credit' AI error
-- (lib/ai/ai-service-status.ts → recordAiCreditExhausted, called from
-- logAndFormatAiStreamError), cleared by an admin who topped up
-- (clearAiCreditExhausted). The banner also self-heals: the reader treats the
-- flag as stale after a short window, so once failures stop it disappears on its
-- own even if no one clears it.
--
-- Singleton: the boolean PK can only ever be `true` (the CHECK constraint), so
-- there is exactly one row. Service-role access only (the clear route gates via
-- requireAdminUser); RLS is enabled with NO policies, matching the
-- app-code-enforced scoping model used by no_go_phrases (069) and task_progress
-- (057).
-- ============================================================

create table ai_service_status (
  id boolean primary key default true,
  credit_exhausted_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint ai_service_status_singleton check (id = true)
);

alter table ai_service_status enable row level security;

-- Seed the single row so a plain UPDATE path always has a target.
insert into ai_service_status (id) values (true) on conflict (id) do nothing;
