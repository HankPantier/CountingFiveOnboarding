# Operations Runbook — Backup, Recovery & Key Hygiene

What to do when data is lost, a publish goes wrong, or keys need rotating.
Written for the operator, not for code — keep it current as infrastructure changes.

## What lives where

| Data | Store | Loss impact |
|---|---|---|
| Sessions, messages, schema_data (whole client intake) | Supabase Postgres | Re-onboard the client from scratch |
| Generated pages, outlines, research, token usage | Supabase Postgres | Regenerate (costs Anthropic tokens + hours) |
| Uploaded logos/photos + resolved stock photos + package zips | Supabase Storage `session-assets` (private) | Client re-uploads; stock photos re-resolve from Pexels |
| Site content (markdown, nav, brand) | Per-client GitHub repo (`draft` + `main`) | Git history — effectively self-backing |

## Database recovery (Supabase)

1. Supabase Dashboard → project `adkeemcuquotlpbjsdaa` → **Database → Backups**.
   Free/Pro tiers take daily backups; PITR (point-in-time recovery) is available on
   Pro+ — check the current plan before assuming PITR exists.
2. To restore: Backups → pick the snapshot → Restore. **This restores the whole
   database** — coordinate so no in-flight onboarding session writes get clobbered.
3. After any restore, re-run `npx supabase gen types` and confirm migrations
   001–025 are all present (`select * from information_schema.tables`).

**RPO** (max acceptable data loss): 24h on daily backups — an in-progress client
chat that day is lost. If that's unacceptable while several clients onboard
simultaneously, upgrade to PITR (~2-minute RPO).
**RTO** (time to restore): ~30 min dashboard restore + sanity checks.

## Storage recovery

Supabase Storage has no PITR. The `session-assets` bucket is recoverable piecemeal:
- Client uploads: ask the client to re-upload (the chat history names every file).
- Stock photos: re-run packaging — `resolveStockPhotos` re-fetches anything missing
  (dedup means only the gaps are fetched).
- Package zips: re-assemble from the admin UI (Deliverables → Assemble Package).

For belt-and-braces, periodically pull a cold copy:
`npx tsx` script using the service key to list+download the bucket, or the
Supabase CLI `storage cp -r`. There is currently **no automated cold backup** —
revisit when client count makes manual recovery unacceptable.

## Live-site rollback

The editor's **Revert last publish** button (top bar) forces the client repo's
`main` back to its pre-publish state; Vercel redeploys automatically. The
published changes stay in `draft` for fixing. Only available when `main`'s tip
is a publish merge — anything else needs manual Git surgery, on purpose.

## Key rotation (quarterly)

| Key | Where it lives | How to rotate |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | `.env.local` + Vercel env | Supabase Dashboard → Settings → API → regenerate, update both |
| Supabase PAT (`SUPABASE_ACCESS_TOKEN`) | operator's own keychain | supabase.com/dashboard/account/tokens — **rotation outstanding as of 2026-06** |
| `ANTHROPIC_API_KEY` | `.env.local` + Vercel | console.anthropic.com → API Keys |
| `RESEND_API_KEY` | `.env.local` + Vercel | resend.com → API Keys |
| `PEXELS_API_KEY` | `.env.local` + Vercel | pexels.com/api |
| `CRON_SECRET` | Vercel env + vercel.json crons | generate new random, update env — cron requests use it immediately |
| GitHub App private key | Vercel env | GitHub App settings → generate new key, swap, delete old |

## Failure playbook

- **Generation/research errors**: admin email fires on completion-with-errors and
  on stuck-job sweeps. Retry from `/admin/content/[id]` (per-phase retry buttons).
- **Session locked** (`processing` stuck): the chat route clears it in finally;
  if a session is somehow locked >15 min, clear manually:
  `update sessions set processing = false where id = '<uuid>'`.
- **Pexels rate-limited**: search has 429 backoff; if a package still comes up
  short, wait an hour and re-assemble — dedup fetches only the missing files.
- **Vercel deploy fails after publish**: Revert last publish (above), fix in
  draft, re-publish.
