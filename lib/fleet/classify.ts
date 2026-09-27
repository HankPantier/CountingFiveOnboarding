import type { BlobView, DiffEntry, PathDecision, ReleaseManifest, RepoPlan, Ruling, SpecialOp } from './types'

// The 3-way release gate (pure). Each template path changed OLD..NEW is
// classified against the client's copy:
//   client == NEW                    → SAME (nothing to do)
//   client == OLD                    → WRITE / DELETE (client never customised it)
//   client == an older template blob → WRITE-BEHIND (client is behind, not customised)
//   client absent, M                 → SKIP-M-absent (module the client never opted into)
//   otherwise                        → DRIFT-* (blocking unless ruled overwrite/3way/skip)
// A 2-way diff can't tell "behind" from "customised"; this can, and that's the
// whole point (feat/fleet-rollout overwrote both).

// Paths the generic gate never writes — each has its own handler (special ops)
// or is client-owned.
export const PACKAGE_JSON = 'package.json'
export const PACKAGE_LOCK = 'package-lock.json'
export const GITIGNORE = '.gitignore'
export const GITATTRIBUTES = '.gitattributes'
export const MARKER = 'c5-template.json'
export const THEME_CSS = 'src/styles/theme.css'
export const FONTS_MODULE = 'src/app/fonts.generated.ts'
export const TEMPLATE_DEFAULT = 'content/.template-default'
const CLIENT_OWNED = /^content\//

// e2e screenshot baselines and other binaries the old scripts skipped.
export const DEFAULT_EXCLUDE = ['\\.png$']

export function isSpecialPath(p: string): boolean {
  return (
    p === PACKAGE_JSON ||
    p === PACKAGE_LOCK ||
    p === GITIGNORE ||
    p === GITATTRIBUTES ||
    p === MARKER ||
    p === THEME_CSS ||
    p === FONTS_MODULE ||
    CLIENT_OWNED.test(p)
  )
}

export function isExcluded(p: string, manifest: ReleaseManifest): boolean {
  return (manifest.exclude ?? DEFAULT_EXCLUDE).some((re) => new RegExp(re).test(p))
}

// Module a sibling test belongs to: foo.test.ts → foo.ts, foo.test.tsx → foo.tsx.
function moduleOf(p: string): string | null {
  const m = p.match(/^(.*)\.test\.(tsx?)$/)
  return m ? `${m[1]}.${m[2]}` : null
}

export interface ClassifyOptions {
  rulings?: Record<string, Ruling>
  /** Treat every unruled DRIFT-M as a 3-way merge (base = OLD). */
  threeWay?: boolean
}

export function classifyPath(entry: DiffEntry, b: BlobView, opts: ClassifyOptions = {}): PathDecision {
  const { path, status } = entry
  const base = { path, status }
  const behind = b.historicalMatch ?? null
  let d: PathDecision
  if (status === 'A') {
    if (b.client === null) d = { ...base, action: 'WRITE' }
    else if (b.client === b.next) d = { ...base, action: 'SAME' }
    else if (behind) d = { ...base, action: 'WRITE-BEHIND', behindCommit: behind }
    else d = { ...base, action: 'DRIFT-A' }
  } else if (status === 'M') {
    if (b.client === null) d = { ...base, action: 'SKIP-M-absent' }
    else if (b.client === b.next) d = { ...base, action: 'SAME' }
    else if (b.client === b.old) d = { ...base, action: 'WRITE' }
    else if (behind) d = { ...base, action: 'WRITE-BEHIND', behindCommit: behind }
    else d = { ...base, action: 'DRIFT-M' }
  } else {
    if (b.client === null) d = { ...base, action: 'SKIP-D-absent' }
    else if (b.client === b.old) d = { ...base, action: 'DELETE' }
    else if (behind) d = { ...base, action: 'DELETE', behindCommit: behind, note: 'client was behind' }
    else d = { ...base, action: 'DRIFT-D' }
  }
  if (!d.action.startsWith('DRIFT')) return d

  const ruling = opts.rulings?.[path] ?? (opts.threeWay && d.action === 'DRIFT-M' ? '3way' : undefined)
  if (!ruling) return d
  if (ruling === 'skip') return { ...d, action: 'SKIP-ruling', note: `ruled skip (was ${d.action})` }
  if (ruling === 'overwrite') return { ...d, action: status === 'D' ? 'DELETE' : 'WRITE', note: `ruled overwrite (was ${d.action})` }
  if (status !== 'M') return { ...d, note: `3way ruling needs a modified file; ${d.action} stays blocking` }
  return { ...d, action: 'MERGE3', note: 'ruled 3-way merge (base = OLD)' }
}

