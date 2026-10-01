import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ORPHAN_REF_PREFIX, applyChanges, assertCloneOrigin, ensureClone, gateRepo, prepareForApply, unexpectedChanges, verifyPlanInScratch, type SyncContext } from './sync'
import { draftPreflight, findLastFleetCommit, pushMain } from './remote'
import { runPushPhase } from './push-phase'
import type { ClientEntry, ReleaseManifest } from './types'

// End-to-end on throwaway local repos: a template with three commits
// (OLDER → OLD → NEW) and a client cloned from a bare "origin". No network.

// Every test shells out to real git (clones, merges, pushes to a bare origin);
// the file takes ~13s alone, and under a full parallel run single tests crossed
// the 5s default. The budget is generous, not a hang guard.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

const FIX = path.join(process.cwd(), 'lib', 'content', '__fixtures__')
const THEME = readFileSync(path.join(FIX, 'theme.css.golden'), 'utf-8')

const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
function put(dir: string, files: Record<string, string | null>) {
  for (const [p, c] of Object.entries(files)) {
    const abs = path.join(dir, p)
    if (c === null) rmSync(abs, { force: true })
    else {
      mkdirSync(path.dirname(abs), { recursive: true })
      writeFileSync(abs, c)
    }
  }
}
function commit(dir: string, files: Record<string, string | null>, msg: string): string {
  put(dir, files)
  sh(dir, 'add', '-A')
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', msg)
  return sh(dir, 'rev-parse', 'HEAD')
}
const marker = (v: string) => JSON.stringify({ templateVersion: v, capabilities: ['fonts'] })
const PKG = '{\n  "name": "site",\n  "scripts": {\n    "dev": "next dev",\n    "validate": "tsx v.ts"\n  }\n}\n'

let root: string
let T: string
let OLDER: string
let OLD: string
let NEW: string
let work: string

const client: ClientEntry = { slug: 'acme/client', displayName: 'Client', liveUrl: null, themeGroup: 'g', managed: true, paused: false, noDeploy: false }
const manifest: ReleaseManifest = {
  templateVersion: '2026.09.5',
  notes: 'Test release.',
  themeCss: 'additive-helper',
  packageJson: { addScripts: { 'generate-fonts': 'tsx scripts/generate-fonts.ts' } },
}
const ctx = (over: Partial<SyncContext> = {}): SyncContext => ({
  templateDir: T,
  to: NEW,
  toVersion: '2026.09.5',
  manifestFor: () => manifest,
  threeWay: false,
  ...over,
})

let lastBare = ''
function makeClient(files: Record<string, string | null>, draftFiles?: Record<string, string | null>): string {
  const bare = path.join(root, `origin-${Math.random().toString(36).slice(2)}.git`)
  lastBare = bare
  sh(root, 'init', '-q', '--bare', '-b', 'main', bare)
  const seed = mkdtempSync(path.join(root, 'seed-'))
  sh(seed, 'init', '-q', '-b', 'main')
  commit(seed, files, 'client state')
  sh(seed, 'remote', 'add', 'origin', bare)
  sh(seed, 'push', '-q', 'origin', 'main')
  if (draftFiles) {
    sh(seed, 'checkout', '-q', '-b', 'draft')
    commit(seed, draftFiles, 'unpublished content edit')
    sh(seed, 'push', '-q', 'origin', 'draft')
  }
  const dir = path.join(work, 'client')
  rmSync(dir, { recursive: true, force: true })
  sh(root, 'clone', '-q', bare, dir)
  sh(dir, 'config', 'user.name', 't')
  sh(dir, 'config', 'user.email', 't@t')
  return dir
}

