import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  FileNotFoundError: class FileNotFoundError extends Error {},
  StaleShaError: class StaleShaError extends Error {
    constructor(
      public path: string,
      public currentSha: string,
      public currentContent: string
    ) {
      super(`stale ${path}`)
    }
  },
  listTree: vi.fn(async () => [] as Array<{ path: string; sha: string; type: 'blob' }>),
  moveFile: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}))

vi.mock('@/lib/github/repo-files', () => ({
  DRAFT_BRANCH: 'draft',
  FileNotFoundError: h.FileNotFoundError,
  StaleShaError: h.StaleShaError,
  listTree: h.listTree,
  moveFile: h.moveFile,
  readFile: h.readFile,
  writeFile: h.writeFile,
}))

import { appendRedirects, csvField, frontmatterUrl, relocateFile, swapFrontmatterUrl, unquoteYamlScalar } from './relocate'

describe('relocateFile — read-after-write lag', () => {
  it('reads the moved page at the move commit, not the lagging branch', async () => {
    const page = 'url: /a\ntitle: A\n'
    h.moveFile.mockResolvedValueOnce({ commitSha: 'moveCommit' })
    h.readFile.mockImplementation(async (_repo: string, path: string, ref: string) => {
      if (path === 'content/pages/b.md' && ref === 'moveCommit') return { path, content: page, sha: 'blobA' }
      if (path === 'content/redirects.csv') return { path, content: 'old_url,new_url,status_code,reason\n', sha: 'r1' }
      // Destination check before the move, and a lagged branch read after it.
      throw new h.FileNotFoundError(path)
    })
    h.writeFile.mockResolvedValue({ commitSha: 'c', blobSha: 'blobB' })

    const res = await relocateFile(
      { githubRepo: 'repo' },
      { fromPath: 'content/pages/a.md', toPath: 'content/pages/b.md', fromUrl: '/a', toUrl: '/b', expectedSha: 'blobA', reason: 'moved' }
    )

    expect(res).toEqual({ blobSha: 'blobB', moved: true, redirectWarnings: [] })
    expect(h.writeFile.mock.calls[0][5]).toMatchObject({ expectedSha: 'blobA' })
    expect(h.writeFile.mock.calls[1][1]).toBe('content/redirects.csv')
  })
})

describe('appendRedirects — cycle-safe writes', () => {
  const HEADER = 'old_url,new_url,status_code,reason\n'

  function withRedirects(content: string) {
    h.readFile.mockImplementation(async (_repo: string, path: string) => {
      if (path === 'content/redirects.csv') return { path, content, sha: 'r1' }
      throw new h.FileNotFoundError(path)
    })
    h.writeFile.mockReset()
    h.writeFile.mockResolvedValue({ commitSha: 'c', blobSha: 'r2' })
  }

  it('AI relocation back to the old url removes the reverse row (no loop)', async () => {
    withRedirects(`${HEADER}/a,/b,301,Relocated via editor\n`)
    // A lagging tree still lists the source page: it must not block the new row.
    h.listTree.mockResolvedValueOnce([{ path: 'content/pages/b.md', sha: 'x', type: 'blob' }])
    await appendRedirects({ githubRepo: 'repo' }, [{ from: '/b', to: '/a' }], 'Relocated via editor')
    expect(h.writeFile.mock.calls[0][2]).toBe(`${HEADER}/b,/a,301,Relocated via editor\n`)
  })

  it('keeps an existing row over a real page and returns it as a warning (Accord)', async () => {
    withRedirects(`${HEADER}/services/outsourced-accounting,/services,301,old\n`)
    h.listTree.mockResolvedValueOnce([
      { path: 'content/pages/services--outsourced-accounting.md', sha: 'x', type: 'blob' },
    ])
    const res = await appendRedirects({ githubRepo: 'repo' }, [{ from: '/old', to: '/new' }], 'moved')
    expect(h.writeFile.mock.calls[0][2]).toBe(
      `${HEADER}/services/outsourced-accounting,/services,301,old\n/old,/new,301,moved\n`
    )
    expect(res.warnings).toHaveLength(1)
    expect(res.warnings[0]).toMatch(/^\/services\/outsourced-accounting has a real page but redirects to \/services/)
  })

  it('re-applies once onto a concurrent redirects.csv write instead of losing the 301 (EDIT-5)', async () => {
    withRedirects(`${HEADER}/a,/b,301,moved\n`)
    h.writeFile
      .mockReset()
      .mockRejectedValueOnce(new h.StaleShaError('content/redirects.csv', 'r9', `${HEADER}/a,/b,301,moved\n/n,/m,301,other\n`))
      .mockResolvedValueOnce({ commitSha: 'c', blobSha: 'r10' })
    await appendRedirects({ githubRepo: 'repo' }, [{ from: '/x', to: '/y' }], 'moved')
    expect(h.writeFile).toHaveBeenCalledTimes(2)
    expect(h.writeFile.mock.calls[1][2]).toBe(`${HEADER}/a,/b,301,moved\n/n,/m,301,other\n/x,/y,301,moved\n`)
    expect(h.writeFile.mock.calls[1][5]).toMatchObject({ expectedSha: 'r9' })
  })

  it('writes nothing when the row is already there', async () => {
    withRedirects(`${HEADER}/a,/b,301,moved\n`)
    await appendRedirects({ githubRepo: 'repo' }, [{ from: '/a', to: '/b' }], 'moved')
    expect(h.writeFile).not.toHaveBeenCalled()
  })
})

