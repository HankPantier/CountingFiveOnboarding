import { describe, expect, it } from 'vitest'
import { checkDeclaredFiles, classifyPath, expectedPaths, isSpecialPath, planRepo, summarize, type PlanInput } from './classify'
import type { BlobView, DiffEntry, ReleaseManifest } from './types'

const O = 'o'.repeat(40)
const N = 'n'.repeat(40)
const C = 'c'.repeat(40)
const H = 'h'.repeat(40)

describe('classifyPath — the 3-way gate', () => {
  const M = (b: Partial<BlobView>) => classifyPath({ status: 'M', path: 'src/x.ts' }, { client: null, old: O, next: N, ...b })
  it('M: client == OLD → WRITE; == NEW → SAME; absent → SKIP-M-absent', () => {
    expect(M({ client: O }).action).toBe('WRITE')
    expect(M({ client: N }).action).toBe('SAME')
    expect(M({ client: null }).action).toBe('SKIP-M-absent')
  })
  it('M: client matching an OLDER template blob is BEHIND (safe overwrite), not drift', () => {
    const d = M({ client: C, historicalMatch: H })
    expect(d.action).toBe('WRITE-BEHIND')
    expect(d.behindCommit).toBe(H)
  })
  it('M: a real customisation is DRIFT-M (a 2-way diff would have overwritten it)', () => {
    expect(M({ client: C }).action).toBe('DRIFT-M')
  })
  it('A: absent → WRITE; same → SAME; different → DRIFT-A', () => {
    const A = (client: string | null) => classifyPath({ status: 'A', path: 'n.ts' }, { client, old: null, next: N }).action
    expect(A(null)).toBe('WRITE')
    expect(A(N)).toBe('SAME')
    expect(A(C)).toBe('DRIFT-A')
  })
  it('D: == OLD → DELETE; absent → SKIP-D-absent; customised → DRIFT-D', () => {
    const D = (client: string | null) => classifyPath({ status: 'D', path: 'd.ts' }, { client, old: O, next: null }).action
    expect(D(O)).toBe('DELETE')
    expect(D(null)).toBe('SKIP-D-absent')
    expect(D(C)).toBe('DRIFT-D')
  })
  it('rulings resolve drift: overwrite / skip / 3way (M only)', () => {
    const e: DiffEntry = { status: 'M', path: 'f.tsx' }
    const b: BlobView = { client: C, old: O, next: N }
    expect(classifyPath(e, b, { rulings: { 'f.tsx': 'overwrite' } }).action).toBe('WRITE')
    expect(classifyPath(e, b, { rulings: { 'f.tsx': 'skip' } }).action).toBe('SKIP-ruling')
    expect(classifyPath(e, b, { rulings: { 'f.tsx': '3way' } }).action).toBe('MERGE3')
    expect(classifyPath(e, b, { threeWay: true }).action).toBe('MERGE3')
    expect(classifyPath({ status: 'D', path: 'f.tsx' }, { client: C, old: O, next: null }, { rulings: { 'f.tsx': 'overwrite' } }).action).toBe('DELETE')
    expect(classifyPath({ status: 'A', path: 'f.tsx' }, { client: C, old: null, next: N }, { rulings: { 'f.tsx': '3way' } }).action).toBe('DRIFT-A')
  })
})

describe('isSpecialPath', () => {
  it('routes package.json, markers, theme.css, fonts module and content/ away from the generic gate', () => {
    for (const p of ['package.json', 'package-lock.json', '.gitignore', '.gitattributes', 'c5-template.json', 'src/styles/theme.css', 'src/app/fonts.generated.ts', 'content/brand.json'])
      expect(isSpecialPath(p)).toBe(true)
    expect(isSpecialPath('src/components/Footer.tsx')).toBe(false)
  })
})

function input(diff: DiffEntry[], blobs: Record<string, Partial<BlobView>>, manifest: ReleaseManifest, has: string[] = []): PlanInput {
  return {
    repo: 'bblcpa',
    slug: 'HankPantier/bblcpa',
    from: O,
    to: N,
    diff,
    blobs: new Map(Object.entries(blobs).map(([k, v]) => [k, { client: null, old: O, next: N, ...v }])),
    manifest,
    client: { has: (p) => has.includes(p), trackedUnder: (p) => (has.includes(p) ? 3 : 0) },
  }
}

