import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchViaScrapingBee, scrapingBeeEnabled } from './scrapingbee'

describe('scrapingbee fallback', () => {
  const original = process.env.SCRAPINGBEE_API_KEY

  afterEach(() => {
    if (original === undefined) delete process.env.SCRAPINGBEE_API_KEY
    else process.env.SCRAPINGBEE_API_KEY = original
    vi.restoreAllMocks()
  })

  it('is disabled and returns null when no key is set', async () => {
    delete process.env.SCRAPINGBEE_API_KEY
    expect(scrapingBeeEnabled()).toBe(false)
    // Must not even attempt a network call when disabled.
    const spy = vi.spyOn(globalThis, 'fetch')
    const res = await fetchViaScrapingBee('https://example.com/')
    expect(res).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('returns a 200 FetchResult with the HTML body on success', async () => {
    process.env.SCRAPINGBEE_API_KEY = 'test-key'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html><body>hi</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html', 'spb-original-status': '200' },
      }),
    )
    const res = await fetchViaScrapingBee('https://blocked.example/')
    expect(res).not.toBeNull()
    expect(res?.status).toBe(200)
    expect(res?.body).toContain('hi')
    expect(res?.contentType).toContain('text/html')
  })

  it('returns null when ScrapingBee itself errors (bad key / no credits)', async () => {
    process.env.SCRAPINGBEE_API_KEY = 'test-key'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 401 }))
    const res = await fetchViaScrapingBee('https://blocked.example/')
    expect(res).toBeNull()
  })
})
