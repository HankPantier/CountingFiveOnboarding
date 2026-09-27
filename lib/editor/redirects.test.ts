import { describe, expect, it } from 'vitest'
import {
  REDIRECTS_HEADER,
  applyRedirectAdds,
  findRedirectProblems,
  blogPathFromJson,
  liveRedirectWarnings,
  normalizeRedirectSource,
  normalizeRedirectSources,
  pageUrlsFromPaths,
  parseRedirectRows,
  resolveRedirectTarget,
  sanitizeRedirectsCsv,
  validateRedirectsCsv,
} from './redirects'

const H = REDIRECTS_HEADER
const pairs = (text: string) => parseRedirectRows(text).map((r) => `${r.from}>${r.to}`)

describe('applyRedirectAdds', () => {
  it('creates the file with a header when it is absent', () => {
    const { content, changed } = applyRedirectAdds(null, [{ from: '/a', to: '/b' }], 'moved')
    expect(changed).toBe(true)
    expect(content).toBe(`${H}/a,/b,301,moved\n`)
  })

  it('reverse-add: moving a page back removes the old row instead of making a loop (Berg)', () => {
    const start = `${H}/a,/b,301,moved\n`
    const { content } = applyRedirectAdds(start, [{ from: '/b', to: '/a' }], 'moved back')
    expect(pairs(content)).toEqual(['/b>/a'])
    expect(findRedirectProblems(content).cycles).toEqual([])
  })

  it('collapses chains: X→A becomes X→B when A moves to B', () => {
    const start = `${H}/x,/a,301,old\n`
    const { content } = applyRedirectAdds(start, [{ from: '/a', to: '/b' }], 'moved')
    expect(pairs(content)).toEqual(['/x>/b', '/a>/b'])
  })

  it('drops self-redirects, including ones a collapse would create', () => {
    expect(applyRedirectAdds(H, [{ from: '/a', to: '/a/' }], 'noop').changed).toBe(false)
    // /b→/a exists; moving /a→/b collapses nothing into a self row and removes /b's row.
    const { content } = applyRedirectAdds(`${H}/c,/c,301,bad\n`, [{ from: '/a', to: '/b' }], 'm')
    expect(pairs(content)).toEqual(['/a>/b'])
  })

  it('the newest move for a source wins, in place', () => {
    const start = `${H}/a,/b,301,first\n/z,/y,301,other\n`
    const { content } = applyRedirectAdds(start, [{ from: '/a', to: '/c' }], 'second')
    expect(pairs(content)).toEqual(['/a>/c', '/z>/y'])
  })

  it('is a no-op for a duplicate add and keeps comments byte-for-byte', () => {
    const start = `# comment line\n${H}"/a",/b,301,"keep, me"\n`
    const { content, changed } = applyRedirectAdds(start, [{ from: '/a', to: '/b' }], 'x')
    expect(changed).toBe(false)
    expect(content).toBe(start)
  })

  it('real-page protection: a row over a live page is KEPT and reported (Accord)', () => {
    const start = `${H}/services/outsourced-accounting,/services,301,old\n`
    const live = ['/services/outsourced-accounting', '/services']
    const { content, warnings } = applyRedirectAdds(start, [{ from: '/b', to: '/c' }], 'm', { livePaths: live })
    expect(pairs(content)).toEqual(['/services/outsourced-accounting>/services', '/b>/c'])
    expect(warnings).toEqual([{ from: '/services/outsourced-accounting', to: '/services' }])
  })

  it('a batch swap writes no 301 away from either refilled url', () => {
    const { content } = applyRedirectAdds(H, [{ from: '/a', to: '/b' }, { from: '/b', to: '/a' }], 'swap')
    expect(pairs(content)).toEqual([])
  })

  it('breaks a pre-existing loop elsewhere in the file', () => {
    const start = `${H}/p,/q,301,x\n/q,/p,301,x\n`
    const { content } = applyRedirectAdds(start, [{ from: '/a', to: '/b' }], 'm')
    expect(findRedirectProblems(content).cycles).toEqual([])
    expect(pairs(content)).toEqual(['/p>/q', '/a>/b'])
  })

  it('treats host-prefixed and trailing-slash urls as the same path', () => {
    const start = `${H}https://old.example.com/b/,/a,301,old\n`
    const { content } = applyRedirectAdds(start, [{ from: '/a', to: '/b' }], 'm')
    expect(pairs(content)).toEqual(['/a>/b'])
  })
})

