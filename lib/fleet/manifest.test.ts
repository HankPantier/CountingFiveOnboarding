import { describe, it, expect } from 'vitest'
import { isManaged, isFlagged, selectManagedPaths } from './manifest'
import type { Manifest, TreeEntryLike } from './types'

const manifest: Manifest = {
  include: ['src/', 'content/', 'next.config.ts'],
  exclude: ['src/styles/theme.css', 'content/'],
  flagIfChanged: ['package.json'],
}

describe('isManaged', () => {
  it('matches a path under an include prefix', () => {
    expect(isManaged('src/components/blocks/Hero.tsx', manifest)).toBe(true)
  })

  it('lets exclude win over a broad include (exact file)', () => {
    expect(isManaged('src/styles/theme.css', manifest)).toBe(false)
    // a sibling not exactly excluded is still managed
    expect(isManaged('src/styles/other.css', manifest)).toBe(true)
  })

  it('lets exclude win over a broad include (prefix)', () => {
    expect(isManaged('content/pages/home.md', manifest)).toBe(false)
  })

  it('treats a non-slash include as an exact match, not a prefix', () => {
    expect(isManaged('next.config.ts', manifest)).toBe(true)
    expect(isManaged('next.config.tsx', manifest)).toBe(false)
  })

  it('rejects a path outside every include', () => {
    expect(isManaged('public/logo.svg', manifest)).toBe(false)
    expect(isManaged('site.config.ts', manifest)).toBe(false)
  })
})

describe('isFlagged', () => {
  it('flags configured paths only', () => {
    expect(isFlagged('package.json', manifest)).toBe(true)
    expect(isFlagged('package-lock.json', manifest)).toBe(false)
  })
})

describe('selectManagedPaths', () => {
  it('returns sorted managed blobs, dropping trees and excluded/foreign paths', () => {
    const tree: TreeEntryLike[] = [
      { path: 'src/components', type: 'tree', sha: 't1' },
      { path: 'src/components/blocks/Hero.tsx', type: 'blob', sha: 'b1' },
      { path: 'src/styles/theme.css', type: 'blob', sha: 'b2' },
      { path: 'content/pages/home.md', type: 'blob', sha: 'b3' },
      { path: 'next.config.ts', type: 'blob', sha: 'b4' },
      { path: 'public/logo.svg', type: 'blob', sha: 'b5' },
    ]
    expect(selectManagedPaths(tree, manifest)).toEqual([
      'next.config.ts',
      'src/components/blocks/Hero.tsx',
    ])
  })
})
