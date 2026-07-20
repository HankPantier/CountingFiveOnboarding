# Production Deploy Checklist

Run through this before (and right after) every production deploy of the onboarding app.

## 1. Environment variables (Vercel → Project → Settings → Environment Variables)

Everything in `.env.example` must be set for Production. Highlights:

| Var | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public client pair |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only — never referenced under `app/` (CI greps for it) |
| `CRON_SECRET` | **Must be non-empty** — cron routes fail closed (500) without it, and the sweep/self-chain pipelines authenticate with it |
| `NEXT_PUBLIC_APP_URL` | Production origin (used in emails, self-chain calls, WHOIS resume) |
| `ANTHROPIC_API_KEY` | All AI calls |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` / `ADMIN_EMAIL` | `RESEND_FROM_EMAIL` must be on a verified Resend domain; check-inactivity 500s if missing |
| `SERPER_API_KEY`, `PEXELS_API_KEY`, `PAGESPEED_API_KEY`, `GOOGLE_PLACES_API_KEY` | Optional — features degrade gracefully. `GOOGLE_PLACES_API_KEY` (server-only) powers authoritative GBP data in the audit's Social & Local Presence pass; without it the pass falls back to Serper discovery |
| `GITHUB_APP_*`, `GITHUB_ORG`, `GITHUB_TEMPLATE_REPO` | Required for the content editor / publish pipeline |

## 2. Database (Supabase project `adkeemcuquotlpbjsdaa`)

- [ ] All migrations applied through the latest `supabase/0NN_*.sql` (044 adds `rate_limit_events`, `audit_runs_created_by_idx`, and the `token_usage_model_totals()` RPC — the dashboard spend cards and rate limiting silently degrade until it lands)
- [ ] `types/database.ts` regenerated and committed after the last migration
- [ ] At least one admin seeded: `INSERT INTO admins (id, email, name, role) VALUES ('<auth.users.id>', '...', '...', 'admin');`
- [ ] RLS enabled on every table (`select * from pg_tables where rowsecurity = false and schemaname = 'public'` → empty)
- [ ] `session-assets` bucket exists and is **private**

## 3. Supabase Auth configuration

- [ ] Site URL = production origin
- [ ] Redirect URLs include `https://<prod>/admin/set-password` (invite + password reset land there)

## 4. Vercel configuration

- [ ] Crons registered (from `vercel.json`): `check-inactivity` daily, `sweep-stuck-jobs` every 5 min — verify both return 200 in cron logs after deploy
- [ ] Function maxDuration overrides from `vercel.json` applied (300s pipeline routes)
- [ ] Node.js runtime (no route forces edge; `@react-pdf/renderer` + `whoiser` require node)

## 5. Post-deploy smoke test

- [ ] `GET /admin/dashboard` unauthenticated → redirects to `/admin/login`
- [ ] `GET /api/cron/sweep-stuck-jobs` without auth header → 401
- [ ] Log in, create a test session, open `/session/<id>`, send one chat message (Haiku phase — cheap), confirm a reply streams
- [ ] `GET /api/sessions/<id>/phase` returns `{ current_phase }`
- [ ] Trigger forgot-password with your admin email → reset email arrives from the verified domain
- [ ] Dashboard spend cards render non-zero after some usage (proves the 044 RPC exists)

## 6. CI

- [ ] `.github/workflows/ci.yml` green on the deploying commit (lint, typecheck, vitest, build, security greps)