describe('findRedirectProblems / validateRedirectsCsv', () => {
  it('detects a two-row cycle', () => {
    const text = `${H}/a,/b,301,x\n/b,/a,301,x\n`
    expect(findRedirectProblems(text).cycles).toEqual([['/a', '/b']])
    expect(validateRedirectsCsv(text)).toMatch(/redirect loop \/a → \/b → \/a/)
  })

  it('detects a longer cycle reached through a chain (Pryor)', () => {
    const text = `${H}/x,/s1,301,x\n/s1,/s2,301,x\n/s2,/s3,301,x\n/s3,/s1,301,x\n`
    expect(findRedirectProblems(text).cycles).toEqual([['/s1', '/s2', '/s3']])
  })

  it('flags self-redirects', () => {
    expect(validateRedirectsCsv(`${H}/a/,/a,301,x\n`)).toMatch(/\/a redirects to itself/)
  })

  it('flags a real page redirected away only when livePaths is given', () => {
    const text = `${H}/services/outsourced-accounting,/services,301,x\n`
    expect(validateRedirectsCsv(text)).toBeNull()
    expect(validateRedirectsCsv(text, { livePaths: ['/services/outsourced-accounting'] })).toMatch(
      /has a real page/
    )
  })

  it('compares case-insensitively, like Next.js redirect matching', () => {
    expect(validateRedirectsCsv(`${H}/About-Us,/about-us,301,x\n`)).toMatch(/redirects to itself/)
    expect(findRedirectProblems(`${H}/a,/B,301,x\n/b,/A,301,x\n`).cycles).toEqual([['/a', '/b']])
    expect(validateRedirectsCsv(`${H}/About,/team,301,x\n`, { livePaths: ['/about'] })).toMatch(/has a real page/)
  })

  it('ignores ?query and #hash for loop detection, absolute or root-relative', () => {
    expect(findRedirectProblems(`${H}/a,/b?x=1,301,x\n/b,/a,301,x\n`).cycles).toEqual([['/a', '/b']])
    expect(findRedirectProblems(`${H}/a,/b#top,301,x\n/b/,/a,301,x\n`).cycles).toEqual([['/a', '/b']])
    expect(validateRedirectsCsv(`${H}/a?utm=1,/a,301,x\n`)).toMatch(/redirects to itself/)
  })

  it('an absolute source is not a pattern: it is still checked against live pages', () => {
    const text = `${H}https://old.example.com/about,/team,301,x\n`
    expect(findRedirectProblems(text, { livePaths: ['/about'] }).shadowedPages).toEqual(['/about'])
    expect(liveRedirectWarnings(text, { livePaths: ['/about'] })).toEqual([
      { from: 'https://old.example.com/about', to: '/team' },
    ])
  })

  it('never checks a pattern source (:param, *) against live pages', () => {
    const text = `${H}/blog/:slug,/insights/:slug,301,x\n/old/*,/,301,x\n`
    expect(validateRedirectsCsv(text, { livePaths: ['/blog/:slug', '/old/*'] })).toBeNull()
  })

  it('rejects sources next build refuses: no leading /, or a ?query / #hash', () => {
    expect(validateRedirectsCsv(`${H}https://old.example.com/about,/about-us,301,x\n`)).toMatch(
      /https:\/\/old\.example\.com\/about must be a path starting with \//
    )
    expect(validateRedirectsCsv(`${H}about,/about-us,301,x\n`)).toMatch(/must be a path starting with \//)
    expect(validateRedirectsCsv(`${H}/?page_id=12,/about-us,301,x\n`)).toMatch(/has a \?query or #hash/)
    expect(validateRedirectsCsv(`${H}/team#jane,/about-us,301,x\n`)).toMatch(/has a \?query or #hash/)
    // A query string on the DESTINATION is fine.
    expect(validateRedirectsCsv(`${H}/old,/contact?from=old,301,x\n`)).toBeNull()
  })

  it('passes a clean chain-free file', () => {
    expect(validateRedirectsCsv(`${H}/a,/b,301,x\n/c,/b,301,x\n`)).toBeNull()
  })
})

describe('sanitizeRedirectsCsv', () => {
  it('breaks loops by dropping the newest row and leaves clean files untouched', () => {
    const loop = `# c\n${H}/a,/b,301,x\n/b,/a,301,y\n`
    expect(sanitizeRedirectsCsv(loop)).toBe(`# c\n${H}/a,/b,301,x\n`)
    const clean = `# c\n${H}/a,/b,301,x\n`
    expect(sanitizeRedirectsCsv(clean)).toBe(clean)
  })

  it('keeps rows over live pages (reported by liveRedirectWarnings, never removed)', () => {
    const text = `${H}/a,/b,301,x\n`
    expect(sanitizeRedirectsCsv(text)).toBe(text)
    expect(liveRedirectWarnings(text, { livePaths: ['/a'] })).toEqual([{ from: '/a', to: '/b' }])
  })
})

describe('helpers', () => {
  it('maps content paths to live urls, excluding drafts', () => {
    expect([
      ...pageUrlsFromPaths([
        'content/pages/home.md',
        'content/pages/services--tax.md',
        'content/drafts/pages/x.md',
        'content/posts/p.md',
        'content/nav.json',
      ]),
    ]).toEqual(['/', '/services/tax', '/resources/p'])
  })

  it("puts posts under the site's blog path (content/blog.json), default /resources", () => {
    expect(blogPathFromJson(null)).toBe('/resources')
    expect(blogPathFromJson('{"path": "/insights", "label": "Insights"}')).toBe('/insights')
    expect(blogPathFromJson('not json')).toBe('/resources')
    expect([...pageUrlsFromPaths(['content/posts/tax-tips.md', 'content/pages/resources.md'], '/insights')]).toEqual([
      '/insights/tax-tips',
      '/resources',
    ])
    // korbey: the old /resources/<slug> url is NOT a live post there.
    const row = `${H}/resources/tax-tips,/insights/tax-tips,301,moved\n`
    const live = pageUrlsFromPaths(['content/posts/tax-tips.md'], '/insights')
    expect(validateRedirectsCsv(row, { livePaths: live })).toBeNull()
  })

  it('resolves a destination to the end of its chain', () => {
    expect(resolveRedirectTarget(`${H}/a,/b,301,x\n/b,/c,301,x\n`, '/a')).toBe('/c')
    expect(resolveRedirectTarget(`${H}/a,/b,301,x\n/b,/a,301,x\n`, '/a')).toBe('/a')
  })
})

describe('trailing-slash sources (PIPE-1)', () => {
  it('normalizeRedirectSource strips the slash but keeps / and absolute urls', () => {
    expect(normalizeRedirectSource('/services/tax/')).toBe('/services/tax')
    expect(normalizeRedirectSource('/a//')).toBe('/a')
    expect(normalizeRedirectSource('/')).toBe('/')
    expect(normalizeRedirectSource('/a')).toBe('/a')
    expect(normalizeRedirectSource('https://x.com/a/')).toBe('https://x.com/a/')
  })

  it('sanitizeRedirectsCsv rewrites only the rows with a trailing-slash source', () => {
    const text = `${H}# note\n/meet-our-team/,/about/our-team,301,x\n/b,/c/,301,y\n`
    expect(sanitizeRedirectsCsv(text)).toBe(`${H}# note\n/meet-our-team,/about/our-team,301,x\n/b,/c/,301,y\n`)
  })

  it('applyRedirectAdds normalizes new and existing sources', () => {
    const { content } = applyRedirectAdds(`${H}/old/,/x,301,r\n`, [{ from: '/a/', to: '/b' }], 'moved')
    expect(pairs(content)).toEqual(['/old>/x', '/a>/b'])
  })

  it('normalizeRedirectSources is idempotent and leaves loops alone', () => {
    const text = `${H}/a/,/b,301,x\n/b,/a,301,x\n`
    const once = normalizeRedirectSources(text)
    expect(once).toBe(`${H}/a,/b,301,x\n/b,/a,301,x\n`)
    expect(normalizeRedirectSources(once)).toBe(once)
  })
})

describe('rows the template skips (EDIT-2) and inert duplicates (EDIT-3)', () => {
  it('an absolute destination is not an edge, so the live loop behind it is found', () => {
    const text = `${H}/a,https://old.com/b,301,x\n/a,/c,301,x\n/c,/a,301,x\n`
    expect(findRedirectProblems(text).cycles).toEqual([['/a', '/c']])
    expect(validateRedirectsCsv(text)).toMatch(/\/a → https:\/\/old\.com\/b is ignored by the site/)
  })

  it('never drops a valid row to break a loop that only exists through a skipped row', () => {
    const text = `${H}/a,https://old.com/b,301,x\n/b,/a,301,x\n`
    expect(findRedirectProblems(text).cycles).toEqual([])
    expect(sanitizeRedirectsCsv(text)).toBe(text)
  })

  it('breaks a loop on its active row, keeping a later inert duplicate', () => {
    // /b's first row loops; its second row is inert today and must survive.
    const out = sanitizeRedirectsCsv(`${H}/a,/b,301,x\n/b,/a,301,x\n/b,/z,301,x\n`)
    expect(pairs(out)).toEqual(['/a>/b', '/b>/z'])
  })
})
