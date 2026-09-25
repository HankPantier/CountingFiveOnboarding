import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SID } from './__fixtures__/rows'
import type { ComposedTheme } from './composed-theme'
import { MALFORMED_REGION_ERROR } from './bundle-files'

const m = vi.hoisted(() => ({ shell: vi.fn(), render: vi.fn(), sign: vi.fn() }))
vi.mock('./render/render-folds', () => ({
  loadRenderShell: (...a: unknown[]) => m.shell(...a),
  renderFoldsTo: (a: unknown) => m.render(a),
}))
vi.mock('./storage', async (orig) => ({ ...((await orig()) as object), signDesignPaths: (...a: unknown[]) => m.sign(...a) }))

import {
  CHAT_COMMIT_RESERVE_MS,
  CHAT_PREVIEW_NO_TIME_ERROR,
  __resetChatBaselineCacheForTests,
  baselineCacheKey,
  chatPreviewRenderMs,
  chatPreviewTheme,
  isChatBaselineCached,
  renderChatPreview,
} from './chat-preview'

const THEME: ComposedTheme = { themeCss: 'a', overridesCss: '', typography: { headingFont: 'Public Sans', bodyFont: 'Public Sans', accentFont: 'Fraunces', googleFontsUrl: '' }, htmlAttributes: {} }
const BASE_THEME: ComposedTheme = { ...THEME, themeCss: 'base' }
const SHAS = { 'content/brand.json': 'a'.repeat(40) }
const METRICS = { v: 1, viewports: [{ viewport: 'desktop' }, { viewport: 'mobile' }] }
const TURN = '8d9e0f1a-2b3c-4d5e-8f6a-7b8c9d0e1f2a'
const args = (over = {}) => ({ db: {} as never, target: { sessionId: SID, jobId: 'job-1', githubRepo: 'o/r' }, turnId: TURN, previewNo: 1, page: '/', theme: THEME, baselineTheme: BASE_THEME, baselineShas: SHAS, ...over })
const SHOT = { viewport: 'desktop', path: `design/${SID}/renders/chat/${TURN}-p1-desktop.webp`, width: 1440, height: 900 }
const EMPTY = { shots: [], images: [], metrics: null, baseline: null }

beforeEach(() => {
  __resetChatBaselineCacheForTests()
  vi.resetAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m.shell.mockResolvedValue({ ok: true, shell: { origin: 'https://acme.vercel.app', shellHtml: '<html></html>' }, path: '/' })
  m.render.mockImplementation(async (a: { store?: boolean }) =>
    a.store === false
      ? { shots: [], images: [], desktopWebp: null, metrics: METRICS, error: null }
      : { shots: [SHOT], images: [{ viewport: 'desktop', webp: Buffer.from('x') }], desktopWebp: null, metrics: METRICS, error: null }
  )
  m.sign.mockResolvedValue({ [SHOT.path]: 'https://signed/p1' })
})

