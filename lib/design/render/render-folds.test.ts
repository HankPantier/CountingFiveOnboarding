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
  it('renders desktop then mobile, stores ONLY the fold of each as WebP under a deterministic name (upsert)', async () => {
    m.render.mockImplementation(async (a: { viewport: string }) => ({
      shots: a.viewport === 'desktop' ? [{ kind: 'fold', png }, { kind: 'block', selector: 'x', png }] : [{ kind: 'fold', png }, { kind: 'next', png }],
      sample: null,
    }))
    const r = await renderAndStoreFolds(args({ name: 'concept-0-r1' }))
    expect(m.render.mock.calls.map((c) => (c[0] as { viewport: string; crops: boolean }).viewport)).toEqual(['desktop', 'mobile'])
    expect((m.render.mock.calls[0][0] as { crops: boolean }).crops).toBe(false)
    expect(r.error).toBeNull()
    expect(r.shots.map((s) => s.path)).toEqual([`design/${SID}/runs/${RID}/concept-0-r1-desktop.webp`, `design/${SID}/runs/${RID}/concept-0-r1-mobile.webp`])
    expect(m.store.mock.calls.map((c) => c[3])).toEqual([{ upsert: true }, { upsert: true }])
    expect(r.metrics).toBeNull()
    expect(r.desktopWebp?.subarray(8, 12).toString('ascii')).toBe('WEBP')
  })

  it('asks for metrics only when requested and evaluates each viewport’s sample', async () => {
    const sample = { viewportWidth: 390, scrollWidth: 430, docHeight: 2000, offenders: [], text: [], blocks: [] }
    m.render.mockImplementation(async (a: { viewport: string }) => ({ shots: [{ kind: 'fold', png }], sample: a.viewport === 'mobile' ? sample : null }))
    const r = await renderAndStoreFolds(args({ metrics: true }))
    expect(m.render.mock.calls.map((c) => (c[0] as { metrics?: boolean }).metrics)).toEqual([true, true])
    expect(r.metrics?.viewports.map((v) => v.viewport)).toEqual(['mobile'])
    expect(r.metrics?.viewports[0].overflow?.scrollWidth).toBe(430)
  })

  it('keeps the metrics it has when a later viewport fails', async () => {
    const sample = { viewportWidth: 1440, scrollWidth: 1440, docHeight: 2000, offenders: [], text: [], blocks: [] }
    m.render.mockResolvedValueOnce({ shots: [{ kind: 'fold', png }], sample }).mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'RenderTimeoutError' }))
    const r = await renderAndStoreFolds(args({ metrics: true }))
    expect(r.error).toBe('The render timed out.')
    expect(r.metrics?.viewports.map((v) => v.viewport)).toEqual(['desktop'])
  })

  it('refuses a non-https shell without rendering', async () => {
    const r = await renderAndStoreFolds(args({ shell: { ...SHELL, origin: 'http://acme.test' } }))
    expect(r).toEqual({ shots: [], desktopWebp: null, metrics: null, error: 'The preview URL must use https to render.' })
    expect(m.render).not.toHaveBeenCalled()
  })

  it('keeps what it has and reports a readable error when a render fails', async () => {
    const timeout = Object.assign(new Error('late'), { name: 'RenderTimeoutError' })
    m.render.mockResolvedValueOnce({ shots: [{ kind: 'fold', png }], sample: null }).mockRejectedValueOnce(timeout)
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