describe('relocateFile — page → post drops the generator trailer', () => {
  const TRAILER =
    '\n---\n## SEO & AIO Metadata\n\n**Answer Block:**\nA.\n\n**Internal Links:**\n- tax → /services/tax — why\n\n---\n## Structured Data — paste into `<head>`\n\n```html\n<script type="application/ld+json">{}</script>\n```\n'
  const page = `---\nurl: "/a"\nanswer_block: "A."\n---\n\n## Body\n\nProse.\n${TRAILER}`

  function arrange(toPath: string) {
    h.moveFile.mockReset().mockResolvedValueOnce({ commitSha: 'moveCommit' })
    h.writeFile.mockReset().mockResolvedValue({ commitSha: 'c', blobSha: 'blobB' })
    h.readFile.mockReset().mockImplementation(async (_repo: string, path: string, ref: string) => {
      if (path === toPath && ref === 'moveCommit') return { path, content: page, sha: 'blobA' }
      if (path === 'content/redirects.csv') return { path, content: 'old_url,new_url,status_code,reason\n', sha: 'r1' }
      throw new h.FileNotFoundError(path)
    })
  }

  it('strips it when the destination is content/posts/', async () => {
    arrange('content/posts/a.md')
    await relocateFile(
      { githubRepo: 'repo' },
      { fromPath: 'content/pages/a.md', toPath: 'content/posts/a.md', fromUrl: '/a', toUrl: '/resources/a', expectedSha: 'blobA', reason: 'moved' }
    )
    const written = h.writeFile.mock.calls[0][2] as string
    // internal_links was absent, so the trailer's links are kept in frontmatter.
    expect(written).toBe(
      '---\nurl: "/resources/a"\nanswer_block: "A."\ninternal_links: [{"url":"/services/tax","anchor_text":"tax","reason":"why"}]\n---\n\n## Body\n\nProse.\n'
    )
  })

  it('returns a warning (and does not cut) when content follows the trailer', async () => {
    arrange('content/posts/a.md')
    const withTail = `${page}\n## Added later\n\nCopy.\n`
    h.readFile.mockImplementation(async (_repo: string, path: string, ref: string) => {
      if (path === 'content/posts/a.md' && ref === 'moveCommit') return { path, content: withTail, sha: 'blobA' }
      if (path === 'content/redirects.csv') return { path, content: 'old_url,new_url,status_code,reason\n', sha: 'r1' }
      throw new h.FileNotFoundError(path)
    })
    const res = await relocateFile(
      { githubRepo: 'repo' },
      { fromPath: 'content/pages/a.md', toPath: 'content/posts/a.md', fromUrl: '/a', toUrl: '/resources/a', expectedSha: 'blobA', reason: 'moved' }
    )
    expect(res.warning).toMatch(/not removed.*## Added later/)
    expect(h.writeFile.mock.calls[0][2]).toContain('## SEO & AIO Metadata')
  })

  it('keeps it on a page → page move (the template trims it and reuses the JSON-LD)', async () => {
    arrange('content/pages/b.md')
    await relocateFile(
      { githubRepo: 'repo' },
      { fromPath: 'content/pages/a.md', toPath: 'content/pages/b.md', fromUrl: '/a', toUrl: '/b', expectedSha: 'blobA', reason: 'moved' }
    )
    expect(h.writeFile.mock.calls[0][2]).toContain('## SEO & AIO Metadata')
  })
})

describe('relocateFile — re-run onto a custom blog path (EDIT-1)', () => {
  it('a post already at the destination with a legacy /resources canonical is a no-op, not a collision', async () => {
    h.moveFile.mockReset()
    h.writeFile.mockReset()
    h.readFile.mockReset().mockImplementation(async (_repo: string, path: string) => {
      if (path === 'content/posts/x.md') return { path, content: '---\ncanonical_url: /resources/x\n---\n\nBody.\n', sha: 'occ' }
      throw new h.FileNotFoundError(path)
    })
    const res = await relocateFile(
      { githubRepo: 'repo' },
      { fromPath: 'content/pages/services--x.md', toPath: 'content/posts/x.md', fromUrl: '/services/x', toUrl: '/insights/x', expectedSha: 'blobA', reason: 'moved' }
    )
    expect(res).toEqual({ blobSha: 'occ', moved: false, redirectWarnings: [] })
    expect(h.moveFile).not.toHaveBeenCalled()
  })
})

describe('relocateFile — post → page on a custom blog path (EDIT-1)', () => {
  it('swaps a /resources/<slug> canonical and redirects from the live blog url', async () => {
    const post = '---\ncanonical_url: /resources/x\n---\n\nBody.\n'
    h.moveFile.mockReset().mockResolvedValueOnce({ commitSha: 'moveCommit' })
    h.writeFile.mockReset().mockResolvedValue({ commitSha: 'c', blobSha: 'blobB' })
    h.readFile.mockReset().mockImplementation(async (_repo: string, path: string, ref: string) => {
      if (path === 'content/pages/services--x.md' && ref === 'moveCommit') return { path, content: post, sha: 'blobA' }
      if (path === 'content/redirects.csv') return { path, content: 'old_url,new_url,status_code,reason\n', sha: 'r1' }
      throw new h.FileNotFoundError(path)
    })
    await relocateFile(
      { githubRepo: 'repo' },
      { fromPath: 'content/posts/x.md', toPath: 'content/pages/services--x.md', fromUrl: '/insights/x', toUrl: '/services/x', expectedSha: 'blobA', reason: 'moved' }
    )
    expect(h.writeFile.mock.calls[0][2]).toBe('---\ncanonical_url: /services/x\n---\n\nBody.\n')
    expect(h.writeFile.mock.calls[1][2]).toBe('old_url,new_url,status_code,reason\n/insights/x,/services/x,301,moved\n')
  })
})

describe('csvField', () => {
  it('quotes commas, quotes and newlines so a url cannot shift or inject rows', () => {
    expect(csvField('/a')).toBe('/a')
    expect(csvField('/a,b')).toBe('"/a,b"')
    expect(csvField('/a"b')).toBe('"/a""b"')
    expect(csvField('/a\n/evil,//x,301')).toBe('"/a\n/evil,//x,301"')
  })
})

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
