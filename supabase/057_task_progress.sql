-- 057: generic progress store for long-running operations.
--
-- task_progress holds one row per operation (image re-pull now; assemble /
-- content-gen later), keyed by a CLIENT-generated UUID so the client can start
-- polling GET /api/progress/[id] the instant it fires the work request — the
-- worker upserts progress into the same id while the request is still running.
-- Rows are ephemeral (the app only reads the latest state); the sweep cron can
-- prune old ones. Service-role access only: RLS is enabled with no policies,
-- matching the app-code-enforced scoping model (routes gate via
-- requireSessionAccess on session_id).

create table task_progress (
  id uuid primary key,                 -- client-generated (NOT a default) so the poller knows it up front
  kind text not null,                  -- 'repull-images' (future: 'assemble', 'content-gen')
  session_id uuid references sessions(id) on delete cascade,
  content_job_id uuid references content_jobs(id) on delete cascade,
  state text not null default 'running' check (state in ('running', 'done', 'error')),
  phase text,                          -- human label, e.g. 'Finding photos'
  current integer not null default 0,
  total integer not null default 0,
  message text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index task_progress_session_idx on task_progress (session_id, created_at desc);

alter table task_progress enable row level security;
