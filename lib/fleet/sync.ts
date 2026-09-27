import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { addActionTextVars } from '@/lib/content/add-action-text-vars'
import {
  FONTS_MODULE,
  GITATTRIBUTES,
  GITIGNORE,
  MARKER,
  PACKAGE_JSON,
  PACKAGE_LOCK,
  TEMPLATE_DEFAULT,
  THEME_CSS,
  expectedPaths,
  isExcluded,
  isSpecialPath,
  planRepo,
} from './classify'
import {
  blobShas,
  changedPaths,
  diffNameStatus,
  findHistoricalMatch,
  git,
  isAncestor,
  mergeFile,
  pathExists,
  revParse,
  show,
  showText,
  trackedUnder,
  tryGit,
} from './git-local'
import { compareVersions, editGitignore, editPackageJson, mergeLines, readMarker, stampMarker } from './special-files'
import type { BlobView, ClientEntry, ReleaseManifest, RepoPlan } from './types'
import { repoName } from './registry'
import { regenerateLock, type NpmRunner } from './lockfile'
import { checkImportClosure } from './imports'

// Orchestration of one repo's gate → materialize → (apply) on a LOCAL clone.
// Nothing here pushes; see remote.ts. Nothing here writes to the working tree
// unless applyChanges() is called (only from `fleet-sync --apply`).

export interface SyncContext {
  templateDir: string
  /** Full sha of template@NEW. */
  to: string
  toVersion: string
  /**
   * The release manifest for OLD's version → NEW (merges every intermediate
   * release's manifest when a client skipped one). Throws when one is missing.
   */
  manifestFor: (oldVersion: string | null) => ReleaseManifest
  threeWay: boolean
  /** Dry-run replay only: gate against this client revision instead of origin/main. */
  clientRevOverride?: string
  /** Lockfile re-resolver (tests inject a fake; default runs npm in a temp dir). */
  npm?: NpmRunner
}

export interface FileChange {
  path: string
  /** null = delete. */
  content: Buffer | null
  why: string
}

export interface RepoRun {
  client: ClientEntry
  dir: string
  /** The client ref the plan was computed from (origin/main after fetch). */
  clientRev: string
  clientHead: string
  manifest: ReleaseManifest
  plan: RepoPlan
  changes: FileChange[]
  upToDate: boolean
}

export const FLEET_TRAILER = 'Fleet-Sync'

// ── clone management ────────────────────────────────────────────────────────

export function ensureClone(workDir: string, slug: string, opts: { fetch: boolean }): string {
  const dir = path.join(workDir, repoName(slug))
  if (!existsSync(path.join(dir, '.git'))) {
    mkdirSync(workDir, { recursive: true })
    git(workDir, ['clone', '-q', '--depth', '1', '--branch', 'main', `https://github.com/${slug}.git`, dir])
  } else if (opts.fetch) {
    git(dir, ['fetch', '-q', '--depth', '1', 'origin', '+refs/heads/main:refs/remotes/origin/main'])
  }
  return dir
}

export function clientRevOf(dir: string): string {
  return tryGit(dir, ['rev-parse', '--verify', '-q', 'refs/remotes/origin/main']).ok ? 'refs/remotes/origin/main' : 'HEAD'
}

// ── gate ────────────────────────────────────────────────────────────────────

