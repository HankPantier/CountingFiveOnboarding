import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest'

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
const afterCbs: (() => Promise<void>)[] = []
vi.mock('next/server', () => ({ after: (cb: () => Promise<void>) => afterCbs.push(cb) }))
vi.mock('./vercel-alias', () => ({ deriveVercelPreviewUrl: (repo: string) => derive(repo) }))

import { DERIVE_DEADLINE_MS, DERIVE_RETRY_MS, __resetPreviewUrlCacheForTests, cacheVercelPreviewUrl, classifyStoredPreviewUrl, getPreviewSiteUrl, lookupVercelPreviewUrl, resolvePreviewSiteUrl } from './site-url'

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

describe('resolvePreviewSiteUrl — lookup deadline', () => {
  beforeEach(() => {
    __resetPreviewUrlCacheForTests()
    readSiteConfigSiteUrl.mockClear()
    derive.mockReset()
    state.updates = []
    state.updateError = null
    afterCbs.length = 0
    state.result = { data: { preview_url: null }, error: null }
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('falls back to siteUrl after the deadline, finishes the lookup + cache write in after(), and does not negative-cache', async () => {
    let release: (v: string) => void = () => {}
    derive.mockReturnValue(new Promise<string>((r) => (release = r)))
    const p = resolvePreviewSiteUrl(ARGS)
    await vi.advanceTimersByTimeAsync(DERIVE_DEADLINE_MS)
    await expect(p).resolves.toEqual({ url: 'https://old-live.example.com', source: 'config' })
    expect(afterCbs).toHaveLength(1)

    release('https://slow.vercel.app/')
    await afterCbs[0]()
    expect(state.updates.map((u) => u.values)).toEqual([expect.objectContaining({ preview_url: 'https://slow.vercel.app/' })])
    // The next request (DB row still null here) uses the memoized hit — no
    // second derivation, no fallback.
    await expect(resolvePreviewSiteUrl(ARGS)).resolves.toEqual({ url: 'https://slow.vercel.app/', source: 'vercel' })
    expect(derive).toHaveBeenCalledTimes(1)
  })

  it('a lookup that finishes inside the deadline is used directly', async () => {
    derive.mockResolvedValue('https://fast.vercel.app/')
    const p = resolvePreviewSiteUrl(ARGS)
    await vi.advanceTimersByTimeAsync(10)
    await expect(p).resolves.toEqual({ url: 'https://fast.vercel.app/', source: 'vercel' })
    expect(afterCbs).toHaveLength(0)
  })

  it('a timeout is not recorded as a miss: the next request joins the still-running lookup', async () => {
    let release: (v: string) => void = () => {}
    derive.mockReturnValue(new Promise<string>((r) => (release = r)))
    const p = resolvePreviewSiteUrl(ARGS)
    await vi.advanceTimersByTimeAsync(DERIVE_DEADLINE_MS)
    await p
    // A negative-cached miss would return at once with no background task;
    // instead the second request waits on the same lookup again.
    const q = resolvePreviewSiteUrl(ARGS)
    await vi.advanceTimersByTimeAsync(DERIVE_DEADLINE_MS)
    await expect(q).resolves.toMatchObject({ source: 'config' })
    expect(afterCbs).toHaveLength(2)
    expect(derive).toHaveBeenCalledTimes(1)
    release('https://later.vercel.app/')
    await Promise.all(afterCbs.map((cb) => cb()))
    await expect(resolvePreviewSiteUrl(ARGS)).resolves.toEqual({ url: 'https://later.vercel.app/', source: 'vercel' })
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

  it('remembers a hit per repo, so a failed cache write only retries the write', async () => {
    derive.mockResolvedValue('https://x.vercel.app/')
    state.updateError = { message: 'boom' }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await cacheVercelPreviewUrl(ARGS, 1000)).toBe('https://x.vercel.app/')
    expect(await cacheVercelPreviewUrl(ARGS, 9000)).toBe('https://x.vercel.app/')
    warn.mockRestore()
    expect(derive).toHaveBeenCalledTimes(1)
    expect(state.updates).toHaveLength(2)
    // Expires with the same TTL as a miss.
    await cacheVercelPreviewUrl(ARGS, 1000 + DERIVE_RETRY_MS)
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

describe('classifyStoredPreviewUrl', () => {
  beforeEach(() => {
    __resetPreviewUrlCacheForTests()
    derive.mockReset()
    afterCbs.length = 0
  })

  it('warm hit: vercel only when the stored URL equals the derived alias', async () => {
    derive.mockResolvedValue('https://acme.vercel.app/')
    await lookupVercelPreviewUrl('o/r', 1000)
    expect(classifyStoredPreviewUrl('o/r', 'https://acme.vercel.app/', 2000)).toBe('vercel')
    expect(classifyStoredPreviewUrl('o/r', 'https://other.vercel.app/', 2000)).toBe('override')
    expect(classifyStoredPreviewUrl('o/r', 'https://staging.acme.test/', 2000)).toBe('override')
    expect(derive).toHaveBeenCalledTimes(1)
    expect(afterCbs).toHaveLength(0)
  })

  it('warm miss (nothing derivable): override, even for a vercel.app host', async () => {
    derive.mockResolvedValue(null)
    await lookupVercelPreviewUrl('o/r', 1000)
    expect(classifyStoredPreviewUrl('o/r', 'https://acme.vercel.app/', 2000)).toBe('override')
    expect(afterCbs).toHaveLength(0)
  })

  it('cold: answers at once (provisional by host) and refreshes the lookup in after()', async () => {
    let release: (v: string) => void = () => {}
    derive.mockReturnValue(new Promise<string>((r) => (release = r)))
    expect(classifyStoredPreviewUrl('o/r', 'https://acme.vercel.app/', 1000)).toBe('vercel')
    expect(classifyStoredPreviewUrl('o/r', 'https://staging.acme.test/', 1000)).toBe('override')
    expect(afterCbs.length).toBeGreaterThan(0)
    expect(derive).toHaveBeenCalledTimes(1) // shared in-flight refresh
    release('https://acme-cpa.vercel.app/')
    await Promise.all(afterCbs.map((cb) => cb()))
    // Now warm: the provisional answer is corrected.
    expect(classifyStoredPreviewUrl('o/r', 'https://acme.vercel.app/', 2000)).toBe('override')
    expect(classifyStoredPreviewUrl('o/r', 'https://acme-cpa.vercel.app/', 2000)).toBe('vercel')
  })
})
