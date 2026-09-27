import { describe, expect, it } from 'vitest'
import { checkImportClosure, extractImportSpecifiers, importCandidates } from './imports'

describe('extractImportSpecifiers', () => {
  it('finds static, side-effect, re-export, dynamic and require specifiers; ignores comments', () => {
    const src = `import Hero from '@/components/blocks/Hero'
import type { X } from "./types"
import './side.css'
export { a } from '../lib/a'
export * from './all'
const m = await import('./lazy')
const r = require('./cjs')
// import nope from './commented'
/* import nope2 from './block' */
const url = 'https://example.com/x'
import {
  ACTION_DISPLAY_COLOR,
} from '@/lib/theme/accent-color'`
    expect(extractImportSpecifiers(src).sort()).toEqual(
      ['../lib/a', './all', './cjs', './lazy', './side.css', './types', '@/components/blocks/Hero', '@/lib/theme/accent-color'].sort()
    )
  })
})

describe('extractImportSpecifiers — CSS @import quoted in code', () => {
  it('ignores a CSS @import string inside a test, and member calls named import/require', () => {
    const src = [
      "import { readFileSync } from 'node:fs'",
      "expect(i('@import \"../styles/logo-tone.css\";')).toBeGreaterThan(i('@import \"../styles/style-axes.css\";'))",
      "loader.import('./not-a-module')",
      "ctx.require('./nope')",
    ].join('\n')
    expect(extractImportSpecifiers(src)).toEqual(['node:fs'])
  })
})

describe('importCandidates', () => {
  it('resolves relative and @/ (→ src/) specifiers; packages are external', () => {
    expect(importCandidates('src/components/blocks/Hero.tsx', './Icon')).toContain('src/components/blocks/Icon.tsx')
    expect(importCandidates('src/components/blocks/Hero.tsx', '@/lib/nav/hero-cta-site')).toContain('src/lib/nav/hero-cta-site.ts')
    expect(importCandidates('src/a/b.ts', '../c')).toContain('src/c/index.ts')
    expect(importCandidates('src/a.ts', 'react')).toBe('external')
  })
})

describe('checkImportClosure', () => {
  const written = new Map([
    ['src/components/blocks/Hero.tsx', `import { ACTION_DISPLAY_COLOR } from '@/lib/theme/accent-color'\nimport { getHeroCtaSite } from '@/lib/nav/hero-cta-site'\nimport Icon from './Icon'\nimport x from 'react'`],
    ['src/lib/theme/accent-color.ts', 'export const ACTION_DISPLAY_COLOR = 1'],
  ])
  const template = new Set(['src/lib/theme/accent-color.ts', 'src/lib/nav/hero-cta-site.ts', 'src/components/blocks/Icon.tsx'])

  it('flags a helper the new code imports that the release does not ship', () => {
    const client = new Set(['src/components/blocks/Icon.tsx'])
    const problems = checkImportClosure({
      written,
      postSyncHas: (p) => written.has(p) || client.has(p),
      templateHas: (p) => template.has(p),
      staleOnClient: () => false,
    })
    expect(problems).toEqual([
      { file: 'src/components/blocks/Hero.tsx', spec: '@/lib/nav/hero-cta-site', reason: expect.stringMatching(/imports src\/lib\/nav\/hero-cta-site\.ts, which the client won't have/) },
    ])
  })

  it('flags an import of a file that changed in the release but is skipped for this client', () => {
    const client = new Set(['src/components/blocks/Icon.tsx', 'src/lib/nav/hero-cta-site.ts'])
    const problems = checkImportClosure({
      written,
      postSyncHas: (p) => written.has(p) || client.has(p),
      templateHas: (p) => template.has(p),
      staleOnClient: (p) => p === 'src/components/blocks/Icon.tsx',
    })
    expect(problems.map((p) => p.spec)).toEqual(['./Icon'])
  })

  it('passes when everything resolves', () => {
    const client = new Set(['src/components/blocks/Icon.tsx', 'src/lib/nav/hero-cta-site.ts'])
    expect(
      checkImportClosure({ written, postSyncHas: (p) => written.has(p) || client.has(p), templateHas: () => true, staleOnClient: () => false })
    ).toEqual([])
  })
})