export function resolveFrom(ctx: SyncContext, dir: string, clientRev: string, fromFlag: string | null): { from: string | null; oldVersion?: string | null; problem?: string; warning?: string } {
  const marker = readMarker(showText(dir, clientRev, MARKER))
  const wanted = fromFlag ?? marker.syncedFrom
  if (!wanted) {
    return {
      from: null,
      problem: `c5-template.json has no "syncedFrom" (client is on template ${marker.templateVersion ?? 'unknown'}) — pass --from <template sha of that release>`,
    }
  }
  let from: string
  try {
    from = revParse(ctx.templateDir, wanted)
  } catch {
    return { from: null, problem: `template has no commit "${wanted}"${fromFlag ? '' : ' (from syncedFrom)'} — fetch the template repo or pass --from` }
  }
  if (!isAncestor(ctx.templateDir, from, ctx.to)) return { from, problem: `template ${from.slice(0, 7)} is not an ancestor of NEW ${ctx.to.slice(0, 7)}` }
  if (marker.templateVersion && compareVersions(marker.templateVersion, ctx.toVersion) > 0) {
    return { from, problem: `client is on ${marker.templateVersion}, newer than NEW ${ctx.toVersion} — refusing to downgrade` }
  }
  // A wrong OLD makes every file the client already has look like drift (or,
  // worse, like a clean overwrite target). The marker must agree with OLD.
  const oldVersion = readMarker(showText(ctx.templateDir, from, MARKER)).templateVersion
  if (marker.templateVersion && oldVersion && oldVersion !== marker.templateVersion) {
    return { from, problem: `client marker says ${marker.templateVersion} but OLD ${from.slice(0, 7)} is ${oldVersion} — wrong --from` }
  }
  return { from, oldVersion, warning: marker.templateVersion ? undefined : 'client has no c5-template.json templateVersion — OLD taken on trust' }
}

export function gateRepo(ctx: SyncContext, client: ClientEntry, dir: string, fromFlag: string | null): RepoRun {
  const clientRev = ctx.clientRevOverride ?? clientRevOf(dir)
  const clientHead = revParse(dir, clientRev)
  const repo = repoName(client.slug)
  const empty = (from: string, blockers: string[], warnings: string[] = []): RepoRun => ({
    client,
    dir,
    clientRev,
    clientHead,
    manifest: { templateVersion: ctx.toVersion },
    plan: { repo, slug: client.slug, from, to: ctx.to, decisions: [], specials: [], blockers, warnings },
    changes: [],
    upToDate: false,
  })

  const r = resolveFrom(ctx, dir, clientRev, fromFlag)
  if (!r.from || r.problem) return empty(r.from ?? '', [r.problem ?? 'no OLD'])
  const from = r.from
  if (from === ctx.to) {
    const run = empty(from, [], ['already synced to NEW'])
    run.upToDate = true
    return run
  }
  let manifest: ReleaseManifest
  try {
    manifest = ctx.manifestFor(r.oldVersion ?? null)
  } catch (err) {
    return empty(from, [(err as Error).message])
  }

  const diff = diffNameStatus(ctx.templateDir, from, ctx.to)
  const paths = diff.map((e) => e.path)
  const client_ = blobShas(dir, clientRev, paths)
  const old = blobShas(ctx.templateDir, from, paths)
  const next = blobShas(ctx.templateDir, ctx.to, paths)
  const blobs = new Map<string, BlobView>()
  for (const e of diff) {
    const b: BlobView = { client: client_.get(e.path) ?? null, old: old.get(e.path) ?? null, next: next.get(e.path) ?? null }
    if (!isSpecialPath(e.path) && !isExcluded(e.path, manifest) && b.client && b.client !== b.old && b.client !== b.next) {
      b.historicalMatch = findHistoricalMatch(ctx.templateDir, ctx.to, e.path, b.client)
    }
    blobs.set(e.path, b)
  }

  const plan = planRepo({
    repo,
    slug: client.slug,
    from,
    to: ctx.to,
    diff,
    blobs,
    manifest,
    client: {
      has: (p) => pathExists(dir, clientRev, p),
      trackedUnder: (p) => trackedUnder(dir, clientRev, p).length,
    },
    threeWay: ctx.threeWay,
  })
  if (r.warning) plan.warnings.push(r.warning)

  const run: RepoRun = { client, dir, clientRev, clientHead, manifest, plan, changes: [], upToDate: false }
  if (plan.blockers.length === 0) materialize(ctx, run)
  return run
}

// ── materialize: compute every file's final bytes (dry-run and apply alike) ──

