# Fleet rollout — push a theme/template update to every theme-sharing client

When a shared, template-owned change lands in the template (a block component fix,
a `generate-theme.ts` improvement, a footer tweak), this tool propagates it to the
selected client repos **without touching their content** and without ever writing
straight to a live site.

## What it touches

- **Syncs** only template-owned files — the allowlist in
  [`config/template-managed-paths.json`](../config/template-managed-paths.json)
  (`src/components/**`, `src/lib/**`, `src/app/**`, `scripts/**`, shared config).
- **Never touches** client-owned files: `content/**`, `public/**`, `site.config.ts`,
  and the generated `src/styles/theme.css` — which is **regenerated per client from
  their own `brand.json` + `design.json`**, so each site keeps its palette.
- **Flags but does not overwrite** `package.json` / `package-lock.json`: if a rollout
  needs a new dependency, `plan`/`stage` warn you so you sync deps deliberately.

## The roster

[`config/clients.json`](../config/clients.json) is the source of truth. A repo is only
reachable by a group/`--all` rollout when `managed: true` **and** `themeGroup` is set.
`paused: true` skips it. The template source (`HankPantier/CountingFiveTemplate`) is
implicit and never listed.

Current group: **`ink-and-clay`** → `bblcpa`, `korbey-lague-site`, `Accord-Advisors`,
`Abramson-Company-LLC`.

## Setup (once)

The tool authenticates as the GitHub App. Those creds live in Vercel prod, not
`.env.local`. Pull them before the first run:

```bash
npx vercel env pull .env.local   # brings in GITHUB_APP_ID / _PRIVATE_KEY / _INSTALLATION_ID / GITHUB_ORG
```

## Workflow

```bash
# 1. Dry run — see exactly what would change per repo (read-only, no writes)
npm run fleet -- plan --group ink-and-clay

# 2. Stage — writes ONLY to each repo's non-live `template-sync` branch
npm run fleet -- stage --group ink-and-clay

# 3. Verify — confirm each `template-sync` Vercel preview build is GREEN.
#    status prints the preview host to check.
npm run fleet -- status --group ink-and-clay

# 4. Promote — merge template-sync → main (goes live). Requires --confirm-green,
#    your attestation that step 3 passed for every repo.
npm run fleet -- promote --group ink-and-clay --confirm-green

# Undo the last promote on a repo if something slipped through:
npm run fleet -- rollback --slugs bblcpa
```

Selection is always exactly one of `--group <name>`, `--slugs <a,b,c>` (bare repo names
work), or `--all` (every managed, group-assigned repo). Add `--yes` to skip the confirm
prompt in automation.

## Safety model

1. Selection is printed and confirmed before any write.
2. Writes land only on `template-sync` — never `main`, never the editor's `draft`.
3. Vercel builds that branch + CI runs; you verify green before promoting.
4. `promote` is a separate, `--confirm-green`-gated, per-repo merge; a conflict opens a
   PR instead of forcing.
5. `rollback` only ever undoes the tool's own two-parent "Fleet rollout" merge commit.
6. `stage` refuses any repo that doesn't look like a template site (no `src/components/`).

## First live run

Do a full single-repo cycle before any group-wide promote:
`plan --slugs bblcpa` → `stage --slugs bblcpa` → verify preview → `promote --slugs bblcpa
--confirm-green` → spot-check the live site → `rollback --slugs bblcpa` (to confirm undo
works), then re-promote.
