import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const SID = '7ce3c00a-f6ad-41f3-86cc-6bdfc3af7184'
const gate = vi.fn()
const render = vi.fn()
const store = vi.fn(async (..._a: unknown[]) => undefined)

vi.mock('../_design', () => ({ requireDesignAdmin: (id: string) => gate(id) }))
vi.mock('@/lib/theme-preview/site-url', () => ({ getPreviewSiteUrl: async () => 'https://bblcpa.vercel.app/' }))
vi.mock('@/lib/theme-preview/build-preview-shell', () => ({
  buildPreviewShell: async () => ({ ok: true, origin: 'https://bblcpa.vercel.app/', shellHtml: '<html><head><!--__C5_THEME_SLOT__--></head><body></body></html>' }),
}))
vi.mock('@/lib/design/theme-sources', () => ({
  loadDraftThemeSources: async () => ({
    ok: true,
    sources: {
      themeCss: ':root{}',
      overridesCss: '',
      typography: { headingFont: 'Inter', bodyFont: 'Inter', accentFont: 'Fraunces', googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Inter' },
      headlineStyle: 'serif',
      eyebrowStyle: 'standard',
    },
  }),
}))
vi.mock('@/lib/design/render/render-composed', () => ({ renderComposed: (a: unknown) => render(a) }))
vi.mock('@/lib/design/render/browser', () => ({
  RendererUnavailableError: class RendererUnavailableError extends Error {},
}))
vi.mock('@/lib/design/storage', () => ({
  toWebp: async () => ({ webp: Buffer.from('w'), width: 1440, height: 900 }),
  designStoragePath: (sid: string, ...s: string[]) => `design/${sid}/${s.join('/')}`,
  storeDesignImage: (...a: unknown[]) => store(...a),
  signDesignPaths: async (_s: unknown, paths: string[]) => Object.fromEntries(paths.map((p) => [p, `https://signed/${p}`])),
}))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))

import { POST } from './route'
import { RendererUnavailableError } from '@/lib/design/render/browser'

const params = { params: Promise.resolve({ id: SID }) }
const req = (body: unknown) => new Request('http://x/api', { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  gate.mockReset()
  render.mockReset()
  store.mockClear()
  gate.mockResolvedValue({ sessionId: SID, jobId: 'j', githubRepo: 'o/r', user: { isAdmin: true } })
  render.mockResolvedValue({
    shots: [{ kind: 'fold', png: Buffer.from('p') }],
    timings: { launchMs: 5, renderMs: 900 },
    blockedRequests: 2,
    steps: { newContext: 3, route: 1, newPage: 2, setContent: 400, settle: 50, fonts: 30, fold: 80 },
  })
})

describe('POST /design/render', () => {
  it('returns the gate response for non-admins', async () => {
    gate.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await POST(req({}), params)
    expect(res.status).toBe(403)
    expect(render).not.toHaveBeenCalled()
  })

  it('rejects an unsafe page path with 400', async () => {
    const res = await POST(req({ path: '//evil.test' }), params)
    expect(res.status).toBe(400)
    expect(render).not.toHaveBeenCalled()
  })

  it('rejects an unknown viewport with 400', async () => {
    const res = await POST(req({ viewport: 'tablet' }), params)
    expect(res.status).toBe(400)
  })

  it('composes the draft theme with treatment attributes, stores WebP, and returns signed URLs', async () => {
    const res = await POST(req({ path: '/services', viewport: 'desktop' }), params)
    expect(res.status).toBe(200)
    const body = await res.json()
    const call = render.mock.calls[0][0] as { html: string; viewport: string; crops: boolean; shellOrigin: string }
    expect(call.viewport).toBe('desktop')
    expect(call.crops).toBe(true)
    expect(call.html).toContain('data-headline="serif"')
    expect(call.html).toContain(':root{}')
    expect(store).toHaveBeenCalledTimes(1)
    expect(body.shots[0].url).toMatch(new RegExp(`^https://signed/design/${SID}/renders/`))
    expect(body.path).toBe('/services')
    expect(body.timings.renderMs).toBe(900)
    expect(body.timings.steps).toEqual({ newContext: 3, route: 1, newPage: 2, setContent: 400, settle: 50, fonts: 30, fold: 80 })
  })

  it('maps RendererUnavailableError to 503', async () => {
    render.mockRejectedValue(new RendererUnavailableError('no chromium'))
    const res = await POST(req({}), params)
    expect(res.status).toBe(503)
  })

  it('maps RenderTimeoutError to 504', async () => {
    class RenderTimeoutError extends Error {
      constructor(message: string) {
        super(message)
        this.name = 'RenderTimeoutError'
      }
    }
    render.mockRejectedValue(new RenderTimeoutError('Render timed out during step "fold" after 45000ms'))
    const res = await POST(req({}), params)
    expect(res.status).toBe(504)
    const body = await res.json()
    expect(body.error).toBe('The render timed out.')
  })

  it('rejects a non-object JSON body with 400', async () => {
    const res = await POST(req(null), params)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Invalid JSON body.')
    expect(render).not.toHaveBeenCalled()
  })

  it('maps a renderer module load failure to a typed 503', async () => {
    // Simulate the dynamic import() of render-composed itself rejecting (e.g. a
    // trace gap surfacing as "Cannot find module .../browsers.json" at cold
    // start) by re-mocking it to throw, then re-importing the route fresh so
    // its internal `await import(...)` resolves against the new mock.
    vi.resetModules()
    vi.doMock('@/lib/design/render/render-composed', () => {
      throw new Error('Cannot find module playwright-core/browsers.json')
    })
    try {
      const { POST: freshPost } = await import('./route')
      const res = await freshPost(req({}), params)
      expect(res.status).toBe(503)
      const body = await res.json()
      expect(body.error).toBe('The renderer is unavailable right now.')
      expect(render).not.toHaveBeenCalled()
    } finally {
      vi.doUnmock('@/lib/design/render/render-composed')
      vi.resetModules()
    }
  })
})
