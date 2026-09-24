// Test-only helper (not a *.test.ts file, so vitest never collects it on its
// own): the real-Chromium integration cases for renderComposed(), shared by
// render-composed.test.ts (local Chrome, default flags) and
// render-composed.single-process.test.ts (local Chrome with
// --single-process --no-zygote, the @sparticuz/chromium production mode).
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { renderComposed } from './render-composed'
import { closeBrowserForTests } from './browser'

export const HAS_CHROME = !!process.env.CHROMIUM_EXECUTABLE_PATH
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47])

export const TEST_HTML = `<!doctype html><html><head><base href="https://example.invalid/"></head><body style="margin:0">
<section data-block="hero" style="height:900px;background:#003b71;color:#fff"><h1>Hero</h1></section>
<section data-block="feature-grid" style="height:400px;background:#eee">Features</section>
<section data-block="cta-banner" style="height:300px;background:#f57f09">CTA</section>
<footer data-component="footer" style="height:200px;background:#222">Footer</footer>
<img src="https://evil.test/track.png" alt="">
</body></html>`

const SHELL = 'https://example.invalid/'

// PNG IHDR: width/height are big-endian uint32s at byte offsets 16 and 20.
export function pngSize(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

const EXPECTED_FOLD = { desktop: { width: 1440, height: 900 }, mobile: { width: 780, height: 1688 } } as const

export function defineRealChromeSuite(label: string, extraArgs: string | null): void {
  describe.skipIf(!HAS_CHROME)(`renderComposed (real Chromium, ${label})`, () => {
    beforeAll(async () => {
      // process.env persists across test files that share a worker, so set
      // (or clear) the flags explicitly and start from a cold browser.
      await closeBrowserForTests()
      if (extraArgs) process.env.CHROMIUM_EXTRA_ARGS = extraArgs
      else delete process.env.CHROMIUM_EXTRA_ARGS
    })

    afterAll(async () => {
      await closeBrowserForTests()
      delete process.env.CHROMIUM_EXTRA_ARGS
    })

    it('renders the desktop fold plus block crops as PNGs and blocks foreign requests', async () => {
      const r = await renderComposed({ html: TEST_HTML, shellOrigin: SHELL, viewport: 'desktop', crops: true })
      const kinds = r.shots.map((s) => s.kind)
      expect(kinds[0]).toBe('fold')
      expect(kinds.filter((k) => k === 'block').length).toBeGreaterThanOrEqual(2)
      for (const s of r.shots) expect(s.png.subarray(0, 4).equals(PNG_MAGIC)).toBe(true)
      expect(r.blockedRequests).toBeGreaterThanOrEqual(1)
      expect(r.timings.renderMs).toBeGreaterThan(0)
    }, 60_000)

    it('renders mobile fold + next viewport and no block crops', async () => {
      const r = await renderComposed({ html: TEST_HTML, shellOrigin: SHELL, viewport: 'mobile' })
      expect(r.shots.map((s) => s.kind)).toEqual(['fold', 'next'])
    }, 60_000)

    it('reuses the warm browser (second launch is near-instant)', async () => {
      await renderComposed({ html: TEST_HTML, shellOrigin: SHELL, viewport: 'mobile' })
      const r = await renderComposed({ html: TEST_HTML, shellOrigin: SHELL, viewport: 'mobile' })
      expect(r.timings.launchMs).toBeLessThan(200)
    }, 60_000)

    it('8 sequential renders alternating desktop/mobile on ONE browser all succeed at the right pixel sizes', async () => {
      const dims: string[] = []
      for (let i = 0; i < 8; i++) {
        const viewport = i % 2 === 0 ? 'desktop' : 'mobile'
        const r = await renderComposed({ html: TEST_HTML, shellOrigin: SHELL, viewport, crops: viewport === 'desktop' })
        const fold = pngSize(r.shots[0].png)
        dims.push(`${viewport}:${fold.width}x${fold.height}`)
        expect(fold).toEqual(EXPECTED_FOLD[viewport])
        if (viewport === 'mobile') {
          expect(r.shots.map((s) => s.kind)).toEqual(['fold', 'next'])
          expect(pngSize(r.shots[1].png)).toEqual(EXPECTED_FOLD.mobile)
        } else {
          // Desktop block crops are 1440 wide (DPR 1 restored after a mobile render).
          for (const s of r.shots.filter((x) => x.kind === 'block')) expect(pngSize(s.png).width).toBe(1440)
        }
        // Blocks must be attributed per render, not accumulated across renders.
        expect(r.blockedRequests).toBeGreaterThanOrEqual(1)
        expect(r.blockedRequests).toBeLessThanOrEqual(2)
        if (i > 0) expect(r.timings.launchMs).toBeLessThan(200)
      }
      console.warn(`[real-chrome ${label}] sequential fold dims: ${dims.join(', ')}`)
    }, 180_000)

    it('a concurrent pair of renders both succeed (serialized on the shared page)', async () => {
      const [a, b] = await Promise.all([
        renderComposed({ html: TEST_HTML, shellOrigin: SHELL, viewport: 'desktop', crops: true }),
        renderComposed({ html: TEST_HTML, shellOrigin: SHELL, viewport: 'mobile' }),
      ])
      expect(pngSize(a.shots[0].png)).toEqual(EXPECTED_FOLD.desktop)
      expect(pngSize(b.shots[0].png)).toEqual(EXPECTED_FOLD.mobile)
      expect(a.blockedRequests).toBeGreaterThanOrEqual(1)
      expect(b.blockedRequests).toBeGreaterThanOrEqual(1)
      // The second one waited for the first — its queue step is non-trivial.
      expect(Math.max(a.steps.queue ?? 0, b.steps.queue ?? 0)).toBeGreaterThan(0)
    }, 120_000)
  })
}
