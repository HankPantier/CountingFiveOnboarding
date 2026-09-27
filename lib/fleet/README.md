# Fleet tooling

Two CLIs for the managed client sites in `config/clients.json`:

- `scripts/fleet-sync.ts` rolls a template release out to the client repos. It replaces the one-off `gate.sh` / `apply.sh` / `rollN.sh` / `pushN.sh` scripts from the September rollouts. It also supersedes the unmerged `feat/fleet-rollout` branch, which diffed only 2 ways and regenerated theme.css wholesale. The roster loader and the rollback idea come from that branch.
- `scripts/fleet-status.ts` gives a read-only health view of the whole fleet.

Both tools use the operator's own `git` and `gh` auth. The platform's GitHub App is not involved.

## Before any rollout

Show the roster, then confirm which repos go. This is a standing rule: see the repo `CLAUDE.md` / theme-change roster memory. `fleet-sync` prints the resolved roster first.

## fleet-sync

**Nothing is written, committed or pushed without `--apply`.** The default run is a dry-run report.

```bash
# Dry-run report for every managed repo (template@NEW = the template checkout's main)
npx tsx scripts/fleet-sync.ts --all

# Per-path detail and a JSON report
npx tsx scripts/fleet-sync.ts --slugs bblcpa,BussCPA -v --json /tmp/plan.json

# Clients whose c5-template.json has no syncedFrom yet (everyone before 2026.09.5):
# pass OLD explicitly. It must be the release the client's marker names.
npx tsx scripts/fleet-sync.ts --all --from d97c04b

# Roll out: gate → apply → local verify → push main → merge main→draft → Vercel
npx tsx scripts/fleet-sync.ts --all --apply

# Undo the last fleet sync on a repo (a revert commit, never a force-push)
npx tsx scripts/fleet-sync.ts rollback --slugs bblcpa           # dry-run
npx tsx scripts/fleet-sync.ts rollback --slugs bblcpa --apply
```

**Defaults:**
- Template checkout: `$FLEET_TEMPLATE_DIR` or `../counting-five-client-template`. Only committed blobs are read, so a dirty checkout is harmless.
- Clones: `$TMPDIR/revaltus-fleet/<repo>`, shallow, created on demand.

### The gate (3-way, per changed template path OLD..NEW)

| client blob | action |
|---|---|
| == NEW | `SAME` (nothing to do) |
| == OLD | `WRITE` / `DELETE` |
| == an older template version of that file | `WRITE-BEHIND`: the client is behind, not customised, so overwriting is safe |
| absent, file modified in template | `SKIP-M-absent`: a module the client never opted into (PricingPlans, ci.yml on platform-seeded repos). Its new sibling `*.test.ts` gets `SKIP-sibling`. |
| anything else | `DRIFT-A/M/D`: **blocks the repo** unless a ruling (`overwrite`/`3way`/`skip`) or `--three-way` resolves it |

**Where OLD comes from:**
- By default, OLD is the client's `c5-template.json` `syncedFrom`, which the tool stamps on every sync.
- Otherwise, OLD comes from `--from`.
- The client's marker version must equal OLD's version. A mismatch blocks, and so does a downgrade.

### Special files (never copied by the generic gate)

