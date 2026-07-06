-- 044: DB-backed rate limiting for public endpoints + missing auditor-scope index.
--
-- rate_limit_events is a rolling event log consumed by lib/auth/rate-limit.ts
-- (count events for a key within a window, insert one on success). Rows are
-- pruned by the sweep cron after 24h. Service-role access only: RLS is enabled
-- with no policies, matching the app-code-enforced scoping model.

create table rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  created_at timestamptz not null default now()
);

create index rate_limit_events_key_created_idx
  on rate_limit_events (key, created_at desc);

alter table rate_limit_events enable row level security;

-- Auditor-scoped queries (requireAuditAccess, list scoping, score history)
-- filter audit_runs by created_by on every request; only domain/created_at
-- were indexed.
create index audit_runs_created_by_idx on audit_runs (created_by);

-- Per-model token totals for the dashboard spend cards. The dashboard used to
-- fetch every token_usage row and sum in JS — unbounded growth. Aggregate in
-- the database instead; cost-per-model math stays in app code (PRICING map).
create or replace function token_usage_model_totals(since timestamptz default null)
returns table(model text, input_tokens bigint, output_tokens bigint)
language sql
stable
as $$
  select
    model,
    coalesce(sum(input_tokens), 0)::bigint as input_tokens,
    coalesce(sum(output_tokens), 0)::bigint as output_tokens
  from token_usage
  where since is null or created_at >= since
  group by model
$$;
