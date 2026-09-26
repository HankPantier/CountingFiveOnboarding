import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import nextConfig from '@/next.config'
import { staticImportGraph, staticSpecifiers } from './static-import-graph'

const includes = nextConfig.outputFileTracingIncludes ?? {}
const LIGHTNING = ['./node_modules/lightningcss/**', './node_modules/lightningcss-linux-x64-gnu/**', './node_modules/detect-libc/**']
const CHROMIUM = ['./node_modules/@sparticuz/chromium/bin/**', './node_modules/playwright-core/**']

describe('Vercel packaging (R7)', () => {
  it.each([
    ['/api/edit/\\[id\\]/design', LIGHTNING],
    ['/api/edit/\\[id\\]/design/runs/\\[runId\\]/step', [...LIGHTNING, ...CHROMIUM]],
    ['/api/edit/\\[id\\]/design/concepts/\\[cid\\]/apply', LIGHTNING],
    ['/api/edit/\\[id\\]/design/concepts/\\[cid\\]/preview', LIGHTNING],
    ['/api/edit/\\[id\\]/design/versions/\\[vid\\]/restore', LIGHTNING],
    ['/api/edit/\\[id\\]/design/versions/import', LIGHTNING],
    ['/api/edit/\\[id\\]/design/render', CHROMIUM],
    ['/api/edit/\\[id\\]/design/chat', [...LIGHTNING, ...CHROMIUM]],
  ])('%s traces its native dependencies', (route, globs) => {
    expect(includes[route]).toEqual(expect.arrayContaining(globs))
  })

  const HEAVY = /^import[^\n]*from '@\/lib\/design\/(css-sanitizer|bundle-files|apply-bundle|commit-version|chat-workspace|chat-preview|chat-tools|chat-commit|chat-turn|concept-validate|concept-generator|run-orchestrator|model-call|critic|concept-reviser|run-gather|refine-stage|render\/render-composed|render\/render-folds)'/m
  it.each([
    'app/api/edit/[id]/design/runs/route.ts',
    'app/api/edit/[id]/design/runs/[runId]/cancel/route.ts',
    'app/api/edit/[id]/design/runs/[runId]/step/route.ts',
    'app/api/edit/[id]/design/concepts/[cid]/apply/route.ts',
    'app/api/edit/[id]/design/concepts/[cid]/preview/route.ts',
    'app/api/edit/[id]/design/versions/[vid]/restore/route.ts',
    'app/api/edit/[id]/design/versions/import/route.ts',
    'app/api/edit/[id]/design/attachments/route.ts',
    'app/api/edit/[id]/design/attachments/[attachmentId]/route.ts',
    'app/api/edit/[id]/design/chat/route.ts',
  ])('%s never statically imports a native-backed module', (file) => {
    const src = readFileSync(path.join(process.cwd(), file), 'utf-8')
    expect(src).not.toMatch(HEAVY)
    expect(src).toMatch(/export const maxDuration = \d+/)
    expect(src).toContain("export const runtime = 'nodejs'")
  })

  // design/route.ts (GET state) has no maxDuration, so it can't join the
  // it.each above — but it lazily imports bundle-files (Task 7), so it needs
  // the same "no static heavy import" + runtime guarantee.
  it('app/api/edit/[id]/design/route.ts never statically imports a native-backed module', () => {
    const src = readFileSync(path.join(process.cwd(), 'app/api/edit/[id]/design/route.ts'), 'utf-8')
    expect(src).not.toMatch(HEAVY)
    expect(src).toContain("export const runtime = 'nodejs'")
  })

  it('concept apply reaches the commit path only by lazy import', () => {
    const src = readFileSync(path.join(process.cwd(), 'app/api/edit/[id]/design/concepts/[cid]/apply/route.ts'), 'utf-8')
    expect(src).toContain("await import('@/lib/design/commit-version')")
  })

  it('the chat turn is reached only through the chat route’s lazy import', () => {
    const src = readFileSync(path.join(process.cwd(), 'app/api/edit/[id]/design/chat/route.ts'), 'utf-8')
    expect(src).toContain("await import('@/lib/design/chat-turn')")
    expect(src).toContain('export const maxDuration = 600')
  })

  it('the critique loop is reached only through the step route’s lazy orchestrator import', () => {
    const src = readFileSync(path.join(process.cwd(), 'app/api/edit/[id]/design/runs/[runId]/step/route.ts'), 'utf-8')
    expect(src).toContain("await import('@/lib/design/run-orchestrator')")
    expect(includes['/api/edit/\\[id\\]/design/runs/\\[runId\\]/step']).toEqual(expect.arrayContaining([...LIGHTNING, ...CHROMIUM]))
  })

  // The regex checks above only see a route's OWN imports. Walk the whole
  // static graph: a light module that later starts importing a native-backed
  // one must fail here, not at deploy time.
  const NATIVE = ['lightningcss', 'playwright-core', '@sparticuz/chromium']
  const designRoutes = (readdirSync(path.join(process.cwd(), 'app/api/edit/[id]/design'), { recursive: true }) as string[])
    .filter((f) => f.endsWith('route.ts'))
    .map((f) => path.join('app/api/edit/[id]/design', f))
  it('finds the design routes', () => {
    expect(designRoutes.length).toBeGreaterThanOrEqual(15)
  })
  it.each([...designRoutes, 'app/api/cron/sweep-stuck-jobs/route.ts', 'app/api/edit/[id]/theme/route.ts', 'app/api/edit/[id]/theme/shell/route.ts'])(
    '%s reaches no native-backed package through its STATIC import graph',
    (file) => {
      const { packages } = staticImportGraph(process.cwd(), file)
      expect([...packages].filter((p) => NATIVE.some((n) => p === n || p.startsWith(`${n}/`)))).toEqual([])
    }
  )
  it('the graph walker follows chains and skips type-only and dynamic imports', () => {
    expect(staticSpecifiers("import type { A } from 'x'\nimport { type B } from 'y'\nimport { c, type D } from 'z'\nexport * from './w'\nimport 'side'\nconst q = await import('lazy')")).toEqual([
      'z',
      './w',
      'side',
    ])
    // The sanitizer itself DOES reach lightningcss, so the walker can see it.
    expect([...staticImportGraph(process.cwd(), 'lib/design/commit-version.ts').packages]).toContain('lightningcss')
  })
})
