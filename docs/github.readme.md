# In-Admin Content Editor — Setup Guide

This is the operator-side setup for the in-admin content editor that commits
straight to a client's Phase II GitHub repo. The companion design doc lives
at `/Users/webhank/.claude/plans/sharded-tumbling-wadler.md`.

---

## 1. Create the GitHub App (one-time)

- Go to `https://github.com/organizations/YOUR_ORG/settings/apps` → **New GitHub App**.
- **Repository permissions**: set **Contents** to **Read & write**. Leave everything else at "No access".
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

## 4. Apply migration 014 + regen types

Migration file: `supabase/014_github_integration.sql` — adds `content_jobs.github_repo`.

Apply via your usual Supabase Management API workflow, then regenerate types:

```
npx supabase gen types typescript --project-id YOUR_PROJECT_ID > types/database.ts
```

`npx tsc --noEmit` should still pass — the manual edit and the regen produce
the same column.

## 5. Provision a repo + link it to the content_job

Repo provisioning is intentionally out of scope for this editor. For now, do
this by hand per client:

- Create a repo under the org (e.g. `acmetax-site`).
- Push the latest content deliverable into it (`content/`, `public/`, etc.).
- Make sure `main` exists with that content. The editor creates `draft`
  automatically on first visit.
- Set the DB column:

  ```sql
  UPDATE content_jobs
  SET github_repo = 'acmetax-site'
  WHERE session_id = 'PUT-SESSION-UUID-HERE';
  ```

  Either `acmetax-site` (defaults to `GITHUB_ORG`) or
  `countingfive/acmetax-site` (explicit) works.

## 6. Hook up Vercel auto-deploy

- Import the per-client repo into Vercel.
- Project settings → Git → **Production Branch** = `main`.
- Preview deployments build automatically on push to `draft` — that's the
  preview admins can review before "Publish to live".

## 7. Smoke test the round-trip

- `npm run dev`.
- Open `/admin/dashboard`. For an approved client whose content_job has
  `phase >= 6` and `github_repo` set, you'll see a new
  **Edit content ↗** action next to "View content →".
- Click it → `/admin/content/[sessionId]/edit` loads with the file tree on
  the left.
- Pick a page → edit a heading → **Save**. Should commit to `draft` with
  author = your admin email.
- Edit `nav.json` → **Save** (JSON validation runs first).
- **Publish to live** → fast-forwards `main` to `draft`, then resets `draft`
  to the new `main`. Vercel auto-deploys prod.
- Conflict test: edit a file directly on github.com, then try Save in the
  editor — should surface "This file changed on the server. Reload to
  continue." (409 handled).

---

## How the pieces fit together

| Layer | Files |
|---|---|
| DB | `supabase/014_github_integration.sql` |
| Types | `types/database.ts` — `content_jobs.github_repo` |
| GitHub client | `lib/github/app-client.ts`, `lib/github/repo-files.ts` |
| Parsers (.md ↔ structured) | `lib/editor/{markdown-sections,frontmatter,nav-config}.ts` |
| API routes (Node, admin-only) | `app/api/edit/[id]/{tree,file,files,publish,status}/route.ts` + `_helpers.ts` |
| UI components | `components/editor/{EditorShell,EditorTopBar,FileTree,PageEditor,NavEditor}.tsx` |
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

## Known follow-ups (separate specs)

- **Provisioning flow** (zip → repo). Currently manual per step 5.
- **Theme/asset editing** (brand.json, design.json, `/public/content-assets/`).
- **Preview URL** in the editor top bar — wire a Vercel deploy URL via an
  env template (`https://{project}-git-draft-{team}.vercel.app`).
- **Tighter RLS** on the editor surface — current policies grant access to all
  `authenticated` users; tighten to check `admins` table membership.

---

## Security notes (do not violate)

- `GITHUB_APP_PRIVATE_KEY` is server-only. Never import `lib/github/*` from a
  client component. Routes that touch it are all `runtime = 'nodejs'`.
- All `/api/edit/*` routes call `requireAdmin` as the first step. Anonymous
  callers get 401.
- File writes are restricted to paths under `content/` — see the prefix
  check in `app/api/edit/[id]/file/route.ts` and `files/route.ts`. Don't
  loosen this without thinking through what else lives in the repo.
- Optimistic-lock writes via blob SHA. If you ever change `writeFile` in
  `lib/github/repo-files.ts`, keep the `expectedSha` precondition path.