export function materialize(ctx: SyncContext, run: RepoRun): void {
  const { plan, dir, clientRev } = run
  const T = ctx.templateDir
  const out: FileChange[] = []
  const text = (b: Buffer) => b.toString('utf8')

  for (const d of plan.decisions) {
    if (d.action === 'WRITE' || d.action === 'WRITE-BEHIND') {
      out.push({ path: d.path, content: show(T, ctx.to, d.path), why: d.action === 'WRITE' ? 'template@NEW' : `template@NEW (client was behind at ${d.behindCommit?.slice(0, 7)})` })
    } else if (d.action === 'DELETE') {
      out.push({ path: d.path, content: null, why: d.note ?? 'deleted in template' })
    } else if (d.action === 'MERGE3') {
      const merged = mergeFile(text(show(dir, clientRev, d.path)), text(show(T, plan.from, d.path)), text(show(T, ctx.to, d.path)))
      if (merged.conflicts > 0) plan.blockers.push(`3-way merge of ${d.path} has ${merged.conflicts} conflict(s) — resolve by hand or rule overwrite/skip`)
      else out.push({ path: d.path, content: Buffer.from(merged.text), why: '3-way merge (client edits kept)' })
    }
  }

  for (const s of plan.specials) {
    try {
      if (s.kind === 'package-json') {
        const cur = showText(dir, clientRev, PACKAGE_JSON)
        if (cur === null) throw new Error('client has no package.json')
        const r = editPackageJson(cur, run.manifest.packageJson ?? {})
        if (r.text !== cur) out.push({ path: PACKAGE_JSON, content: Buffer.from(r.text), why: `surgical: ${r.changes.join(', ')}` })
      } else if (s.kind === 'gitignore') {
        const cur = showText(dir, clientRev, GITIGNORE) ?? ''
        const r = editGitignore(cur, run.manifest.gitignore ?? {})
        if (r.text !== cur) out.push({ path: GITIGNORE, content: Buffer.from(r.text), why: `lines: ${r.changes.join(', ')}` })
      } else if (s.kind === 'gitattributes') {
        const cur = showText(dir, clientRev, GITATTRIBUTES)
        const r = mergeLines(cur, showText(T, ctx.to, GITATTRIBUTES) ?? '')
        if (r.text !== (cur ?? '')) out.push({ path: GITATTRIBUTES, content: Buffer.from(r.text), why: `merge-lines: ${r.changes.length} added` })
      } else if (s.kind === 'theme-css') {
        const cur = showText(dir, clientRev, THEME_CSS) ?? ''
        const r = addActionTextVars(cur)
        if (r.status === 'error') plan.blockers.push(`theme.css additive helper: ${r.error}`)
        else if (r.status === 'added') out.push({ path: THEME_CSS, content: Buffer.from(r.css), why: 'additive helper: action-text tokens added (palette lines untouched)' })
        else if (r.status === 'updated') out.push({ path: THEME_CSS, content: Buffer.from(r.css), why: `additive helper: refreshed ${r.changed.join('; ')}` })
      } else if (s.kind === 'seed') {
        out.push({ path: s.path, content: show(T, ctx.to, s.path), why: s.path === FONTS_MODULE ? 'seed-if-absent (DEFAULT fonts module)' : 'seed-if-absent' })
      } else if (s.kind === 'delete-tracked') {
        for (const p of trackedUnder(dir, clientRev, s.path)) out.push({ path: p, content: null, why: `retired (${s.path})` })
      } else if (s.kind === 'delete-template-default') {
        out.push({ path: TEMPLATE_DEFAULT, content: null, why: 'template-only marker, never shipped' })
      } else if (s.kind === 'action-text-vars') {
        const cur = showText(dir, clientRev, THEME_CSS) ?? ''
        const r = addActionTextVars(cur)
        if (r.status === 'error') plan.blockers.push(`action-text vars: ${r.error}`)
        else if (r.status === 'added') out.push({ path: THEME_CSS, content: Buffer.from(r.css), why: 'action-text tokens added (lines added only; palette untouched)' })
        else if (r.status === 'updated') plan.warnings.push(`theme.css has the action-text set but stale -text-tint values (${r.changed.join('; ')}) — left as is (themeCss: none)`)
      } else if (s.kind === 'lockfile-regenerate') {
        const lock = showText(dir, clientRev, PACKAGE_LOCK)
        const pkg = out.find((c) => c.path === PACKAGE_JSON)?.content?.toString('utf8') ?? showText(dir, clientRev, PACKAGE_JSON)
        if (lock === null || pkg === null) throw new Error('client has no package.json / package-lock.json')
        const recipe = typeof run.manifest.lockfile === 'object' ? run.manifest.lockfile : null
        const r = regenerateLock(pkg, lock, recipe, ctx.npm)
        if (r.missing.length) plan.blockers.push(`package-lock.json still lacks ${r.missing.join(', ')} after the recipe`)
        const nonPatch = r.versionChanges.filter((v) => v.nonPatch)
        if (nonPatch.length) plan.warnings.push(`lockfile: ${nonPatch.length} non-patch version change(s): ${nonPatch.slice(0, 5).map((v) => `${v.key} ${v.from}→${v.to}`).join(', ')}`)
        if (r.text !== lock) {
          out.push({
            path: PACKAGE_LOCK,
            content: Buffer.from(r.text),
            why: `${recipe ? `recipe dropped ${r.dropped.length} entries, ` : ''}re-resolved (npm --package-lock-only); ${r.versionChanges.length} version change(s)${recipe?.expectPackages?.length ? `; has ${recipe.expectPackages.map((k) => k.replace('node_modules/', '')).join(', ')}` : ''}`,
          })
        }
      } else if (s.kind === 'marker') {
        const tm = showText(T, ctx.to, MARKER)
        if (tm === null) throw new Error('template@NEW has no c5-template.json')
        out.push({ path: MARKER, content: Buffer.from(stampMarker(tm, ctx.to)), why: `marker ${ctx.toVersion} + syncedFrom ${ctx.to.slice(0, 7)} (written last)` })
      }
    } catch (err) {
      plan.blockers.push(`${s.kind}: ${(err as Error).message}`)
    }
  }
  // Sanity: the marker is last, and nothing else is ever written twice.
  const seen = new Set<string>()
  for (const c of out) {
    if (seen.has(c.path)) plan.blockers.push(`internal: ${c.path} materialized twice`)
    seen.add(c.path)
  }
  run.changes = out
  checkImports(ctx, run)
}

