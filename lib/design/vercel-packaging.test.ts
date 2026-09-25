import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import nextConfig from '@/next.config'

const includes = nextConfig.outputFileTracingIncludes ?? {}
const LIGHTNING = ['./node_modules/lightningcss/**', './node_modules/lightningcss-linux-x64-gnu/**', './node_modules/detect-libc/**']
const CHROMIUM = ['./node_modules/@sparticuz/chromium/bin/**', './node_modules/playwright-core/**']

describe('Vercel packaging (R7)', () => {
  it.each([
    ['/api/edit/\\[id\\]/design', LIGHTNING],
    ['/api/edit/\\[id\\]/design/runs/\\[runId\\]/step', [...LIGHTNING, ...CHROMIUM]],
    ['/api/edit/\\[id\\]/design/concepts/\\[cid\\]/apply', LIGHTNING],
    ['/api/edit/\\[id\\]/design/concepts/\\[cid\\]/preview', LIGHTNING],
    ['/api/edit/\\[id\\]/design/render', CHROMIUM],
    ['/api/edit/\\[id\\]/theme/chat', LIGHTNING],
  ])('%s traces its native dependencies', (route, globs) => {
    expect(includes[route]).toEqual(expect.arrayContaining(globs))
  })

  const HEAVY = /^import[^\n]*from '@\/lib\/design\/(css-sanitizer|bundle-files|apply-bundle|concept-validate|concept-generator|run-orchestrator|model-call|critic|concept-reviser|run-gather|refine-stage|render\/render-composed|render\/render-folds)'/m
  it.each([
    'app/api/edit/[id]/design/runs/route.ts',
    'app/api/edit/[id]/design/runs/[runId]/cancel/route.ts',
    'app/api/edit/[id]/design/runs/[runId]/step/route.ts',
    'app/api/edit/[id]/design/concepts/[cid]/apply/route.ts',
    'app/api/edit/[id]/design/concepts/[cid]/preview/route.ts',
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

  it('the critique loop is reached only through the step route’s lazy orchestrator import', () => {
    const src = readFileSync(path.join(process.cwd(), 'app/api/edit/[id]/design/runs/[runId]/step/route.ts'), 'utf-8')
    expect(src).toContain("await import('@/lib/design/run-orchestrator')")
    expect(includes['/api/edit/\\[id\\]/design/runs/\\[runId\\]/step']).toEqual(expect.arrayContaining([...LIGHTNING, ...CHROMIUM]))
  })
})
