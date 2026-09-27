import { describe, expect, it } from 'vitest'
import {
  REDIRECTS_HEADER,
  applyRedirectAdds,
  findRedirectProblems,
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

  it('real-page protection: never redirects a path that has a page (Accord)', () => {
    const start = `${H}/services/outsourced-accounting,/services,301,old\n`
    const live = ['/services/outsourced-accounting', '/services', '/b']
    const { content } = applyRedirectAdds(start, [{ from: '/b', to: '/c' }], 'm', { livePaths: live })
    expect(pairs(content)).toEqual([])
  })

  it('a batch swap keeps both pages live (no rows over real pages)', () => {
    const { content } = applyRedirectAdds(
      H,
      [{ from: '/a', to: '/b' }, { from: '/b', to: '/a' }],
      'swap',
      { livePaths: ['/a', '/b'] }
    )
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

  it('drops rows that shadow live pages', () => {
    expect(sanitizeRedirectsCsv(`${H}/a,/b,301,x\n`, { livePaths: ['/a'] })).toBe(H)
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

  it('resolves a destination to the end of its chain', () => {
    expect(resolveRedirectTarget(`${H}/a,/b,301,x\n/b,/c,301,x\n`, '/a')).toBe('/c')
    expect(resolveRedirectTarget(`${H}/a,/b,301,x\n/b,/a,301,x\n`, '/a')).toBe('/a')
  })
})