describe('renderChatPreview', () => {
  it('measures the turn-start baseline once (not stored), then renders + signs the preview', async () => {
    const r = await renderChatPreview(args())
    const calls = m.render.mock.calls.map((c) => c[0] as { store?: boolean; theme: ComposedTheme; name: string; folder: string[]; metrics?: boolean })
    expect(calls[0]).toMatchObject({ store: false, theme: BASE_THEME, metrics: true })
    expect(calls[1]).toMatchObject({ theme: THEME, name: `${TURN}-p1`, folder: ['renders', 'chat'], metrics: true })
    expect(r.shots).toEqual([{ ...SHOT, url: 'https://signed/p1' }])
    expect(r.baseline).toEqual(METRICS)
    expect(r.images).toHaveLength(1)
    await renderChatPreview(args({ previewNo: 2 }))
    expect(m.render).toHaveBeenCalledTimes(3) // baseline cached for the same blobs + page
  })
  it('a different page or draft re-measures the baseline', () => {
    expect(baselineCacheKey(SHAS, '/')).not.toBe(baselineCacheKey(SHAS, '/services'))
    expect(baselineCacheKey(SHAS, '/')).not.toBe(baselineCacheKey({ 'content/brand.json': 'b'.repeat(40) }, '/'))
  })
  it('scopes the baseline cache to the session', () => {
    expect(baselineCacheKey(SHAS, '/', 'a')).not.toBe(baselineCacheKey(SHAS, '/', 'b'))
  })
  it('reports an unloadable page without rendering', async () => {
    m.shell.mockResolvedValue({ ok: false, reason: 'No preview URL is set for this client.' })
    expect(await renderChatPreview(args())).toEqual({ shots: [], images: [], metrics: null, baseline: null, error: 'No preview URL is set for this client.' })
    expect(m.render).not.toHaveBeenCalled()
  })
  it('keeps the preview when signing fails (url null)', async () => {
    m.sign.mockRejectedValue(new Error('sign down'))
    expect((await renderChatPreview(args())).shots[0].url).toBeNull()
  })

  it('PF4: never throws — a throwing shell load or renderer becomes our own error text', async () => {
    m.shell.mockRejectedValue(new Error('PostgREST: relation "x" timeout'))
    const a = await renderChatPreview(args())
    expect(a).toMatchObject(EMPTY)
    expect(a.error).not.toContain('PostgREST')
    m.shell.mockResolvedValue({ ok: true, shell: { origin: 'https://acme.vercel.app', shellHtml: '<html></html>' }, path: '/' })
    m.render.mockRejectedValue(new Error('storage: bucket exploded'))
    const b = await renderChatPreview(args())
    expect(b.error).toBe('The preview could not be rendered.')
    expect(b.shots).toEqual([])
  })

  it('does not cache a partial baseline', async () => {
    m.render.mockImplementation(async (a: { store?: boolean }) =>
      a.store === false
        ? { shots: [], images: [], desktopWebp: null, metrics: { v: 1, viewports: [{ viewport: 'desktop' }] }, error: 'The render timed out.' }
        : { shots: [SHOT], images: [], desktopWebp: null, metrics: METRICS, error: null }
    )
    await renderChatPreview(args())
    expect(isChatBaselineCached(SID, SHAS, '/')).toBe(false)
    await renderChatPreview(args({ previewNo: 2 }))
    expect(m.render).toHaveBeenCalledTimes(4)
  })

  it('PF1: reports the baseline cache state and refuses a preview that would eat the commit reserve', async () => {
    expect(isChatBaselineCached(SID, SHAS, '/')).toBe(false)
    expect(chatPreviewRenderMs(false)).toBe(4 * 45_000)
    expect(chatPreviewRenderMs(true)).toBe(2 * 45_000)
    expect(CHAT_COMMIT_RESERVE_MS).toBe(45_000)

    // Uncached needs 180 s + 45 s reserve: 200 s left is not enough.
    const refused = await renderChatPreview(args({ turnDeadlineAt: Date.now() + 200_000 }))
    expect(refused).toEqual({ ...EMPTY, error: CHAT_PREVIEW_NO_TIME_ERROR })
    expect(m.render).not.toHaveBeenCalled()

    await renderChatPreview(args())
    expect(isChatBaselineCached(SID, SHAS, '/')).toBe(true)
    // Cached needs 90 s + 45 s: 200 s left is enough.
    const ok = await renderChatPreview(args({ previewNo: 2, turnDeadlineAt: Date.now() + 200_000 }))
    expect(ok.error).toBeNull()
  })
})

describe('chatPreviewTheme', () => {
  const files = { brandText: '{}', designText: '{}', themeCss: ':root{}', overridesCss: '' }
  it('composes the rendered working copy', () => {
    const r = chatPreviewTheme({ ok: true, files })
    expect(r.ok && r.theme.themeCss).toBe(':root{}')
  })
  it('surfaces a malformed region (or any render failure) as our own preview error', () => {
    const malformed = chatPreviewTheme({ ok: false, errors: [MALFORMED_REGION_ERROR] })
    expect(malformed.ok).toBe(false)
    expect(!malformed.ok && malformed.error).toMatch(/malformed design-studio region markers/)
    const other = chatPreviewTheme({ ok: false, errors: ['lightningcss: unexpected token at 1:4'] })
    expect(!other.ok && other.error).toBe('The working copy could not be turned into theme files, so it can’t be previewed.')
  })
})
