import { describe, it, expect, vi, beforeEach } from 'vitest'
import sharp from 'sharp'
import { RID, SID } from '../__fixtures__/rows'

const m = vi.hoisted(() => ({ render: vi.fn(), store: vi.fn(async (..._a: unknown[]) => {}), siteUrl: vi.fn(), shell: vi.fn() }))
vi.mock('./render-composed', () => ({ renderComposed: (a: unknown) => m.render(a) }))
vi.mock('../storage', async (orig) => ({ ...((await orig()) as object), storeDesignImage: (...a: unknown[]) => m.store(...a) }))
vi.mock('@/lib/theme-preview/site-url', () => ({ getPreviewSiteUrl: (a: unknown) => m.siteUrl(a) }))
vi.mock('@/lib/theme-preview/build-preview-shell', () => ({ buildPreviewShell: (u: string) => m.shell(u) }))

import { loadRenderShell, renderAndStoreFolds, renderErrorMessage } from './render-folds'
import type { ComposedTheme } from '../composed-theme'

const THEME: ComposedTheme = {
  themeCss: '',
  overridesCss: '',
  typography: { headingFont: 'Public Sans', bodyFont: 'Public Sans', accentFont: 'Fraunces', googleFontsUrl: '' },
  htmlAttributes: { 'data-headline': 'sans', 'data-eyebrow': 'standard' },
}
const SHELL = { origin: 'https://acme.vercel.app', shellHtml: '<html><head></head><body></body></html>' }
let png: Buffer

beforeEach(async () => {
  png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#003b71' } }).png().toBuffer()
  m.render.mockReset()
  m.store.mockClear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

const args = (over = {}) => ({ db: {} as never, sessionId: SID, runId: RID, name: 'concept-0', shell: SHELL, theme: THEME, ...over })

describe('renderAndStoreFolds', () => {
  it('renders desktop then mobile, stores ONLY the fold of each as WebP under runs/{runId}/', async () => {
    m.render.mockImplementation(async (a: { viewport: string }) => ({
      shots: a.viewport === 'desktop' ? [{ kind: 'fold', png }, { kind: 'block', selector: 'x', png }] : [{ kind: 'fold', png }, { kind: 'next', png }],
    }))
    const r = await renderAndStoreFolds(args())
    expect(m.render.mock.calls.map((c) => (c[0] as { viewport: string; crops: boolean }).viewport)).toEqual(['desktop', 'mobile'])
    expect((m.render.mock.calls[0][0] as { crops: boolean }).crops).toBe(false)
    expect(r.error).toBeNull()
    expect(r.shots.map((s) => s.viewport)).toEqual(['desktop', 'mobile'])
    for (const s of r.shots) expect(s.path).toMatch(new RegExp(`^design/${SID}/runs/${RID}/concept-0-(desktop|mobile)-[0-9a-f]{8}\\.webp$`))
    expect(m.store).toHaveBeenCalledTimes(2)
    expect(r.desktopWebp?.subarray(8, 12).toString('ascii')).toBe('WEBP')
  })

  it('refuses a non-https shell without rendering', async () => {
    const r = await renderAndStoreFolds(args({ shell: { ...SHELL, origin: 'http://acme.test' } }))
    expect(r).toEqual({ shots: [], desktopWebp: null, error: 'The preview URL must use https to render.' })
    expect(m.render).not.toHaveBeenCalled()
  })

  it('keeps what it has and reports a readable error when a render fails', async () => {
    const timeout = Object.assign(new Error('late'), { name: 'RenderTimeoutError' })
    m.render.mockResolvedValueOnce({ shots: [{ kind: 'fold', png }] }).mockRejectedValueOnce(timeout)
    const r = await renderAndStoreFolds(args())
    expect(r.shots).toHaveLength(1)
    expect(r.error).toBe('The render timed out.')
  })
})

describe('renderErrorMessage', () => {
  it.each([
    [Object.assign(new Error('x'), { name: 'RendererUnavailableError' }), 'The renderer is unavailable right now.'],
    [Object.assign(new Error('x'), { name: 'RenderTimeoutError' }), 'The render timed out.'],
    [new Error('db down'), 'The render failed.'],
  ])('%s', (err, msg) => expect(renderErrorMessage(err)).toBe(msg))
})

describe('loadRenderShell', () => {
  it('explains a missing preview URL', async () => {
    m.siteUrl.mockResolvedValue(null)
    expect(await loadRenderShell({ jobId: 'j', githubRepo: 'o/r' }, '/')).toEqual({ ok: false, reason: 'No preview URL is set for this client.' })
  })
  it('resolves the page on the preview origin and returns the shell', async () => {
    m.siteUrl.mockResolvedValue('https://acme.vercel.app')
    m.shell.mockResolvedValue({ ok: true, ...SHELL })
    const r = await loadRenderShell({ jobId: 'j', githubRepo: 'o/r' }, '/services/tax')
    expect(m.shell).toHaveBeenCalledWith('https://acme.vercel.app/services/tax')
    expect(r).toEqual({ ok: true, shell: SHELL, path: '/services/tax' })
  })
})
