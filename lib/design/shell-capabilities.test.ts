import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ siteUrl: vi.fn(), get: vi.fn() }))
vi.mock('@/lib/theme-preview/site-url', () => ({ getPreviewSiteUrl: (a: unknown) => m.siteUrl(a) }))
vi.mock('@/lib/audit/crawl', () => ({ safeGet: (u: string) => m.get(u) }))

import { SHELL_READ_DEADLINE_MS, UNVERIFIED_TTL_MS, __resetShellCapabilitiesCacheForTests, parseShellCapabilities, readShellCapabilities } from './shell-capabilities'

const page = (meta: string) => ({ status: 200, contentType: 'text/html', finalUrl: 'https://a.test/', body: `<html><head>${meta}</head></html>` })

describe('parseShellCapabilities', () => {
  it.each([
    ['<meta name="c5-capabilities" content="fonts"/>', ['fonts']],
    ['<meta content="fonts,style-axes,specimen" name="c5-capabilities">', ['fonts', 'style-axes', 'specimen']],
    ["<meta name='C5-Capabilities' content=' Fonts , fonts '>", ['fonts']],
    ['<meta name="c5-capabilities" content="fonts,<script,x y">', ['fonts', 'x', 'y']],
    ['<meta name="description" content="fonts">', []],
    ['', []],
  ])('%s → %j', (meta, caps) => {
    expect(parseShellCapabilities(`<html><head>${meta}</head></html>`)).toEqual(caps)
  })
})

describe('readShellCapabilities', () => {
  beforeEach(() => {
    __resetShellCapabilitiesCacheForTests()
    m.siteUrl.mockReset().mockResolvedValue('https://a.test')
    m.get.mockReset()
  })
  it('verifies from the live homepage and caches for 60s', async () => {
    m.get.mockResolvedValue(page('<meta name="c5-capabilities" content="fonts">'))
    const args = { jobId: 'j', githubRepo: 'o/r' }
    expect(await readShellCapabilities(args, 1000)).toEqual({ status: 'verified', capabilities: ['fonts'] })
    expect(m.siteUrl).toHaveBeenCalledWith(args)
    expect(m.get).toHaveBeenCalledWith('https://a.test')
    await readShellCapabilities(args, 50_000)
    expect(m.get).toHaveBeenCalledTimes(1)
    // A cache hit makes no preview-URL (DB/GitHub) read either.
    expect(m.siteUrl).toHaveBeenCalledTimes(1)
    await readShellCapabilities(args, 62_000)
    expect(m.get).toHaveBeenCalledTimes(2)
  })
  it('a reachable shell without the meta verifies as no capabilities', async () => {
    m.get.mockResolvedValue(page(''))
    expect(await readShellCapabilities({ jobId: 'j', githubRepo: 'o/r' })).toEqual({ status: 'verified', capabilities: [] })
  })
  it.each([
    ['no preview url', () => m.siteUrl.mockResolvedValue(null)],
    ['preview url read throws', () => m.siteUrl.mockRejectedValue(new Error('db down'))],
    ['blocked fetch', () => m.get.mockResolvedValue(null)],
    ['http 503', () => m.get.mockResolvedValue({ ...page(''), status: 503 })],
    ['final 3xx (redirect chain gave up)', () => m.get.mockResolvedValue({ ...page(''), status: 301 })],
    ['non-html', () => m.get.mockResolvedValue({ ...page(''), contentType: 'application/json' })],
    ['throws', () => m.get.mockRejectedValue(new Error('boom'))],
  ])('is unverified (negative-cached for 15s only) on %s', async (_n, arrange) => {
    arrange()
    const args = { jobId: 'j', githubRepo: 'o/r' }
    expect(await readShellCapabilities(args, 1000)).toEqual({ status: 'unverified' })
    // Within the short negative TTL the failure is served from cache (no
    // second preview-URL read or fetch).
    const siteUrlCalls = m.siteUrl.mock.calls.length
    const getCalls = m.get.mock.calls.length
    m.siteUrl.mockReset().mockResolvedValue('https://a.test')
    m.get.mockReset().mockResolvedValue(page('<meta name="c5-capabilities" content="fonts">'))
    expect(await readShellCapabilities(args, 1000 + UNVERIFIED_TTL_MS - 1)).toEqual({ status: 'unverified' })
    expect(m.siteUrl).not.toHaveBeenCalled()
    expect(m.get).not.toHaveBeenCalled()
    expect(siteUrlCalls + getCalls).toBeGreaterThan(0)
    // After it, the next read hits the network again and verifies.
    expect(await readShellCapabilities(args, 1000 + UNVERIFIED_TTL_MS)).toEqual({ status: 'verified', capabilities: ['fonts'] })
    expect(m.get).toHaveBeenCalledTimes(1)
  })
  describe('overall deadline', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())
    it('a hung fetch resolves unverified at the deadline and is not cached', async () => {
      m.get.mockReturnValue(new Promise(() => {}))
      const args = { jobId: 'j', githubRepo: 'o/r' }
      const p = readShellCapabilities(args, 1000)
      let settled: unknown = 'pending'
      void p.then((v) => (settled = v))
      await vi.advanceTimersByTimeAsync(SHELL_READ_DEADLINE_MS - 1)
      expect(settled).toBe('pending')
      await vi.advanceTimersByTimeAsync(1)
      expect(settled).toEqual({ status: 'unverified' })
      m.get.mockReset().mockResolvedValue(page('<meta name="c5-capabilities" content="fonts">'))
      expect(await readShellCapabilities(args, 1000 + UNVERIFIED_TTL_MS)).toEqual({ status: 'verified', capabilities: ['fonts'] })
    })
    it('with the real clock: unverified is cached ~15s, verified 60s (fake timers)', async () => {
      vi.setSystemTime(new Date('2026-09-26T12:00:00Z'))
      const args = { jobId: 'j2', githubRepo: 'o/r' }
      m.get.mockResolvedValue(null)
      expect(await readShellCapabilities(args)).toEqual({ status: 'unverified' })
      await vi.advanceTimersByTimeAsync(UNVERIFIED_TTL_MS - 1000)
      expect(await readShellCapabilities(args)).toEqual({ status: 'unverified' })
      expect(m.get).toHaveBeenCalledTimes(1)
      m.get.mockResolvedValue(page('<meta name="c5-capabilities" content="fonts">'))
      await vi.advanceTimersByTimeAsync(1000)
      expect(await readShellCapabilities(args)).toEqual({ status: 'verified', capabilities: ['fonts'] })
      expect(m.get).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(59_000)
      expect(await readShellCapabilities(args)).toEqual({ status: 'verified', capabilities: ['fonts'] })
      expect(m.get).toHaveBeenCalledTimes(2)
    })
    it('a hung preview-url read also hits the deadline', async () => {
      m.siteUrl.mockReturnValue(new Promise(() => {}))
      const p = readShellCapabilities({ jobId: 'j', githubRepo: 'o/r' }, 1000)
      await vi.advanceTimersByTimeAsync(SHELL_READ_DEADLINE_MS)
      expect(await p).toEqual({ status: 'unverified' })
    })
  })
})
