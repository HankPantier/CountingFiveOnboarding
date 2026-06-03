# In-Admin Content Editor — Setup Guide

This is the operator-side setup for the in-admin content editor that commits
straight to a client's Phase II GitHub repo. The companion design doc lives
at `/Users/webhank/.claude/plans/sharded-tumbling-wadler.md`.

---

## 1. Create the GitHub App (one-time)

- Go to `https://github.com/organizations/YOUR_ORG/settings/apps` → **New GitHub App**.
- **Repository permissions**: set **Contents** to **Read & write** and **Pull requests** to **Read & write**. Leave everything else at "No access". (Contents covers reading/writing files, the `draft` branch, and the fast-forward publish merge; Pull requests is required because the publish flow opens a PR via `pulls.create` when a fast-forward merge conflicts — without it, publish-on-conflict fails with a 403.)
- **Webhook**: uncheck "Active" — we don't use webhooks.
- **Where can this GitHub App be installed?**: Only on this account.
- Hit **Create GitHub App**. Note the **App ID** at the top.
- On the same settings page, scroll to **Private keys** → **Generate a private key**. A `.pem` file downloads. Keep it safe.

## 2. Install the App on your org

- From the App's settings page → **Install App** in the sidebar → install on your org → **All repositories** (or just the client-site repos you'll edit).
- After install, you'll land on a URL like `https://github.com/organizations/YOUR_ORG/settings/installations/12345678` — that trailing number is the **Installation ID**.

## 3. Fill in the env vars

Add these to `.env.local` (and to Vercel → Settings → Environment Variables):

```
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...PEM with \n between rows...\n-----END RSA PRIVATE KEY-----"
GITHUB_APP_INSTALLATION_ID=12345678
GITHUB_ORG=countingfive
```

The private key code accepts either real newlines or escaped `\n`. The Vercel
env var UI usually wants escaped `\n`; locally you can paste the PEM with
real newlines if you wrap the value in single quotes.

## 4. Apply migrations 014 + 015 (and the security migrations 016 + 017), regen types

- `supabase/014_github_integration.sql` — adds `content_jobs.github_repo`.
- `supabase/015_github_repo_unique.sql` — partial unique index so two
  `content_jobs` can't accidentally point at the same repo.
- `supabase/016_tighten_rls.sql` — rewrites every RLS policy to require
  admins-table membership. **Seed your admin row FIRST** (see the comment
  block at the top of the migration for the INSERT template) or you'll
  lock yourself out of `/admin/*` after applying.
- `supabase/017_assets_public_url_nullable.sql` — relaxes
  `assets.public_url` to nullable; new inserts write `null` and admin UIs
  sign URLs on demand. Required for editor uploads to behave correctly.

Apply via your usual Supabase Management API workflow, then regenerate types:

```
npx supabase gen types typescript --project-id YOUR_PROJECT_ID > types/database.ts
```

`npx tsc --noEmit` should still pass — the manual edits in this branch
and the regen produce the same shape.

## 5. Provision a repo + link it to the content_job

Repo *creation* is intentionally out of scope for this editor. For now, do
this by hand per client:

- Create a repo under the org (e.g. `acmetax-site`).
- Push the latest content deliverable into it (`content/`, `public/`, etc.).
- Make sure `main` exists with that content. The editor creates `draft`
  automatically on first visit.

**Linking the repo to the content job** is done from the admin UI — no
SQL needed:

1. From `/admin/dashboard`, click **`Connect repo →`** on the session's row.
   (This action appears whenever the content job exists but `github_repo`
   isn't set yet. Before this UI landed, the slot showed the dead
   "Repo not provisioned" tooltip.)
2. That drops you into `/admin/content/[id]`. At the top of the page, above
   the phase stepper, there's a **GitHub repo (for the in-admin editor)**
   panel. Type the slug — either bare (`acmetax-site`, defaults to
   `GITHUB_ORG`) or explicit (`countingfive/acmetax-site`) — and hit
   **Connect**.
3. The panel shows the linked slug + an Open on GitHub ↗ link, and
   surfaces **Change** and **Disconnect** controls. The dashboard's row
   action flips to **`Edit content ↗`** once the content job reaches
   phase 6.

The API behind the panel (`PATCH /api/content-jobs/[id]/github-repo`)
validates slug shape and enforces the partial-unique index, so trying to
point two clients at the same repo returns a clean 409 instead of an
opaque Postgres error.

