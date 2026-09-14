-- ============================================================
-- Revaltus Onboarding — global "no-go phrases" registry
-- Run this entire file in Supabase → SQL Editor.
-- ============================================================
-- One global, admin-curated list of phrases that must NEVER appear in any
-- AI-generated content across every client site (e.g. the cliché
-- "receipts in a shoebox"). Not session-scoped — this is a single shared list.
--
-- Consumed by lib/content/no-go-phrases.ts, which injects the list into every
-- async content generator's prompt and feeds hits into the anti-slop
-- validate→retry loop (validateContent). Managed from the admin UI
-- (Admin → No-go phrases). Service-role access only (routes gate via
-- requireAdminUser); RLS is enabled with NO policies, matching the
-- app-code-enforced scoping model used by wordpress_sites (migration 067) and
-- task_progress (migration 057).
--
-- phrase_normalized is the dedupe key + match key: lowercased, whitespace
-- collapsed. It is written by the API (lib/content/no-go-phrases.ts →
-- normalizeNoGo) rather than a generated column so the normalization logic
-- lives in one TypeScript place and can evolve without a migration.
-- ============================================================

create table no_go_phrases (
  id uuid primary key default gen_random_uuid(),
  phrase text not null,                    -- display phrase as entered
  phrase_normalized text not null unique,  -- lowercased + whitespace-collapsed (dedupe + match key)
  note text,                               -- optional reason/context
  created_by uuid references admins(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table no_go_phrases enable row level security;

-- Seed the phrase that prompted this system.
insert into no_go_phrases (phrase, phrase_normalized, note)
values ('receipts in a shoebox', 'receipts in a shoebox', 'Overused accounting cliché');
