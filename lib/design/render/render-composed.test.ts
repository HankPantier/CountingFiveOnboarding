import { describe, it, expect, afterAll } from 'vitest'
import { renderComposed } from './render-composed'
import { closeBrowserForTests } from './browser'

const HAS_CHROME = !!process.env.CHROMIUM_EXECUTABLE_PATH
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47])

const HTML = `<!doctype html><html><head><base href="https://example.invalid/"></head><body style="margin:0">
<section data-block="hero" style="height:900px;background:#003b71;color:#fff"><h1>Hero</h1></section>
<section data-block="feature-grid" style="height:400px;background:#eee">Features</section>
<section data-block="cta-banner" style="height:300px;background:#f57f09">CTA</section>
<footer data-component="footer" style="height:200px;background:#222">Footer</footer>
<img src="https://evil.test/track.png" alt="">
</body></html>`

describe.skipIf(!HAS_CHROME)('renderComposed (real Chromium)', () => {
  afterAll(async () => {
    await closeBrowserForTests()
  })

  it('renders the desktop fold plus block crops as PNGs and blocks foreign requests', async () => {
    const r = await renderComposed({ html: HTML, shellOrigin: 'https://example.invalid/', viewport: 'desktop', crops: true })
    const kinds = r.shots.map((s) => s.kind)
    expect(kinds[0]).toBe('fold')
    expect(kinds.filter((k) => k === 'block').length).toBeGreaterThanOrEqual(2)
    for (const s of r.shots) expect(s.png.subarray(0, 4).equals(PNG_MAGIC)).toBe(true)
    expect(r.blockedRequests).toBeGreaterThanOrEqual(1)
    expect(r.timings.renderMs).toBeGreaterThan(0)
  }, 60_000)

  it('renders mobile fold + next viewport and no block crops', async () => {
    const r = await renderComposed({ html: HTML, shellOrigin: 'https://example.invalid/', viewport: 'mobile' })
    expect(r.shots.map((s) => s.kind)).toEqual(['fold', 'next'])
  }, 60_000)

  it('reuses the warm browser (second launch is near-instant)', async () => {
    // Self-warming: don't rely on a prior test in this file having already
    // launched the browser — render once first so this test is meaningful
    // in isolation (e.g. `vitest run -t "reuses the warm browser"`).
    await renderComposed({ html: HTML, shellOrigin: 'https://example.invalid/', viewport: 'mobile' })
    const r = await renderComposed({ html: HTML, shellOrigin: 'https://example.invalid/', viewport: 'mobile' })
    expect(r.timings.launchMs).toBeLessThan(200)
  }, 60_000)
})

describe('renderComposed without a browser', () => {
  it.skipIf(HAS_CHROME)('throws RendererUnavailableError when no Chromium is configured', async () => {
    await expect(renderComposed({ html: HTML, shellOrigin: 'https://example.invalid/', viewport: 'mobile' })).rejects.toThrow(
      /CHROMIUM_EXECUTABLE_PATH/
    )
  })
})