If you ever need to do it via SQL (e.g., bulk scripted setup), the column
is still directly writable:
```sql
UPDATE content_jobs
SET github_repo = 'acmetax-site'
WHERE session_id = 'PUT-SESSION-UUID-HERE';
```

## 6. Hook up Vercel auto-deploy

- Import the per-client repo into Vercel.
- Project settings → Git → **Production Branch** = `main`.
- Preview deployments build automatically on push to `draft` — that's the
  preview admins can review before "Publish to live".

## 7. Smoke test the round-trip

- `npm run dev`.
- Open `/admin/dashboard`. For an approved client whose content_job
  exists but has no `github_repo` yet, the row action says
  **Connect repo →**. Click it → drops you on `/admin/content/[id]` with
  the GitHub repo panel at the top. Enter the slug and hit **Connect**.
- Once that content_job reaches `phase >= 6`, the dashboard row action
  flips to **Edit content ↗**. Click it → `/admin/content/[sessionId]/edit`
  loads with the file tree on the left.
- Pick a page → edit a heading → **Save**. Should commit to `draft` with
  author = your admin email.
- Edit `nav.json` → **Save** (JSON validation runs first).
- **Publish to live** → fast-forwards `main` to `draft`, then resets `draft`
  to the new `main`. Vercel auto-deploys prod.
- Conflict test: edit a file directly on github.com, then try Save in the
  editor — should surface "This file changed on the server. Reload to
  continue." (409 handled).

---

## Multi-client model — how edits stay scoped to the right repo

You will run many clients through this. Each one gets its own GitHub repo
forked from the `counting-five-client-template` codebase. The editor is
designed so cross-contamination is structurally impossible:

- **One session → one content_job → one `github_repo`.** A unique partial
  index (migration `015_github_repo_unique.sql`) prevents two `content_jobs`
  from ever pointing at the same repo, even by accident.
- **Every request resolves the repo from the DB.** The URL carries the
  session UUID (`/admin/content/[sessionId]/edit`, `/api/edit/[sessionId]/*`).
  `resolveEditContext()` in `app/api/edit/[id]/_helpers.ts` looks up
  `content_jobs.github_repo` *per request* — no global "current client" state
  exists.
- **The Octokit client is shared safely.** `getOctokit()` caches one Octokit
  instance per Node process. It is authenticated to a single GitHub App
  *installation*, which has access to every repo under the org. Each
  Octokit call passes the resolved `{owner, repo}` explicitly, so a request
  for client A cannot accidentally hit client B's repo.
- **The editor top bar shows firm name + website URL + repo slug**, so the
  admin can see at a glance which client they're editing — useful when
  multiple browser tabs are open. (`components/editor/EditorTopBar.tsx`.)
- **The dashboard `Edit content` action is per-row.** Each row's link
  embeds its own `sessionId`. There is no "global edit" entry point.

When you're about to act on someone else's session by mistake, the URL,
the top bar, and the file tree all show the firm name and the repo slug.
If you ever see two rows in the dashboard with the same repo slug, the
UNIQUE constraint has been bypassed (manual SQL) — investigate before
clicking Save.

## How the pieces fit together

| Layer | Files |
|---|---|
| DB | `supabase/014_github_integration.sql`, `supabase/015_github_repo_unique.sql` |
| Types | `types/database.ts` — `content_jobs.github_repo` |
| GitHub client | `lib/github/app-client.ts`, `lib/github/repo-files.ts` |
| Parsers (.md ↔ structured) | `lib/editor/{markdown-sections,frontmatter,nav-config}.ts` |
| Editor API routes (Node, admin-only) | `app/api/edit/[id]/{tree,file,files,publish,status}/route.ts` + `_helpers.ts` + `_path.ts` |
| Repo-connect API route | `app/api/content-jobs/[id]/github-repo/route.ts` (PATCH) |
| Editor UI components | `components/editor/{EditorShell,EditorTopBar,FileTree,PageEditor,NavEditor}.tsx` |
| Repo-connect UI | `components/admin/GithubRepoConnector.tsx` (mounted on `/admin/content/[id]`) |
| Editor route | `app/admin/content/[id]/edit/page.tsx` |
| Dashboard entry point | `app/admin/dashboard/page.tsx`, `components/admin/SessionRowActions.tsx` |
| Env | `.env.example` — four `GITHUB_*` vars |
| Deps | `package.json` — `@octokit/auth-app`, `@octokit/rest`, `@octokit/request-error` |

