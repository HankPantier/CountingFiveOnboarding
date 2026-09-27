import { describe, it, expect, vi, beforeEach } from 'vitest'

const state: {
  result: { data: unknown; error: { message: string } | null }
  updateError: { message: string } | null
  updates: { values: unknown; eq: [string, unknown]; is: [string, unknown] }[]
} = {
  result: { data: null, error: null },
  updateError: null,
  updates: [],
}
const readSiteConfigSiteUrl = vi.fn(async () => 'https://old-live.example.com')
const derive = vi.fn(async (_repo: string): Promise<string | null> => null)

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => state.result }) }),
      update: (values: unknown) => ({
        eq: (ec: string, ev: unknown) => ({
          is: async (ic: string, iv: unknown) => {
            state.updates.push({ values, eq: [ec, ev], is: [ic, iv] })
            return { error: state.updateError }
          },
        }),
      }),
    }),
  }),
}))
vi.mock('@/lib/github/repo-files', () => ({
  MAIN_BRANCH: 'main',
  readSiteConfigSiteUrl: () => readSiteConfigSiteUrl(),
}))
vi.mock('./vercel-alias', () => ({ deriveVercelPreviewUrl: (repo: string) => derive(repo) }))

import { DERIVE_RETRY_MS, __resetPreviewUrlCacheForTests, cacheVercelPreviewUrl, getPreviewSiteUrl, resolvePreviewSiteUrl } from './site-url'

const ARGS = { jobId: 'j', githubRepo: 'o/r' }

describe('resolvePreviewSiteUrl — fallback order', () => {
  beforeEach(() => {
    __resetPreviewUrlCacheForTests()
    readSiteConfigSiteUrl.mockClear()
    derive.mockReset().mockResolvedValue(null)
    state.updates = []
    state.updateError = null
  })

  it('1. prefers the stored preview_url and derives nothing', async () => {
    state.result = { data: { preview_url: 'https://preview.example.com' }, error: null }
    await expect(resolvePreviewSiteUrl(ARGS)).resolves.toEqual({ url: 'https://preview.example.com', source: 'override' })
    expect(derive).not.toHaveBeenCalled()
    expect(readSiteConfigSiteUrl).not.toHaveBeenCalled()
  })

  it('2. with no preview_url, uses the verified Vercel address and caches it (only while still null)', async () => {
    state.result = { data: { preview_url: null }, error: null }
    derive.mockResolvedValue('https://tru-count-cpa.vercel.app/')
    await expect(resolvePreviewSiteUrl(ARGS)).resolves.toEqual({ url: 'https://tru-count-cpa.vercel.app/', source: 'vercel' })
    expect(derive).toHaveBeenCalledWith('o/r')
    expect(readSiteConfigSiteUrl).not.toHaveBeenCalled()
    expect(state.updates).toHaveLength(1)
    expect(state.updates[0].values).toMatchObject({ preview_url: 'https://tru-count-cpa.vercel.app/' })
    expect(state.updates[0].eq).toEqual(['id', 'j'])
    expect(state.updates[0].is).toEqual(['preview_url', null])
  })

  it('2b. a failed cache write still returns the verified address', async () => {
    state.result = { data: { preview_url: null }, error: null }
    state.updateError = { message: 'boom' }
    derive.mockResolvedValue('https://buss-cpa.vercel.app/')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(getPreviewSiteUrl(ARGS)).resolves.toBe('https://buss-cpa.vercel.app/')
    warn.mockRestore()
  })

  it('3. falls back to MAIN siteUrl when nothing is derived', async () => {
    state.result = { data: { preview_url: null }, error: null }
    await expect(resolvePreviewSiteUrl(ARGS)).resolves.toEqual({ url: 'https://old-live.example.com', source: 'config' })
    expect(state.updates).toHaveLength(0)
  })

  it('throws on a DB error instead of silently rendering the old live site', async () => {
    state.result = { data: null, error: { message: 'timeout' } }
    await expect(getPreviewSiteUrl(ARGS)).rejects.toThrow(/preview_url read failed/)
    expect(derive).not.toHaveBeenCalled()
    expect(readSiteConfigSiteUrl).not.toHaveBeenCalled()
  })
})

describe('cacheVercelPreviewUrl', () => {
  beforeEach(() => {
    __resetPreviewUrlCacheForTests()
    derive.mockReset().mockResolvedValue(null)
    state.updates = []
    state.updateError = null
  })

  it('negative-caches a miss per repo for DERIVE_RETRY_MS', async () => {
    expect(await cacheVercelPreviewUrl(ARGS, 1000)).toBeNull()
    expect(await cacheVercelPreviewUrl(ARGS, 1000 + DERIVE_RETRY_MS - 1)).toBeNull()
    expect(derive).toHaveBeenCalledTimes(1)
    derive.mockResolvedValue('https://x.vercel.app/')
    expect(await cacheVercelPreviewUrl(ARGS, 1000 + DERIVE_RETRY_MS)).toBe('https://x.vercel.app/')
    expect(derive).toHaveBeenCalledTimes(2)
  })

  it('shares one in-flight derivation between concurrent callers', async () => {
    let release: (v: string) => void = () => {}
    derive.mockReturnValue(new Promise<string>((r) => (release = r)))
    const a = cacheVercelPreviewUrl(ARGS)
    const b = cacheVercelPreviewUrl(ARGS)
    release('https://x.vercel.app/')
    expect(await Promise.all([a, b])).toEqual(['https://x.vercel.app/', 'https://x.vercel.app/'])
    expect(derive).toHaveBeenCalledTimes(1)
  })
})
