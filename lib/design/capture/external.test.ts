import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import sharp from 'sharp'

const fetchable = vi.fn(async (_url: string) => true)
vi.mock('@/lib/audit/ssrf-guard', () => ({ isUrlPubliclyFetchable: (u: string) => fetchable(u) }))

import { captureExternalScreenshot } from './external'

let pngBytes: Buffer
beforeEach(async () => {
  pngBytes = await sharp({ create: { width: 1440, height: 900, channels: 3, background: '#fff' } }).png().toBuffer()
  process.env.SCRAPINGBEE_API_KEY = 'test-key'
  fetchable.mockResolvedValue(true)
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.SCRAPINGBEE_API_KEY
})

function stubFetch(...responses: Response[]) {
  const f = vi.fn()
  for (const r of responses) f.mockResolvedValueOnce(r)
  vi.stubGlobal('fetch', f)
  return f
}

describe('captureExternalScreenshot', () => {
  it('captures via ScrapingBee screenshot mode and returns WebP', async () => {
    const f = stubFetch(new Response(new Uint8Array(pngBytes), { status: 200 }))
    const r = await captureExternalScreenshot('https://competitor.example.com/')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.webp.subarray(8, 12).toString('ascii')).toBe('WEBP')
    const calledUrl = new URL(String(f.mock.calls[0][0]))
    expect(calledUrl.searchParams.get('screenshot')).toBe('true')
    expect(calledUrl.searchParams.get('url')).toBe('https://competitor.example.com/')
    expect(calledUrl.searchParams.get('stealth_proxy')).toBeNull()
  })

  it('retries once with the stealth proxy when the first attempt fails', async () => {
    const f = stubFetch(new Response('blocked', { status: 500 }), new Response(new Uint8Array(pngBytes), { status: 200 }))
    const r = await captureExternalScreenshot('https://waf.example.com/')
    expect(r.ok).toBe(true)
    expect(new URL(String(f.mock.calls[1][0])).searchParams.get('stealth_proxy')).toBe('true')
  })

  it.each([
    ['non-http scheme', 'ftp://x.example.com/'],
    ['credentials', 'https://user:pw@x.example.com/'],
    ['too long', 'https://x.example.com/' + 'a'.repeat(300)],
    ['garbage', 'not a url'],
  ])('rejects %s without calling ScrapingBee', async (_l, url) => {
    const f = stubFetch()
    const r = await captureExternalScreenshot(url)
    expect(r.ok).toBe(false)
    expect(f).not.toHaveBeenCalled()
  })

  it('rejects private / internal hosts via the SSRF guard', async () => {
    fetchable.mockResolvedValue(false)
    const f = stubFetch()
    const r = await captureExternalScreenshot('https://internal.example.com/')
    expect(r).toMatchObject({ ok: false })
    expect(f).not.toHaveBeenCalled()
  })

  it('rejects a non-image response (magic bytes)', async () => {
    stubFetch(new Response('<html>not an image</html>', { status: 200 }), new Response('<html></html>', { status: 200 }))
    const r = await captureExternalScreenshot('https://x.example.com/')
    expect(r.ok).toBe(false)
  })

  it('reports not-configured without a key', async () => {
    delete process.env.SCRAPINGBEE_API_KEY
    const r = await captureExternalScreenshot('https://x.example.com/')
    expect(r).toEqual({ ok: false, reason: 'Screenshot capture is not configured.' })
  })
})