### Save flow

1. Admin edits in-browser (state held locally).
2. **Save** → PATCH `/api/edit/[id]/files` with `{ path, contents, expectedSha }`.
3. Server resolves repo from `content_jobs.github_repo`, mints an installation
   token via `@octokit/auth-app`, calls `repos.createOrUpdateFileContents` on
   the `draft` branch.
4. If file SHA changed remotely → 409 with the current content; UI shows
   "File changed remotely — reload."
5. Commit author = the admin's email; committer = the GitHub App user.

### Publish flow

- POST `/api/edit/[id]/publish` → `repos.merge` (fast-forward draft → main).
- On conflict (rare; only if someone committed to `main` directly) → opens
  a PR instead and returns the PR URL.
- On successful merge → `draft` is reset to the new `main` so the next round
  of edits starts clean.

### Source of truth after publish

`generated_pages` is frozen at the publish moment. The repo is the source of
truth for live content. Re-running Phase I content generation for the same
client should create a *new* repo — never overwrite — to avoid clobbering
hand-edits.

---

## Conservative v1 choices (cheap to upgrade later)

- Markdown body editor is a plain `<textarea>`. Swap to CodeMirror in
  `components/editor/PageEditor.tsx` when you want syntax highlighting / find
  & replace. Dep would be `@uiw/react-codemirror` + `@codemirror/lang-markdown`.
- `nav.json` editor is a JSON textarea with live validation. Drag-and-drop
  follow-up would use the existing `@dnd-kit/sortable` dep.
- FAQ items are edited inside each page's markdown body
  (`<!-- block: faq-accordion -->`). A dedicated structured FAQ form is a
  natural follow-up.
- Installation tokens are cached only in-memory by `@octokit/auth-app`. If
  you ever see rate-limit warnings, add a DB-backed cache mirroring
  `lib/basecamp/client.ts`'s pattern.

## Conventions to honor when provisioning lands

When the provisioning spec is built, follow these conventions so the editor
stays predictable:

- **Source of every new repo**: a single template repo under the
  CountingFive GitHub org (the `counting-five-client-template` codebase).
  Each new client repo is created from this template (GitHub's "Create
  repository from template" API or `repos.createUsingTemplate`).
- **Slug derivation**: auto from `sessions.website_url` — strip the TLD and
  append `-site`. Examples: `acmetax.com` → `acmetax-site`,
  `korbeylague.com` → `korbeylague-site`. If the derived slug collides
  with an existing repo (the unique index will refuse), append a 5-char
  prefix from the session UUID — `acmetax-site-3f2a1`. Admin can override
  with a custom slug at provisioning time.
- **Slug is immutable once set.** Renaming a repo breaks every commit URL
  and every Vercel preview. If a client rebrands, leave the repo slug
  alone and just update display names elsewhere.

## Known follow-ups (separate specs)

- **Provisioning flow** (zip → repo from template). Currently manual per step 5.
- **Theme/asset editing** (brand.json, design.json, `/public/content-assets/`).
- **Preview URL** in the editor top bar — wire a Vercel deploy URL via an
  env template (`https://{project}-git-draft-{team}.vercel.app`).
- **Tighter RLS** on the editor surface — current policies grant access to all
  `authenticated` users; tighten to check `admins` table membership.

---

## Security notes (do not violate)

- `GITHUB_APP_PRIVATE_KEY` is server-only. Never import `lib/github/*` from a
  client component. Routes that touch it are all `runtime = 'nodejs'`.
- All `/api/edit/*` routes call `requireAdmin` as the first step. `requireAdmin`
  itself checks the `admins` table, not just authentication — a logged-in
  non-admin gets 403.
- File paths are decoded + normalized via `app/api/edit/[id]/_path.ts` →
  `safePath()` before any prefix check. Encoded traversal (e.g.
  `content/..%2F..%2Fetc/passwd`) is rejected. Don't bypass this helper.
- Optimistic-lock writes via blob SHA. If you ever change `writeFile` in
  `lib/github/repo-files.ts`, keep the `expectedSha` precondition path.
