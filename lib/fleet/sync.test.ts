import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyChanges, ensureClone, gateRepo, unexpectedChanges, type SyncContext } from './sync'
import { findLastFleetCommit } from './remote'
import type { ClientEntry, ReleaseManifest } from './types'

// End-to-end on throwaway local repos: a template with three commits
// (OLDER → OLD → NEW) and a client cloned from a bare "origin". No network.

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

const client: ClientEntry = { slug: 'acme/client', displayName: 'Client', liveUrl: null, themeGroup: 'g', managed: true, paused: false }
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

function makeClient(files: Record<string, string | null>): string {
  const bare = path.join(root, `origin-${Math.random().toString(36).slice(2)}.git`)
  sh(root, 'init', '-q', '--bare', '-b', 'main', bare)
  const seed = mkdtempSync(path.join(root, 'seed-'))
  sh(seed, 'init', '-q', '-b', 'main')
  commit(seed, files, 'client state')
  sh(seed, 'remote', 'add', 'origin', bare)
  sh(seed, 'push', '-q', 'origin', 'main')
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
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

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

  it('unexpectedChanges lists every path the plan did not predict', () => {
    expect(unexpectedChanges(['a', 'b', 'next-env.d.ts'], new Set(['a', 'b']))).toEqual(['next-env.d.ts'])
  })
})