// Every written code file's local imports must resolve in the client's
// post-sync tree (see imports.ts). A miss blocks the repo.
function checkImports(ctx: SyncContext, run: RepoRun): void {
  const { dir, clientRev, plan } = run
  const clientTree = new Set(git(dir, ['ls-tree', '-r', '--name-only', clientRev]).split('\n').filter(Boolean))
  const templateTree = new Set(git(ctx.templateDir, ['ls-tree', '-r', '--name-only', ctx.to]).split('\n').filter(Boolean))
  const written = new Map<string, string>()
  const deleted = new Set<string>()
  for (const c of run.changes) {
    if (c.content === null) deleted.add(c.path)
    else written.set(c.path, c.content.toString('utf8'))
  }
  const notSynced = new Set(plan.decisions.filter((d) => d.action.startsWith('SKIP') || d.action.startsWith('DRIFT')).map((d) => d.path))
  const problems = checkImportClosure({
    written,
    postSyncHas: (p) => written.has(p) || (clientTree.has(p) && !deleted.has(p)),
    templateHas: (p) => templateTree.has(p),
    staleOnClient: (p) => notSynced.has(p) && clientTree.has(p),
  })
  for (const p of problems) plan.blockers.push(`import check: ${p.file} → ${p.reason}`)
}

// ── dry-run verify (throwaway copy; the clone itself is never touched) ──────

/**
 * Write the plan's changes into a THROWAWAY shared clone at the planned client
 * commit and run `verify` there (npm ci / tsc / test / build …). The source
 * clone's working tree, index and refs are left exactly as they were.
 */
