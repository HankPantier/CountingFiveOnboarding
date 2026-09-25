import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SID, makeRunRow } from './__fixtures__/rows'
import { BRAND_TEXT, DESIGN_TEXT, THEME_CSS_TEXT } from './__fixtures__/theme-texts'

const m = vi.hoisted(() => ({ texts: vi.fn(), shell: vi.fn(), schema: vi.fn(), optional: vi.fn() }))
vi.mock('./theme-snapshot', () => ({ readDraftThemeTexts: (r: string) => m.texts(r) }))
vi.mock('./render/render-folds', () => ({ loadRenderShell: (...a: unknown[]) => m.shell(...a) }))
vi.mock('./store', () => ({ readSessionSchema: (...a: unknown[]) => m.schema(...a) }))
vi.mock('./apply-bundle', () => ({ readOptional: (...a: unknown[]) => m.optional(...a) }))

import { firmNameFrom, gatherBriefBasics, paletteFreedomOf } from './run-gather'

const TARGET = { sessionId: SID, jobId: 'job-1', githubRepo: 'o/r' }
const FILES = { brandText: BRAND_TEXT, designText: DESIGN_TEXT, themeCss: THEME_CSS_TEXT, overridesCss: '' }

beforeEach(() => {
  m.texts.mockReset().mockResolvedValue({ ok: true, files: FILES })
  m.shell.mockReset().mockResolvedValue({ ok: true, shell: { origin: 'https://a.vercel.app', shellHtml: '<section data-block="hero"><h1>Hi</h1></section>' }, path: '/' })
  m.schema.mockReset().mockResolvedValue({ brand: { currentTone: 'Warm' } })
  m.optional.mockReset().mockResolvedValue({ content: '## Overview', sha: 'x' })
})

describe('gatherBriefBasics', () => {
  it('reads the theme, the current design, the page markup, the MBP and design.md', async () => {
    const r = await gatherBriefBasics({} as never, TARGET, makeRunRow(), '/', { markup: true })
    if (!r.ok) throw new Error(r.error)
    expect(r.basics.current.palette.primary).toMatch(/^#/)
    expect(r.basics.blockSamples).toContain('data-block="hero"')
    expect(r.basics.shell?.origin).toBe('https://a.vercel.app')
    expect(r.basics.designMd).toBe('## Overview')
    expect(r.basics.caps.level).toBe(1)
    expect(r.basics.paletteFreedom).toBe('evolve')
    expect(r.basics.notes).toEqual([])
  })
  it('skips the page shell when markup is not needed (critique)', async () => {
    const r = await gatherBriefBasics({} as never, TARGET, makeRunRow(), '/', { markup: false })
    expect(m.shell).not.toHaveBeenCalled()
    expect(r.ok && r.basics.shell).toBeNull()
  })
  it('notes an unloadable page but carries on', async () => {
    m.shell.mockResolvedValue({ ok: false, reason: 'No preview URL is set for this client.' })
    const r = await gatherBriefBasics({} as never, TARGET, makeRunRow(), '/about', { markup: true })
    expect(r.ok && r.basics.notes).toEqual(['Page /about could not be loaded (No preview URL is set for this client.) — concepts were generated without its markup.'])
  })
  it('fails with the theme reader’s own message when brand/design are missing', async () => {
    m.texts.mockResolvedValue({ ok: false, error: 'This site has no brand.json / design.json yet.' })
    expect(await gatherBriefBasics({} as never, TARGET, makeRunRow(), '/', { markup: true })).toEqual({ ok: false, error: 'This site has no brand.json / design.json yet.' })
  })
})

describe('helpers', () => {
  it('firmNameFrom falls back to "the firm"', () => {
    expect(firmNameFrom(JSON.stringify({ firm: { name: ' Acme CPA ' } }))).toBe('Acme CPA')
    expect(firmNameFrom('not json')).toBe('the firm')
  })
  it('paletteFreedomOf defaults to evolve', () => {
    expect(paletteFreedomOf({ palette_freedom: 'free' })).toBe('free')
    expect(paletteFreedomOf({ palette_freedom: 'nonsense' })).toBe('evolve')
  })
})
