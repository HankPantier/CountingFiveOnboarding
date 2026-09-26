import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ siteUrl: vi.fn(), get: vi.fn() }))
vi.mock('@/lib/theme-preview/site-url', () => ({ getPreviewSiteUrl: (a: unknown) => m.siteUrl(a) }))
vi.mock('@/lib/audit/crawl', () => ({ safeGet: (u: string) => m.get(u) }))

import { __resetShellCapabilitiesCacheForTests, parseShellCapabilities, readShellCapabilities } from './shell-capabilities'

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
    ['non-html', () => m.get.mockResolvedValue({ ...page(''), contentType: 'application/json' })],
    ['throws', () => m.get.mockRejectedValue(new Error('boom'))],
  ])('is unverified (and uncached) on %s', async (_n, arrange) => {
    arrange()
    const args = { jobId: 'j', githubRepo: 'o/r' }
    expect(await readShellCapabilities(args, 1000)).toEqual({ status: 'unverified' })
    // The failure must not be cached: a later successful read within the TTL
    // hits the network again and verifies.
    m.siteUrl.mockReset().mockResolvedValue('https://a.test')
    m.get.mockReset().mockResolvedValue(page('<meta name="c5-capabilities" content="fonts">'))
    expect(await readShellCapabilities(args, 2000)).toEqual({ status: 'verified', capabilities: ['fonts'] })
    expect(m.get).toHaveBeenCalledTimes(1)
  })
})
