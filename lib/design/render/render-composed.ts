// Server-only. Render one composed Design Studio document (live page shell +
// draft theme CSS) at a viewport and return PNG screenshots:
//   desktop → the above-the-fold shot + up to 3 block crops (crops: true)
//   mobile  → the fold + the next viewport down (skipped if the page is too
//             short to differ meaningfully from the fold)
// Every network request is filtered through isAllowedRenderRequest and capped.
// The page's own per-origin CSP (harden.ts's buildRenderCsp) is now a full
// allowlist and enforces itself on every redirect hop — Chromium blocks a
// disallowed fetch (e.g. a foreign-origin <img>) at the CSP layer BEFORE it
// ever reaches Playwright's route() handler, so it never increments the
// route-based counter above. `blockedRequests` counts both layers so callers
// get one honest "how many things did we refuse to load" number regardless
// of which layer caught it.
import {
  CROP_SELECTORS,
  MAX_RENDER_REQUESTS,
  PAGE_TIMEOUT_MS,
  VIEWPORTS,
  hardenForRender,
  isAllowedRenderRequest,
  type ViewportKey,
} from './harden'
import { getBrowser } from './browser'

export type RenderShot = { kind: 'fold' | 'next' | 'block'; selector?: string; png: Buffer }
export type RenderResult = {
  shots: RenderShot[]
  timings: { launchMs: number; renderMs: number }
  blockedRequests: number
}

const MAX_BLOCK_CROPS = 3
// A page taller than the fold by less than this factor would produce a
// "next" shot that's nearly identical to the fold — skip it rather than
// waste a screenshot on a near-duplicate.
const NEXT_SHOT_HEIGHT_FACTOR = 1.2
// Bound for the best-effort network-idle / webfonts waits below — these are
// "nice to have" waits, not correctness gates, so a slow-polling asset or a
// webfont that never resolves must not stall the whole render out to
// PAGE_TIMEOUT_MS.
const SETTLE_WAIT_MS = 3_000

export async function renderComposed(args: {
  html: string
  shellOrigin: string
  viewport: ViewportKey
  crops?: boolean
}): Promise<RenderResult> {
  const t0 = Date.now()
  const browser = await getBrowser()
  const launchMs = Date.now() - t0

  const vp = VIEWPORTS[args.viewport]
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.deviceScaleFactor,
    serviceWorkers: 'block',
  })

  const shots: RenderShot[] = []
  let blockedRequests = 0
  try {
    let requests = 0
    await context.route('**/*', (route) => {
      requests++
      if (requests > MAX_RENDER_REQUESTS || !isAllowedRenderRequest(route.request().url(), args.shellOrigin)) {
        blockedRequests++
        return route.abort()
      }
      return route.continue()
    })

    const page = await context.newPage()
    page.setDefaultTimeout(PAGE_TIMEOUT_MS)
    // A CSP-blocked fetch never reaches context.route() above (Chromium
    // refuses it before dispatching to the network layer at all) but does
    // fire 'requestfailed' with this specific errorText — count it so the
    // returned metric reflects the CSP layer's blocks too, not just the
    // route allowlist's.
    page.on('requestfailed', (req) => {
      if (req.failure()?.errorText === 'csp') blockedRequests++
    })
    // 'load' is the hard gate (bounded by PAGE_TIMEOUT_MS below); a
    // long-polling or slow-drip asset on the shell's own origin must not be
    // able to stall the render for the full page timeout, so network-idle
    // beyond 'load' is only a bounded best-effort wait.
    await page.setContent(hardenForRender(args.html, args.shellOrigin), { waitUntil: 'load', timeout: PAGE_TIMEOUT_MS })
    await page.waitForLoadState('networkidle', { timeout: SETTLE_WAIT_MS }).catch(() => {})
    // CDP evaluate is not subject to the page CSP; wait for webfonts so type
    // renders, but bound it too — a webfont that never resolves (blocked,
    // 404, etc.) must not hang the render.
    await Promise.race([
      page.evaluate(() => document.fonts.ready.then(() => undefined)),
      new Promise<void>((resolve) => setTimeout(resolve, SETTLE_WAIT_MS)),
    ])

    shots.push({ kind: 'fold', png: await page.screenshot({ type: 'png' }) })

    if (args.viewport === 'mobile') {
      const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight)
      if (pageHeight > vp.height * NEXT_SHOT_HEIGHT_FACTOR) {
        await page.evaluate((h) => window.scrollTo(0, h), vp.height)
        shots.push({ kind: 'next', png: await page.screenshot({ type: 'png' }) })
      }
    } else if (args.crops) {
      for (const selector of CROP_SELECTORS) {
        if (shots.filter((s) => s.kind === 'block').length >= MAX_BLOCK_CROPS) break
        const el = page.locator(selector).first()
        if ((await el.count()) === 0) continue
        shots.push({ kind: 'block', selector, png: await el.screenshot({ type: 'png', timeout: 5_000 }) })
      }
    }
  } finally {
    await context.close().catch(() => {})
  }

  return { shots, timings: { launchMs, renderMs: Date.now() - t0 }, blockedRequests }
}
