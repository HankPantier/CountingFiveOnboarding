import { beforeEach, describe, expect, it, vi } from 'vitest'

const SID = '7ce3c00a-f6ad-41f3-86cc-6bdfc3af7184'
const m = vi.hoisted(() => ({
  resolve: vi.fn(),
  isDerived: vi.fn(async (_a: unknown, _u: string) => false),
  updateError: null as { message: string } | null,
  updates: [] as unknown[],
}))

vi.mock('../../_helpers', () => ({
  resolveEditContext: async () => ({ jobId: 'j', githubRepo: 'o/r', user: { isAdmin: true } }),
}))
vi.mock('@/lib/theme-preview/site-url', () => ({
  resolvePreviewSiteUrl: (a: unknown) => m.resolve(a),
  isDerivedVercelUrl: (a: unknown, u: string) => m.isDerived(a, u),
}))
vi.mock('@/lib/github/repo-files', () => ({ MAIN_BRANCH: 'main', readSiteConfigSiteUrl: async () => 'https://www.acmecpa.com' }))
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => ({
      update: (v: unknown) => ({
        eq: async () => {
          m.updates.push(v)
          return { error: m.updateError }
        },
      }),
    }),
  }),
}))

import { GET, PATCH } from './route'

const params = { params: Promise.resolve({ id: SID }) }
const patch = (previewUrl: unknown) =>
  new Request('http://x', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ previewUrl }) })

beforeEach(() => {
  m.resolve.mockReset()
  m.isDerived.mockReset().mockResolvedValue(false)
  m.updateError = null
  m.updates = []
})

describe('GET /theme/preview-url — source', () => {
  it("reports an operator-typed stored URL as 'override'", async () => {
    m.resolve.mockResolvedValue({ url: 'https://staging.acme.test/', source: 'override' })
    const body = await (await GET(new Request('http://x'), params)).json()
    expect(body).toEqual({
      previewUrl: 'https://staging.acme.test/',
      source: 'override',
      configUrl: 'https://www.acmecpa.com',
      effectiveUrl: 'https://staging.acme.test/',
    })
  })

  it("reports a stored URL equal to the derived Vercel address as 'vercel', not an override", async () => {
    m.resolve.mockResolvedValue({ url: 'https://acme.vercel.app/', source: 'override' })
    m.isDerived.mockResolvedValue(true)
    const body = await (await GET(new Request('http://x'), params)).json()
    expect(body.source).toBe('vercel')
    expect(m.isDerived).toHaveBeenCalledWith({ jobId: 'j', githubRepo: 'o/r' }, 'https://acme.vercel.app/')
  })

  it("reports a freshly derived address as 'vercel' and the site.config fallback as 'siteUrl'", async () => {
    m.resolve.mockResolvedValue({ url: 'https://acme.vercel.app/', source: 'vercel' })
    expect((await (await GET(new Request('http://x'), params)).json()).source).toBe('vercel')
    m.resolve.mockResolvedValue({ url: 'https://www.acmecpa.com', source: 'config' })
    const body = await (await GET(new Request('http://x'), params)).json()
    expect(body).toMatchObject({ source: 'siteUrl', previewUrl: null, effectiveUrl: 'https://www.acmecpa.com' })
  })
})

describe('PATCH /theme/preview-url', () => {
  it('clearing the override re-resolves the default', async () => {
    m.resolve.mockResolvedValue({ url: 'https://acme.vercel.app/', source: 'vercel' })
    const res = await PATCH(patch(null), params)
    expect(res.status).toBe(200)
    expect(m.updates[0]).toMatchObject({ preview_url: null })
    expect((await res.json()).source).toBe('vercel')
  })

  it('still answers 200 with the saved value when the follow-up lookup fails', async () => {
    m.resolve.mockRejectedValue(new Error('content_jobs preview_url read failed: timeout'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await PATCH(patch('https://acme.vercel.app'), params)
    warn.mockRestore()
    expect(res.status).toBe(200)
    expect(m.updates[0]).toMatchObject({ preview_url: 'https://acme.vercel.app/' })
    expect(await res.json()).toEqual({
      previewUrl: 'https://acme.vercel.app/',
      source: 'override',
      configUrl: null,
      effectiveUrl: 'https://acme.vercel.app/',
    })
  })

  it('a failed save is still a 500', async () => {
    m.updateError = { message: 'db down' }
    expect((await PATCH(patch('https://acme.vercel.app'), params)).status).toBe(500)
  })

  it('rejects a malformed URL with 400', async () => {
    expect((await PATCH(patch('not a url'), params)).status).toBe(400)
    expect(m.updates).toHaveLength(0)
  })
})