beforeAll(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'fleet-sync-'))
  T = path.join(root, 'template')
  work = path.join(root, 'work')
  mkdirSync(T)
  mkdirSync(work)
  sh(T, 'init', '-q', '-b', 'main')
  OLDER = commit(T, { 'src/a.ts': 'a1\n', 'src/b.ts': 'b0\n', 'src/c.ts': 'c-line1\nc-line2\nc-line3\n', 'src/gone.ts': 'g\n', 'src/styles/theme.css': THEME, 'package.json': PKG, 'c5-template.json': marker('2026.09.3') }, 'older')
  OLD = commit(T, { 'src/b.ts': 'b1\n', 'c5-template.json': marker('2026.09.4') }, 'old')
  NEW = commit(
    T,
    {
      'src/a.ts': 'a2\n',
      'src/b.ts': 'b2\n',
      'src/c.ts': 'c-line1\nc-line2\nc-line3 NEW\n',
      'src/gone.ts': null,
      'src/new.ts': 'n\n',
      'src/styles/theme.css': '/* template house default */\n:root { --color-action: #00c1de; }\n',
      'src/app/fonts.generated.ts': 'export const fonts = {}\n',
      'content/design-overrides.css': '/* stub */\n',
      'package.json': PKG.replace('"dev": "next dev",', '"dev": "next dev",\n    "generate-fonts": "tsx scripts/generate-fonts.ts",'),
      'c5-template.json': marker('2026.09.5'),
    },
    'new'
  )
  // A later commit whose new file imports a helper the template never ships.
  NEW_BROKEN_IMPORT = commit(T, { 'src/uses.ts': "import { h } from './helpers/h'\nexport const x = h\n" }, 'uses a missing helper')
})
afterAll(() => rmSync(root, { recursive: true, force: true }))
let NEW_BROKEN_IMPORT: string

const clientBase = () => ({
  'src/a.ts': 'a1\n', // == OLD → WRITE
  'src/b.ts': 'b0\n', // == OLDER → WRITE-BEHIND
  'src/c.ts': 'c-line1\nc-line2\nc-line3\n',
  'src/gone.ts': 'g\n', // == OLD → DELETE
  'src/styles/theme.css': THEME, // client's own palette — must survive
  'package.json': PKG,
  'c5-template.json': marker('2026.09.4'),
  'content/.template-default': '',
  'content/design-overrides.css': '/* client */\n',
})

