import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { CID, SID, makeConceptRow } from '@/lib/design/__fixtures__/rows'
import { BRAND_TEXT, DESIGN_TEXT } from '@/lib/design/__fixtures__/theme-texts'
import { STYLE_AXIS_ATTRIBUTES } from '@/lib/design/style-axes'

const m = vi.hoisted(() => ({ gate: vi.fn(), getConcept: vi.fn(), snapshot: vi.fn() }))
vi.mock('../../../_design', () => ({ requireDesignAdmin: (id: string) => m.gate(id) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/design/run-store', () => ({ getConcept: (...a: unknown[]) => m.getConcept(...a) }))
// readDraftThemeTexts is rebuilt over the mocked snapshot with the real pure
// themeTextsFromSnapshot (PF9), so a module-internal call can't bypass the mock.
vi.mock('@/lib/design/theme-snapshot', async (orig) => {
  const real = (await orig()) as typeof import('@/lib/design/theme-snapshot')
  return {
    ...real,
    readDraftThemeSnapshot: (r: string) => m.snapshot(r),
    readDraftThemeTexts: async (r: string) => real.themeTextsFromSnapshot(await m.snapshot(r)),
  }
})

import { GET } from './route'

const LEGACY = '[data-block="cta-banner"] h2 { letter-spacing: 0.01em; }'
const call = (query = '', cid = CID) => GET(new Request(`http://x/api${query}`), { params: Promise.resolve({ id: SID, cid }) })

beforeEach(() => {
  vi.clearAllMocks()
  m.gate.mockResolvedValue({ sessionId: SID, githubRepo: 'o/r', user: { isAdmin: true } })
  m.getConcept.mockResolvedValue(makeConceptRow({ status: 'ready' }))
  m.snapshot.mockResolvedValue({
    shas: {},
    texts: { 'content/brand.json': BRAND_TEXT, 'content/design.json': DESIGN_TEXT, 'content/design-overrides.css': LEGACY },
  })
})

describe('GET /design/concepts/[cid]/preview', () => {
  it('passes the gate response through', async () => {
    m.gate.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await call()).status).toBe(403)
  })
  it('400s a bad id or flag, 404s an unknown concept', async () => {
    expect((await call('', 'nope')).status).toBe(400)
    expect((await call('?removeLegacy=maybe')).status).toBe(400)
    m.getConcept.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
  })
  it('returns the composed theme the default apply would write (legacy removed)', async () => {
    const { theme } = await (await call()).json()
    expect(theme.htmlAttributes).toEqual({
      'data-headline': 'serif',
      'data-eyebrow': 'mono',
      // style axes: null = remove the live attr
      ...Object.fromEntries(STYLE_AXIS_ATTRIBUTES.map((a) => [a, null])),
    }) // VALID treatments
    expect(theme.typography.accentFont).toBe('Fraunces')
    expect(theme.themeCss.length).toBeGreaterThan(100)
    expect(theme.overridesCss).toContain('/* design-studio:hero */')
    expect(theme.overridesCss).not.toContain(LEGACY)
  })
  it('409s a draft without brand.json / design.json', async () => {
    m.snapshot.mockResolvedValue({ shas: {}, texts: {} })
    expect((await call()).status).toBe(409)
  })
  it('keeps legacy overrides with removeLegacy=0', async () => {
    const { theme } = await (await call('?removeLegacy=0')).json()
    expect(theme.overridesCss).toContain(LEGACY)
  })
})