export interface PlanInput {
  repo: string
  slug: string
  from: string
  to: string
  diff: DiffEntry[]
  blobs: Map<string, BlobView>
  manifest: ReleaseManifest
  /** Client-side facts for the special ops. */
  client: {
    has: (p: string) => boolean
    /** Tracked paths under deleteTracked entries (count > 0 → delete op). */
    trackedUnder: (p: string) => number
  }
  threeWay?: boolean
}

/**
 * The template diff must match the release's declared file set (the CHANGELOG
 * rollout list). A changed path that isn't declared with its status blocks;
 * a declared path the diff doesn't contain only warns (a client whose OLD is
 * newer legitimately has a smaller diff). Pure.
 */
export function checkDeclaredFiles(generic: DiffEntry[], expect: NonNullable<ReleaseManifest['expectFiles']>, warnings: string[] = []): string[] {
  const lists: Record<DiffEntry['status'], Set<string>> = {
    M: new Set(expect.overwrite ?? []),
    A: new Set(expect.add ?? []),
    D: new Set(expect.delete ?? []),
  }
  const label = { M: 'overwrite', A: 'add', D: 'delete' } as const
  const blockers: string[] = []
  const seen = new Set<string>()
  for (const e of generic) {
    seen.add(e.path)
    if (lists[e.status].has(e.path)) continue
    const elsewhere = (['M', 'A', 'D'] as const).find((s) => lists[s].has(e.path))
    blockers.push(
      elsewhere
        ? `${e.path}: the template ${label[e.status]}s it but the manifest declares it under "${label[elsewhere]}"`
        : `${e.path} changed in the template (${label[e.status]}) but is not in the manifest's expectFiles — undeclared change`
    )
  }
  const missing = [...lists.M, ...lists.A, ...lists.D].filter((p) => !seen.has(p))
  if (missing.length) warnings.push(`declared but not changed OLD..NEW (client already has them?): ${missing.join(', ')}`)
  return blockers
}

// Whole-repo plan: generic decisions + special ops + blockers. Pure.
export function planRepo(input: PlanInput): RepoPlan {
  const { manifest, diff } = input
  const blockers: string[] = []
  const warnings: string[] = []
  const specials: SpecialOp[] = []
  const rulings = manifest.rulings?.[input.repo] ?? {}

  const changed = new Set(diff.map((e) => e.path))
  const generic = diff.filter((e) => !isSpecialPath(e.path) && !isExcluded(e.path, manifest))

  const decisions = generic.map((e) =>
    classifyPath(e, input.blobs.get(e.path) ?? { client: null, old: null, next: null }, { rulings, threeWay: input.threeWay })
  )
  // A new sibling test of a module the client never had would import nothing.
  const skippedModules = new Set(decisions.filter((d) => d.action === 'SKIP-M-absent').map((d) => d.path))
  for (const d of decisions) {
    const mod = moduleOf(d.path)
    if (d.status === 'A' && mod && skippedModules.has(mod) && (d.action === 'WRITE' || d.action.startsWith('DRIFT'))) {
      d.action = 'SKIP-sibling'
      d.note = `module ${mod} absent on client`
    }
  }
  for (const d of decisions) {
    if (d.action.startsWith('DRIFT')) blockers.push(`${d.action} ${d.path} — client differs from template@OLD and @NEW (add a ruling or --three-way)`)
    if (d.note?.startsWith('3way ruling needs')) blockers.push(`${d.path}: ${d.note}`)
  }
  for (const [p] of Object.entries(rulings)) {
    if (!changed.has(p)) warnings.push(`ruling for ${p} is unused (not changed in this release)`)
  }

  // Special paths that changed in the template need an explicit manifest decision.
  if (changed.has(PACKAGE_JSON)) {
    if (manifest.packageJson) specials.push({ kind: 'package-json' })
    else blockers.push('package.json changed in the template but the release manifest has no "packageJson" entry')
  } else if (manifest.packageJson && (manifest.packageJson.addScripts || manifest.packageJson.removeScripts || manifest.packageJson.setDependencies)) {
    specials.push({ kind: 'package-json' })
  }
  if (manifest.lockfile === 'regenerate' || typeof manifest.lockfile === 'object') {
    if (input.client.has(PACKAGE_LOCK)) specials.push({ kind: 'lockfile-regenerate' })
    else blockers.push('the manifest regenerates package-lock.json but the client has none')
  } else if (changed.has(PACKAGE_LOCK) && manifest.lockfile !== 'ignore') {
    blockers.push('package-lock.json changed in the template — set "lockfile" to "regenerate", a { dropPackages } recipe, or "ignore"')
  }
  if (manifest.actionTextVars === 'ensure' && input.client.has(THEME_CSS) && !(changed.has(THEME_CSS) && manifest.themeCss === 'additive-helper')) {
    specials.push({ kind: 'action-text-vars' })
  }
  if (manifest.expectFiles) blockers.push(...checkDeclaredFiles(generic, manifest.expectFiles, warnings))
  if (changed.has(GITIGNORE) && !manifest.gitignore) blockers.push('.gitignore changed in the template but the manifest has no "gitignore" entry')
  if (manifest.gitignore && input.client.has(GITIGNORE)) specials.push({ kind: 'gitignore' })
  if (changed.has(GITATTRIBUTES)) {
    if (manifest.gitattributes === 'merge-lines') specials.push({ kind: 'gitattributes' })
    else blockers.push('.gitattributes changed in the template but the manifest has no "gitattributes": "merge-lines"')
  }
  if (changed.has(THEME_CSS)) {
    if (manifest.themeCss === 'additive-helper') {
      if (input.client.has(THEME_CSS)) specials.push({ kind: 'theme-css' })
      else warnings.push('client has no src/styles/theme.css — additive helper skipped')
    } else if (manifest.themeCss !== 'none') {
      blockers.push('src/styles/theme.css changed in the template but the manifest has no "themeCss" ("additive-helper" | "none"); a wholesale copy is never allowed')
    }
  }
  const seeds = new Set(manifest.seedIfAbsent ?? [])
  if (changed.has(FONTS_MODULE)) seeds.add(FONTS_MODULE)
  for (const p of seeds) if (!input.client.has(p)) specials.push({ kind: 'seed', path: p })
  for (const p of manifest.deleteTracked ?? []) if (input.client.trackedUnder(p) > 0) specials.push({ kind: 'delete-tracked', path: p })
  if (input.client.has(TEMPLATE_DEFAULT)) specials.push({ kind: 'delete-template-default' })
  const contentChanges = diff.filter((e) => CLIENT_OWNED.test(e.path) && e.path !== TEMPLATE_DEFAULT)
  if (contentChanges.length) warnings.push(`${contentChanges.length} content/ path(s) changed in the template — client-owned, not shipped: ${contentChanges.map((e) => e.path).join(', ')}`)
  // The capability marker is always written, and always LAST.
  specials.push({ kind: 'marker' })

  return { repo: input.repo, slug: input.slug, from: input.from, to: input.to, decisions, specials, blockers, warnings }
}