describe('gateRepo + applyChanges (local repos)', () => {
  it('classifies clean / behind / delete / new, keeps theme.css and content/ untouched, stamps the marker last', () => {
    const dir = makeClient(clientBase())
    const run = gateRepo(ctx(), client, ensureClone(work, client.slug, { fetch: false }), OLD)
    expect(run.plan.blockers).toEqual([])
    const byPath = Object.fromEntries(run.plan.decisions.map((d) => [d.path, d.action]))
    expect(byPath).toEqual({ 'src/a.ts': 'WRITE', 'src/b.ts': 'WRITE-BEHIND', 'src/c.ts': 'WRITE', 'src/gone.ts': 'DELETE', 'src/new.ts': 'WRITE' })
    const paths = run.changes.map((c) => c.path)
    expect(paths).not.toContain('src/styles/theme.css') // helper: file already has the tokens → unchanged
    expect(paths).not.toContain('content/design-overrides.css')
    expect(paths).toContain('src/app/fonts.generated.ts') // seed-if-absent
    expect(paths).toContain('content/.template-default') // deleted
    expect(paths.at(-1)).toBe('c5-template.json')

    const sha = applyChanges(ctx(), run)
    expect(sh(dir, 'rev-parse', 'HEAD')).toBe(sha)
    expect(readFileSync(path.join(dir, 'src/styles/theme.css'), 'utf-8')).toBe(THEME)
    expect(readFileSync(path.join(dir, 'src/b.ts'), 'utf-8')).toBe('b2\n')
    expect(JSON.parse(readFileSync(path.join(dir, 'c5-template.json'), 'utf-8'))).toMatchObject({ templateVersion: '2026.09.5', syncedFrom: NEW })
    expect(readFileSync(path.join(dir, 'package.json'), 'utf-8')).toContain('"generate-fonts": "tsx scripts/generate-fonts.ts",\n    "validate"')
    const msg = sh(dir, 'log', '-1', '--format=%B')
    expect(msg).toContain(`Fleet-Sync: 2026.09.5 ${OLD}..${NEW}`)
    expect(sh(dir, 'status', '--porcelain')).toBe('')
    // The rollback finder recognises the commit (fetch from the bare origin after a local push).
    sh(dir, 'push', '-q', 'origin', 'HEAD:main')
    expect(findLastFleetCommit(dir, 'Fleet-Sync')).toMatchObject({ sha, reverted: false })
  })

  it('the NEXT sync reads OLD from the stamped syncedFrom — and is up to date', () => {
    const dir = ensureClone(work, client.slug, { fetch: true })
    const run = gateRepo(ctx(), client, dir, null)
    expect(run.upToDate).toBe(true)
  })

  it('blocks a customised file; --three-way merges it keeping the client edit', () => {
    makeClient({ ...clientBase(), 'src/c.ts': 'CLIENT EDIT\nc-line1\nc-line2\nc-line3\n' })
    const dir = ensureClone(work, client.slug, { fetch: false })
    const blocked = gateRepo(ctx(), client, dir, OLD)
    expect(blocked.plan.blockers.join()).toMatch(/DRIFT-M src\/c\.ts/)
    expect(blocked.changes).toEqual([])
    expect(() => applyChanges(ctx(), blocked)).toThrow(/blockers/)

    const merged = gateRepo(ctx({ threeWay: true }), client, dir, OLD)
    expect(merged.plan.blockers).toEqual([])
    expect(merged.changes.find((c) => c.path === 'src/c.ts')?.content?.toString()).toBe('CLIENT EDIT\nc-line1\nc-line2\nc-line3 NEW\n')
  })

  it('refuses a wrong --from (marker disagrees), a missing syncedFrom, and a downgrade', () => {
    const dir = makeClient(clientBase())
    expect(gateRepo(ctx(), client, dir, OLDER).plan.blockers.join()).toMatch(/wrong --from/)
    expect(gateRepo(ctx(), client, dir, null).plan.blockers.join()).toMatch(/no "syncedFrom"/)
    const newer = makeClient({ ...clientBase(), 'c5-template.json': marker('2026.10.1') })
    expect(gateRepo(ctx(), client, newer, OLD).plan.blockers.join()).toMatch(/refusing to downgrade/)
  })

  it('a --client-rev replay can never be applied', () => {
    const dir = makeClient(clientBase())
    const run = gateRepo(ctx({ clientRevOverride: 'HEAD' }), client, dir, OLD)
    expect(run.plan.blockers).toEqual([])
    expect(() => applyChanges(ctx({ clientRevOverride: 'HEAD' }), run)).toThrow(/dry-run replay/)
  })

  it('refuses to apply over uncommitted local changes', () => {
    const dir = makeClient(clientBase())
    const run = gateRepo(ctx(), client, dir, OLD)
    writeFileSync(path.join(dir, 'stray.txt'), 'x')
    expect(() => applyChanges(ctx(), run)).toThrow(/uncommitted/)
  })

  it('draft pre-merge: a clean draft passes; one that edits a synced file blocks with NOTHING pushed', async () => {
    // clean: draft only has a content edit
    let dir = makeClient(clientBase(), { 'content/pages/about.md': 'edited\n' })
    let run = gateRepo(ctx(), client, dir, OLD)
    applyChanges(ctx(), run)
    expect(draftPreflight(dir)).toEqual({ ok: true, draft: 'present' })

    // conflict: draft edited src/a.ts, which the sync rewrites
    dir = makeClient(clientBase(), { 'src/a.ts': 'draft edit\n' })
    const bare = lastBare
    const mainBefore = sh(bare, 'rev-parse', 'main')
    run = gateRepo(ctx(), client, dir, OLD)
    applyChanges(ctx(), run)
    const pre = draftPreflight(dir)
    expect(pre.ok).toBe(false)
    if (!pre.ok) expect(pre.reason).toMatch(/would conflict \(src\/a\.ts\)/)

    // …and through the push phase with the REAL git ops: blocked, main untouched, local commit reset
    const phase = await runPushPhase(
      [{ slug: client.slug, dir, noDeploy: false }, { slug: 'acme/other', dir: '/nonexistent', noDeploy: false }],
      { keepGoing: false, canary: 0, deployWait: false },
      {
        draftPreflight,
        pushMain,
        mergeDraft: () => ({ result: 'merged', detail: '' }),
        waitDeploy: async () => ({ state: 'success', url: null }),
        resetLocal: (d) => {
          if (d !== '/nonexistent') sh(d, 'reset', '-q', '--hard', 'refs/remotes/origin/main')
        },
      }
    )
    expect(phase.results.map((r) => r.status)).toEqual(['blocked', 'skipped'])
    expect(sh(bare, 'rev-parse', 'main')).toBe(mainBefore)
    expect(sh(dir, 'rev-parse', 'HEAD')).toBe(mainBefore)
  })

  it('no draft branch on origin → preflight passes with draft absent', () => {
    const dir = makeClient(clientBase())
    applyChanges(ctx(), gateRepo(ctx(), client, dir, OLD))
    expect(draftPreflight(dir)).toEqual({ ok: true, draft: 'absent' })
  })

  it('import check: a written file importing something the client will not have blocks the repo', () => {
    const dir = makeClient(clientBase())
    const run = gateRepo(ctx({ to: NEW_BROKEN_IMPORT }), client, dir, OLD)
    expect(run.plan.blockers.join('\n')).toMatch(/import check: src\/uses\.ts → import "\.\/helpers\/h" resolves to no file/)
  })

  it('2026.09.5 shape: themeCss none never ships the template theme.css; actionTextVars ensure adds missing tokens; the lock recipe is materialized', () => {
    const stripped = THEME.split('\n')
      .filter((l) => !/--color-action-(text|on-primary|on-ink)/.test(l))
      .join('\n')
    const lock = JSON.stringify({ name: 'site', lockfileVersion: 3, packages: { '': {}, 'node_modules/rolldown': { version: '1.0.0' }, 'node_modules/@rolldown/binding-darwin-arm64': { version: '1.0.0' } } }, null, 2)
    const dir = makeClient({ ...clientBase(), 'src/styles/theme.css': stripped, 'package-lock.json': lock })
    const recipeManifest: ReleaseManifest = {
      ...manifest,
      themeCss: 'none',
      actionTextVars: 'ensure',
      lockfile: { dropPackages: '(^|/)node_modules/(rolldown|@rolldown/binding-)', expectPackages: ['node_modules/@rolldown/binding-linux-x64-gnu'] },
    }
    const npm = (cwd: string) => {
      const l = JSON.parse(readFileSync(path.join(cwd, 'package-lock.json'), 'utf8')) as { packages: Record<string, unknown> }
      l.packages['node_modules/rolldown'] = { version: '1.0.0' }
      l.packages['node_modules/@rolldown/binding-linux-x64-gnu'] = { version: '1.0.0' }
      writeFileSync(path.join(cwd, 'package-lock.json'), JSON.stringify(l, null, 2) + '\n')
      return { ok: true, err: '' }
    }
    const run = gateRepo(ctx({ manifestFor: () => recipeManifest, npm }), client, dir, OLD)
    expect(run.plan.blockers).toEqual([])
    const theme = run.changes.find((c) => c.path === 'src/styles/theme.css')
    expect(theme?.why).toMatch(/action-text tokens added/)
    expect(theme?.content?.toString()).toContain('--color-action-text:')
    expect(theme?.content?.toString()).not.toContain('template house default')
    const lockChange = run.changes.find((c) => c.path === 'package-lock.json')
    expect(lockChange?.content?.toString()).toContain('binding-linux-x64-gnu')
    expect(lockChange?.content?.toString()).not.toContain('binding-darwin-arm64')

    // Applying commits the materialized lock + theme with no unexpected changes; marker last.
    applyChanges(ctx({ manifestFor: () => recipeManifest, npm }), run)
    expect(sh(dir, 'show', '--name-only', '--format=', 'HEAD').split('\n')).toEqual(expect.arrayContaining(['package-lock.json', 'src/styles/theme.css', 'c5-template.json']))
  })

  it('dry-run verify runs on a throwaway copy with the planned files; the clone is untouched', async () => {
    const dir = makeClient(clientBase())
    const head = sh(dir, 'rev-parse', 'HEAD')
    const run = gateRepo(ctx(), client, dir, OLD)
    const seen = await verifyPlanInScratch(run, async (scratch) => ({
      b: readFileSync(path.join(scratch, 'src/b.ts'), 'utf8'),
      gone: existsSync(path.join(scratch, 'src/gone.ts')),
      scratch,
    }))
    expect(seen).toMatchObject({ b: 'b2\n', gone: false })
    expect(existsSync(seen.scratch)).toBe(false)
    expect(sh(dir, 'rev-parse', 'HEAD')).toBe(head)
    expect(sh(dir, 'status', '--porcelain')).toBe('')
    expect(readFileSync(path.join(dir, 'src/b.ts'), 'utf8')).toBe('b0\n')
  })

  it('unexpectedChanges lists every path the plan did not predict', () => {
    expect(unexpectedChanges(['a', 'b', 'next-env.d.ts'], new Set(['a', 'b']))).toEqual(['next-env.d.ts'])
  })
})

