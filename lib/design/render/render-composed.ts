// Server-only. Render one composed Design Studio document (live page shell +
// draft theme CSS) at a viewport and return PNG screenshots:
//   desktop → the above-the-fold shot + up to 3 block crops (crops: true)
//   mobile  → the fold + the next viewport down
// Every network request is filtered through isAllowedRenderRequest and capped.
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
  })
  let requests = 0
  let blockedRequests = 0
  await context.route('**/*', (route) => {
    requests++
    if (requests > MAX_RENDER_REQUESTS || !isAllowedRenderRequest(route.request().url(), args.shellOrigin)) {
      blockedRequests++
      return route.abort()
    }
    return route.continue()
  })

  const shots: RenderShot[] = []
  try {
    const page = await context.newPage()
    page.setDefaultTimeout(PAGE_TIMEOUT_MS)
    await page.setContent(hardenForRender(args.html), { waitUntil: 'networkidle', timeout: PAGE_TIMEOUT_MS })
    // CDP evaluate is not subject to the page CSP; wait for webfonts so type renders.
    await page.evaluate(async () => {
      await document.fonts.ready
    })

    shots.push({ kind: 'fold', png: await page.screenshot({ type: 'png' }) })

    if (args.viewport === 'mobile') {
      await page.evaluate((h) => window.scrollTo(0, h), vp.height)
      shots.push({ kind: 'next', png: await page.screenshot({ type: 'png' }) })
    } else if (args.crops) {
      for (const selector of CROP_SELECTORS) {
        if (shots.filter((s) => s.kind === 'block').length >= MAX_BLOCK_CROPS) break
        const el = page.locator(selector).first()
        if ((await el.count()) === 0) continue
        shots.push({ kind: 'block', selector, png: await el.screenshot({ type: 'png', timeout: 5_000 }) })
      }
    }
  } finally {
    await context.close()
  }

  return { shots, timings: { launchMs, renderMs: Date.now() - t0 }, blockedRequests }
}