/** Paths a plan will touch in the working tree (for the unexpected-change abort). */
export function expectedPaths(plan: RepoPlan, deletedUnder: (dir: string) => string[] = () => []): Set<string> {
  const out = new Set<string>()
  for (const d of plan.decisions) {
    if (['WRITE', 'WRITE-BEHIND', 'DELETE', 'MERGE3'].includes(d.action)) out.add(d.path)
  }
  for (const s of plan.specials) {
    if (s.kind === 'package-json') out.add(PACKAGE_JSON)
    else if (s.kind === 'gitignore') out.add(GITIGNORE)
    else if (s.kind === 'gitattributes') out.add(GITATTRIBUTES)
    else if (s.kind === 'theme-css') out.add(THEME_CSS)
    else if (s.kind === 'seed') out.add(s.path)
    else if (s.kind === 'delete-template-default') out.add(TEMPLATE_DEFAULT)
    else if (s.kind === 'lockfile-regenerate') out.add(PACKAGE_LOCK)
    else if (s.kind === 'action-text-vars') out.add(THEME_CSS)
    else if (s.kind === 'marker') out.add(MARKER)
    else if (s.kind === 'delete-tracked') for (const p of deletedUnder(s.path)) out.add(p)
  }
  return out
}

export function summarize(plan: RepoPlan): string {
  const count = (pred: (a: string) => boolean) => plan.decisions.filter((d) => pred(d.action)).length
  const parts = [
    `write=${count((a) => a === 'WRITE')}`,
    `behind=${count((a) => a === 'WRITE-BEHIND')}`,
    `merge3=${count((a) => a === 'MERGE3')}`,
    `delete=${count((a) => a === 'DELETE')}`,
    `same=${count((a) => a === 'SAME')}`,
    `skip=${count((a) => a.startsWith('SKIP'))}`,
    `DRIFT=${count((a) => a.startsWith('DRIFT'))}`,
  ]
  const sp = plan.specials.filter((s) => s.kind !== 'marker').map((s) => ('path' in s ? `${s.kind}:${s.path}` : s.kind))
  return `${parts.join(' ')}${sp.length ? ` specials=[${sp.join(', ')}]` : ''}`
}