| path | handling |
|---|---|
| `c5-template.json` | Template marker plus `syncedFrom: <NEW sha>`. Always the **last** write. |
| `src/styles/theme.css` | Only `lib/content/add-action-text-vars.ts` (`"themeCss": "additive-helper"`): lines are added or refreshed and palette lines are left untouched. **A wholesale copy or regeneration never happens in a code rollout.** Palette and font backfills are a deliberate per-site action: use the Design Studio "Regenerate theme files" button. |
| `src/app/fonts.generated.ts` | Seeded only if absent (the DEFAULT module). Never overwritten. |
| `content/**` | Client-owned and never shipped. `content/.template-default` is removed if present. |
| `package.json` | Surgical text edits from the manifest: `addScripts` / `removeScripts` / `setDependencies`. Formatting is preserved. |
| `package-lock.json` | Blocks unless the manifest sets `"lockfile"` to `"ignore"`, `"regenerate"` or a recipe `{ "dropPackages": "<regex>", "expectPackages": [...] }`. For regenerate or a recipe, the client's lock (recipe entries dropped first) is re-resolved with `npm install --package-lock-only --ignore-scripts` **in a temp dir**, never in the clone. The dry-run therefore shows the exact lock that will be committed. A missing `expectPackages` key blocks, and a non-patch version change warns. |
| action-text tokens | `"actionTextVars": "ensure"` idempotently **adds** the 2026.09.4 small-text tokens (`add-action-text-vars.ts`) to a client theme.css that lacks them. A file that already has them is never touched. It is independent of `themeCss`. |
| `.gitignore` / `.gitattributes` | Exact-line remove/add, or line-merge. |

If a special path changed in the template and the manifest doesn't say how to handle it, the repo is blocked.

### Release manifests: `config/fleet-releases/<templateVersion>.json`

Every release declares its migration. There is no new `rollN.sh`.

```json
{
  "templateVersion": "2026.09.5",
  "notes": "One paragraph for the client commit body.",
  "themeCss": "none",
  "packageJson": {
    "addScripts": { "x": "tsx scripts/x.ts" },
    "removeScripts": ["old"],
    "setDependencies": { "optionalDependencies": { "@rolldown/binding-linux-x64-gnu": "<ver>" } }
  },
  "lockfile": "regenerate",
  "gitignore": { "add": [], "remove": ["design-kit/"] },
  "gitattributes": "merge-lines",
  "seedIfAbsent": ["src/app/fonts.generated.ts"],
  "deleteTracked": ["design-kit"],
  "exclude": ["\\.png$"],
  "rulings": { "Slachta-Accounting": { "src/components/footer/Footer.tsx": "3way" } }
}
```

When a client skipped a release, the manifests strictly after OLD's version and up to NEW's version are merged. `2026.09.2` to `.4` encode the three September rollouts.

**Two more checks, both blocking:**
- **`expectFiles`** (`{ overwrite, add, delete }`) is the release's declared file set, copied from the CHANGELOG. Every non-special path the template changed OLD..NEW must be declared under its status, or the repo is blocked as an undeclared change. A path that is declared but not changed only warns.
- **The import check** runs on every sync, with or without `expectFiles`. Each written code file's relative and `@/` imports must resolve to a file the client will have after the sync. A helper that is imported but not shipped blocks the repo, and so does one that changed but is being skipped for this client.

`2026.09.5.json` uses all three features: `expectFiles`, `actionTextVars: "ensure"` with `themeCss: "none"`, and the CHANGELOG's native-bindings lockfile recipe.

**Dry-run verify:** `--dry-verify <repo,…|all>` runs the full local verify (npm ci / tsc / vitest / build / fonts --check) on the planned files. It works in a throwaway `--shared` copy at the planned client commit, and the clone itself is not modified.

### --apply pipeline

1. **Clone and gate.** Every repo gets a dry-run plan. Blocked repos are never touched.
2. **Local commit.**
   - The clone must be clean, and must not hold local commits that aren't on origin/main.
   - The planned bytes are written to the clone.
   - **Any working-tree change the plan did not predict aborts the repo.** The clone is then reset.
   - One commit is made, listing its paths explicitly, with the trailer `Fleet-Sync: <version> <OLD>..<NEW>`.
