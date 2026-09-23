import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/github/repo-files', () => ({
  DRAFT_BRANCH: 'draft',
  FileNotFoundError: class extends Error {},
  moveFile: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}))

import { frontmatterUrl, swapFrontmatterUrl, unquoteYamlScalar } from './relocate'

describe('swapFrontmatterUrl', () => {
  it('rewrites a bare url and canonical_url with host prefix', () => {
    const src = `---\nurl: /services/tax\ncanonical_url: https://acme.com/services/tax\n---\nBody`
    expect(swapFrontmatterUrl(src, '/services/tax', '/services/tax/prep')).toBe(
      `---\nurl: /services/tax/prep\ncanonical_url: https://acme.com/services/tax/prep\n---\nBody`
    )
  })

  it('rewrites double-quoted values (previously never matched)', () => {
    const src = `---\nurl: "/services/tax"\ncanonical_url: "https://acme.com/services/tax"\n---\nBody`
    expect(swapFrontmatterUrl(src, '/services/tax', '/advisory/tax')).toBe(
      `---\nurl: "/advisory/tax"\ncanonical_url: "https://acme.com/advisory/tax"\n---\nBody`
    )
  })

  it('rewrites single-quoted values as JSON-quoted strings', () => {
    const src = `---\nurl: '/a'\n---\nB`
    expect(swapFrontmatterUrl(src, '/a', '/b/a')).toBe(`---\nurl: "/b/a"\n---\nB`)
  })

  it('does not rewrite a different page whose url merely ends with the same suffix', () => {
    const src = `---\nurl: /other/services/tax\n---\nB`
    expect(swapFrontmatterUrl(src, '/services/tax', '/x')).toBe(src)
  })

  it('never touches body lines', () => {
    const src = `---\nurl: /a\n---\nurl: /a\n`
    expect(swapFrontmatterUrl(src, '/a', '/b')).toBe(`---\nurl: /b\n---\nurl: /a\n`)
  })
})

describe('frontmatterUrl / unquoteYamlScalar', () => {
  it('unquotes the url value', () => {
    expect(frontmatterUrl(`---\nurl: "/a/b"\n---\n`)).toBe('/a/b')
    expect(frontmatterUrl(`---\ncanonical_url: 'https://x.com/a'\n---\n`)).toBe('https://x.com/a')
    expect(frontmatterUrl(`---\nurl: /plain\n---\n`)).toBe('/plain')
  })
  it('handles yaml single-quote escapes', () => {
    expect(unquoteYamlScalar(`'it''s'`)).toEqual({ value: "it's", quoted: true })
  })
})