describe('planRepo', () => {
  const base: ReleaseManifest = { templateVersion: '2026.09.5' }

  it('skips a new sibling test of a module the client never had (PricingPlans on non-opted repos)', () => {
    const plan = planRepo(
      input(
        [
          { status: 'M', path: 'src/lib/pricing.ts' },
          { status: 'A', path: 'src/lib/pricing.test.ts' },
        ],
        { 'src/lib/pricing.ts': { client: null }, 'src/lib/pricing.test.ts': { client: null, old: null } },
        base
      )
    )
    expect(plan.decisions.map((d) => d.action)).toEqual(['SKIP-M-absent', 'SKIP-sibling'])
    expect(plan.blockers).toEqual([])
  })

  it('never gates excluded (e2e PNG) paths', () => {
    const plan = planRepo(input([{ status: 'M', path: 'e2e/shot.png' }], { 'e2e/shot.png': { client: C } }, base))
    expect(plan.decisions).toEqual([])
  })

  it('blocks on unruled drift and on special files the manifest does not acknowledge', () => {
    const plan = planRepo(
      input(
        [
          { status: 'M', path: 'src/Footer.tsx' },
          { status: 'M', path: 'package.json' },
          { status: 'M', path: 'package-lock.json' },
          { status: 'M', path: '.gitattributes' },
          { status: 'M', path: 'src/styles/theme.css' },
        ],
        { 'src/Footer.tsx': { client: C } },
        base,
        ['src/styles/theme.css']
      )
    )
    expect(plan.blockers).toHaveLength(5)
    expect(plan.blockers.join('\n')).toMatch(/DRIFT-M src\/Footer\.tsx/)
    expect(plan.blockers.join('\n')).toMatch(/wholesale copy is never allowed/)
  })

  it('theme.css is ONLY ever the additive helper, never a template copy', () => {
    const plan = planRepo(input([{ status: 'M', path: 'src/styles/theme.css' }], {}, { ...base, themeCss: 'additive-helper' }, ['src/styles/theme.css']))
    expect(plan.decisions).toEqual([])
    expect(plan.specials).toContainEqual({ kind: 'theme-css' })
    const none = planRepo(input([{ status: 'M', path: 'src/styles/theme.css' }], {}, { ...base, themeCss: 'none' }, ['src/styles/theme.css']))
    expect(none.specials.map((s) => s.kind)).toEqual(['marker'])
  })

  it('seeds the fonts module only when absent, drops content/.template-default, and always writes the marker LAST', () => {
    const diff: DiffEntry[] = [{ status: 'M', path: 'src/app/fonts.generated.ts' }, { status: 'M', path: 'content/design-overrides.css' }]
    const absent = planRepo(input(diff, {}, base, ['content/.template-default']))
    expect(absent.specials).toEqual([{ kind: 'seed', path: 'src/app/fonts.generated.ts' }, { kind: 'delete-template-default' }, { kind: 'marker' }])
    expect(absent.warnings.join()).toMatch(/content\/design-overrides\.css/)
    const present = planRepo(input(diff, {}, base, ['src/app/fonts.generated.ts']))
    expect(present.specials).toEqual([{ kind: 'marker' }])
  })

  it('package.json edits, .gitignore edits, tracked-dir deletes and lockfile regen come from the manifest', () => {
    const m: ReleaseManifest = {
      ...base,
      packageJson: { removeScripts: ['export-brief'] },
      gitignore: { remove: ['design-kit/'] },
      deleteTracked: ['design-kit'],
      lockfile: 'regenerate',
    }
    const plan = planRepo(input([{ status: 'M', path: 'package-lock.json' }], {}, m, ['.gitignore', 'design-kit', 'package-lock.json']))
    expect(plan.blockers).toEqual([])
    expect(plan.specials.map((s) => s.kind)).toEqual(['package-json', 'lockfile-regenerate', 'gitignore', 'delete-tracked', 'marker'])
  })

  it('expectFiles: an undeclared template change (or one under the wrong status) blocks; a declared-but-unchanged path only warns', () => {
    const warnings: string[] = []
    const blockers = checkDeclaredFiles(
      [
        { status: 'M', path: 'src/Hero.tsx' },
        { status: 'A', path: 'src/lib/hero-cta-site.ts' },
        { status: 'A', path: 'src/lib/accent-color.ts' },
      ],
      { overwrite: ['src/Hero.tsx', 'src/lib/accent-color.ts', 'README.md'], add: [] },
      warnings
    )
    expect(blockers).toEqual([
      'src/lib/hero-cta-site.ts changed in the template (add) but is not in the manifest’s expectFiles — undeclared change'.replace('’', "'"),
      'src/lib/accent-color.ts: the template adds it but the manifest declares it under "overwrite"',
    ])
    expect(warnings).toEqual(['declared but not changed OLD..NEW (client already has them?): README.md'])
    const plan = planRepo(input([{ status: 'A', path: 'src/x.ts' }], { 'src/x.ts': { client: null, old: null } }, { ...base, expectFiles: { add: [] } }))
    expect(plan.blockers.join()).toMatch(/undeclared change/)
  })

  it('actionTextVars "ensure" adds the step when the client has theme.css (themeCss none)', () => {
    const plan = planRepo(input([], {}, { ...base, themeCss: 'none', actionTextVars: 'ensure' }, ['src/styles/theme.css']))
    expect(plan.specials.map((s) => s.kind)).toEqual(['action-text-vars', 'marker'])
  })

  it('warns about unused rulings; expectedPaths covers every write', () => {
    const m: ReleaseManifest = { ...base, rulings: { bblcpa: { 'src/Old.tsx': 'overwrite', 'src/Footer.tsx': 'overwrite' } } }
    const plan = planRepo(input([{ status: 'M', path: 'src/Footer.tsx' }, { status: 'M', path: 'src/Same.tsx' }], { 'src/Footer.tsx': { client: C }, 'src/Same.tsx': { client: N } }, m))
    expect(plan.blockers).toEqual([])
    expect(plan.warnings).toEqual(['ruling for src/Old.tsx is unused (not changed in this release)'])
    expect([...expectedPaths(plan)]).toEqual(['src/Footer.tsx', 'c5-template.json'])
    expect(summarize(plan)).toBe('write=1 behind=0 merge3=0 delete=0 same=1 skip=0 DRIFT=0')
  })
})
