import { describe, it, expect, vi } from 'vitest'

const files: Record<string, string> = {
  'content/brand.json': JSON.stringify({ palette: { primary: '#003B71' } }),
  'content/design.json': JSON.stringify({ typography: {}, style: { cards: 'flat', nav: 'bogus', footer: 'default' } }),
}
vi.mock('@/lib/github/repo-files', () => {
  class FileNotFoundError extends Error {}
  return {
    DRAFT_BRANCH: 'draft',
    FileNotFoundError,
    ensureDraftBranch: async () => undefined,
    readFile: async (_r: string, path: string) => {
      if (!(path in files)) throw new FileNotFoundError(path)
      return { content: files[path], sha: 's' }
    },
  }
})

import { loadDraftThemeSources } from './theme-sources'

describe('loadDraftThemeSources', () => {
  it('carries the normalized draft style axes (unknown values and defaults dropped)', async () => {
    const r = await loadDraftThemeSources('o/r')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sources.style).toEqual({ cards: 'flat' })
  })
})