3. **Local verify:** `npm ci`, `tsc`, `vitest`, `build`, then `generate-fonts --check`. This runs at concurrency ≤ 2, with one automatic retry per repo because of the Google-Fonts build flake. A repo that fails is reset and not pushed.
4. **Push and deploy, one repo at a time** (`lib/fleet/push-phase.ts`):
   1. **Draft pre-merge.** The clone fetches `draft` (unshallowing it first) and trial-merges the local sync commit into it with `git merge-tree --write-tree`. A conflict blocks that repo. **Nothing is pushed.**
   2. **Push.** Fast-forward push to `main`. It is never forced.
   3. **Merge draft.** Merge main→draft through the GitHub merges API.
   4. **Wait for Vercel.** Poll the commit's `Vercel` status. A missing status after 3 minutes is a **failure**. The only exception is a repo marked `"noDeploy": true` in `config/clients.json` (korbey).
5. **Fail fast.** After the first remote failure, no further repo is pushed. That covers a draft conflict, a rejected push, a failed draft merge, and a Vercel failure, error, timeout or missing status. The rest are reset and reported as `skipped`. `--keep-going` overrides this for non-canary failures.
6. **Canary.** `--canary <n>`: the first n repos must reach Vercel `success` before any other repo is pushed. A failed canary always stops the run. The default is **1 on the first `--apply` of a release** (no target is on NEW yet), otherwise 0. The prompt says so. `noDeploy` repos are never a canary.
7. **Report and template guard.**
   - A throw inside one repo is recorded as that repo's failure. The JSON report (`--json`) is always written.
   - `--apply` refuses when the local template `main` is not origin's `main`, or when NEW is not on origin. It checks with `ls-remote`, so the checkout's refs are not changed. A dry-run only warns.

## Recovery

- **The first `--apply` of a release:** run it on one repo (`--slugs Abramson-Company-LLC --apply`), check the site, then run `--all --apply`. The already-synced repo shows "up to date".
- **"push failed — non-fast-forward"** means the client's main moved since the gate (someone published). Delete that clone (`rm -rf $TMPDIR/revaltus-fleet/<repo>`) and re-run. The gate recomputes against the new main.
- **"main→draft would conflict (files…)"** means the repo's draft has unpublished edits to files this release changes. Nothing was pushed. Publish or discard those draft edits in the editor, or resolve them on `draft` by hand, then re-run.
- **"main pushed, but main→draft conflict"** means draft moved between the pre-merge and the API merge (a rare race). Main is live. Merge `main` into `draft` by hand, or through a PR, before anyone publishes.
- **Vercel failure or timeout:**
  - Inspect the deploy.
  - If the release is at fault, run `rollback --slugs <repo> --apply`, which reverts the Fleet-Sync commit and redeploys.
  - The remaining repos were not pushed. Re-run after the fix.
- **A stopped run:** re-running is safe. Synced repos report "up to date" and the rest are gated again.

## fleet-status (read-only)

```bash
npx tsx scripts/fleet-status.ts            # managed roster
npx tsx scripts/fleet-status.ts --slugs korbey-lague-site   # with every overrides finding
```

It reports one row per repo:
- **Template version:** main, plus draft when it differs.
- **syncedFrom.**
- **theme.css state vs `generateThemeCss(brand, design)`:**
  - `in-sync`
  - `additive`: only generator-added tokens such as `--color-ink` are missing
  - `palette`: the live palette ≠ brand.json
  - `other`
- **Fonts module:** kind and staleness.
- **Unpublished draft files.**
- **Vercel status:** main and draft.
- **Last CI run.**
- **`design-overrides.css` lint:** template-owned shadows, Tailwind-keyed selectors, colour literals, `!important`.

## Code map

- `lib/fleet/classify.ts`: the pure gate and planner.
- `lib/fleet/special-files.ts`: package.json, .gitignore and marker text edits.
- `lib/fleet/release-manifest.ts`: parse and merge manifests.
- `lib/fleet/sync.ts`: gate, materialize and apply on a local clone.
- `lib/fleet/verify.ts`: the verify runner and pool.
- `lib/fleet/remote.ts`: push, draft merge, Vercel poll and rollback lookup (the `--apply` side only).
- `lib/fleet/theme-drift.ts`, `lib/fleet/overrides-lint.ts`, `lib/fleet/status.ts`: fleet-status.