export async function verifyPlanInScratch<T>(run: RepoRun, verify: (dir: string) => Promise<T>): Promise<T> {
  if (run.plan.blockers.length) throw new Error('plan has blockers — nothing to verify')
  const tmp = mkdtempSync(path.join(os.tmpdir(), `fleet-verify-${repoName(run.client.slug)}-`))
  try {
    git(os.tmpdir(), ['clone', '-q', '--shared', '--no-checkout', run.dir, tmp])
    git(tmp, ['checkout', '-q', '--detach', run.clientHead])
    for (const c of run.changes) {
      const abs = path.join(tmp, c.path)
      if (c.content === null) rmSync(abs, { force: true, recursive: true })
      else {
        mkdirSync(path.dirname(abs), { recursive: true })
        writeFileSync(abs, c.content)
      }
    }
    return await verify(tmp)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

// ── apply (local working tree + one local commit; still no push) ────────────

export function prepareForApply(dir: string): void {
  if (changedPaths(dir).length > 0) throw new Error('local clone has uncommitted changes — clean it (or delete the clone) first')
  const head = revParse(dir, 'HEAD')
  const remote = revParse(dir, 'refs/remotes/origin/main')
  if (head !== remote && !isAncestor(dir, head, remote)) {
    throw new Error(`local HEAD ${head.slice(0, 7)} has commits not on origin/main — refusing to discard them`)
  }
  git(dir, ['checkout', '-q', '-B', 'main', 'refs/remotes/origin/main'])
}

export function commitMessage(ctx: SyncContext, run: RepoRun): string {
  const notes = run.manifest.notes ? `\n\n${run.manifest.notes}` : ''
  return `chore(template): sync template ${ctx.toVersion} (${ctx.to.slice(0, 7)})${notes}\n\n${FLEET_TRAILER}: ${ctx.toVersion} ${run.plan.from}..${ctx.to}\n`
}

/** Working-tree paths the plan did not predict (the pre-commit abort list). */
export function unexpectedChanges(actual: string[], expected: Set<string>): string[] {
  return actual.filter((p) => !expected.has(p))
}

// Write the materialized changes, abort on ANY working-tree change the plan
// didn't predict, then make one explicit-path commit. Returns the commit sha.
export function applyChanges(ctx: SyncContext, run: RepoRun): string {
  if (run.plan.blockers.length) throw new Error('plan has blockers')
  if (ctx.clientRevOverride) throw new Error('--client-rev is a dry-run replay option; refusing to apply')
  const { dir } = run
  prepareForApply(dir)
  const write = (c: FileChange) => {
    const abs = path.join(dir, c.path)
    if (c.content === null) {
      if (tryGit(dir, ['ls-files', '--error-unmatch', '--', c.path]).ok) git(dir, ['rm', '-q', '--', c.path])
      else rmSync(abs, { force: true })
    } else {
      mkdirSync(path.dirname(abs), { recursive: true })
      writeFileSync(abs, c.content)
    }
  }
  const marker = run.changes.find((c) => c.path === MARKER)
  // package-lock.json was already re-resolved (in a temp dir) by materialize.
  for (const c of run.changes) if (c !== marker) write(c)
  // The capability marker is always the LAST write.
  if (marker) write(marker)
  const expected = expectedPaths(run.plan, (p) => trackedUnder(dir, run.clientRev, p))
  for (const c of run.changes) expected.add(c.path)
  const actual = changedPaths(dir)
  const unexpected = unexpectedChanges(actual, expected)
  if (unexpected.length) {
    git(dir, ['reset', '-q', '--hard', 'refs/remotes/origin/main'])
    git(dir, ['clean', '-qfd'])
    throw new Error(`ABORT unexpected working-tree changes: ${unexpected.join(', ')}`)
  }
  if (actual.length === 0) throw new Error('nothing to commit — plan produced no changes')
  // Deletions are already staged by `git rm`; stage the written files explicitly.
  const written = actual.filter((p) => existsSync(path.join(dir, p)))
  if (written.length) git(dir, ['add', '--', ...written])
  git(dir, ['commit', '-q', '-F', '-'], commitMessage(ctx, run))
  return revParse(dir, 'HEAD')
}