describe('assertCloneOrigin (FLEET-4)', () => {
  it('refuses a reused clone whose GitHub origin is another owner’s same-named repo', () => {
    const dir = mkdtempSync(path.join(root, 'origin-check-'))
    sh(dir, 'init', '-q')
    sh(dir, 'remote', 'add', 'origin', 'https://github.com/other/client.git')
    expect(() => assertCloneOrigin(dir, 'acme/client')).toThrow(/is other\/client, not acme\/client/)
    expect(() => assertCloneOrigin(dir, 'Other/Client')).not.toThrow()
    sh(dir, 'remote', 'set-url', 'origin', 'git@github.com:acme/client.git')
    expect(() => assertCloneOrigin(dir, 'acme/client')).not.toThrow()
  })
})

describe('prepareForApply — stale shallow clone cache (FLEET-1)', () => {
  // A --depth 1 clone whose origin main then moves (a content publish).
  function shallowClone(): { bare: string; seed: string; dir: string } {
    const bare = path.join(root, `origin-${Math.random().toString(36).slice(2)}.git`)
    sh(root, 'init', '-q', '--bare', '-b', 'main', bare)
    const seed = mkdtempSync(path.join(root, 'seed-'))
    sh(seed, 'init', '-q', '-b', 'main')
    commit(seed, { 'a.txt': 'a\n' }, 'a')
    commit(seed, { 'b.txt': 'b\n' }, 'b')
    sh(seed, 'remote', 'add', 'origin', bare)
    sh(seed, 'push', '-q', 'origin', 'main')
    const dir = mkdtempSync(path.join(root, 'shallow-'))
    rmSync(dir, { recursive: true, force: true })
    sh(root, 'clone', '-q', '--depth', '1', '--branch', 'main', `file://${bare}`, dir)
    sh(dir, 'config', 'user.name', 't')
    sh(dir, 'config', 'user.email', 't@t')
    commit(seed, { 'c.txt': 'c\n' }, 'c (a publish)')
    sh(seed, 'push', '-q', 'origin', 'main')
    sh(dir, 'fetch', '-q', '--depth', '1', 'origin', '+refs/heads/main:refs/remotes/origin/main')
    return { bare, seed, dir }
  }

  it('unshallows and resets when main merely moved ahead (no manual rm -rf)', () => {
    const { dir } = shallowClone()
    expect(prepareForApply(dir)).toBeNull()
    expect(sh(dir, 'rev-parse', 'HEAD')).toBe(sh(dir, 'rev-parse', 'refs/remotes/origin/main'))
  })

  it('saves a stale unpushed Fleet-Sync commit to a backup ref, then resets', () => {
    const { dir } = shallowClone()
    const stale = commit(dir, { 'sync.txt': 'x\n' }, 'chore(template): sync template 2026.09.5\n\nFleet-Sync: 2026.09.5 aaa..bbb\n')
    const warning = prepareForApply(dir)
    expect(warning).toMatch(/saved to refs\/fleet-orphans\//)
    const refs = sh(dir, 'for-each-ref', '--format=%(objectname)', ORPHAN_REF_PREFIX)
    expect(refs).toBe(stale)
    expect(sh(dir, 'rev-parse', 'HEAD')).toBe(sh(dir, 'rev-parse', 'refs/remotes/origin/main'))
  })

  it('refuses (old message, nothing reset) when a local commit is not a Fleet-Sync commit', () => {
    const { dir } = shallowClone()
    const mine = commit(dir, { 'mine.txt': 'hand work\n' }, 'a hand edit someone made in the clone')
    expect(() => prepareForApply(dir)).toThrow(/has commits not on origin\/main — refusing to discard them/)
    expect(sh(dir, 'rev-parse', 'HEAD')).toBe(mine)
    expect(sh(dir, 'for-each-ref', '--format=%(refname)', ORPHAN_REF_PREFIX)).toBe('')
  })
})
