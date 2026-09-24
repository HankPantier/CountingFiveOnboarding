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
//
// Gate-discovered defect (task-4-findings-gate.md): @sparticuz/chromium runs
// with --single-process on Vercel, which is known to be fragile across
// repeated contexts — a render can wedge indefinitely with no error, which
// without a deadline just runs until Vercel's own 120s function kill (an
// opaque, unrecoverable timeout with no chance to recycle the browser before
// the NEXT request reuses it). So the whole render races an explicit
// deadline (default 45s); per-step timings are tracked throughout so a
// timeout's error and logs say exactly which step was stuck, and the shared
// browser is recycled (never reused) after a timeout or a disconnect so the
// next request gets a fresh Chromium process instead of the same wedged one.
import {
  CROP_SELECTORS,
  MAX_RENDER_REQUESTS,
  PAGE_TIMEOUT_MS,
  VIEWPORTS,
  hardenForRender,
  isAllowedRenderRequest,
  type ViewportKey,
} from './harden'
import { getBrowser, recycleBrowser, RenderTimeoutError } from './browser'
import type { Browser, BrowserContext } from 'playwright-core'

export type RenderShot = { kind: 'fold' | 'next' | 'block'; selector?: string; png: Buffer }
export type RenderResult = {
  shots: RenderShot[]
  timings: { launchMs: number; renderMs: number }
  blockedRequests: number
  steps: Record<string, number>
}

const MAX_BLOCK_CROPS = 3
// A page taller than the fold by less than this factor would produce a
// "next" shot that's nearly identical to the fold — skip it rather than
// waste a screenshot on a near-duplicate.
const NEXT_SHOT_HEIGHT_FACTOR = 1.2
// Bound for the best-effort network-idle wait beyond 'load' below — this is
// a "nice to have" wait, not a correctness gate, so a slow-polling asset must
// not stall the whole render.
const SETTLE_WAIT_MS = 3_000
// page.evaluate() has no native timeout (unlike screenshot()/setContent()),
// so a wedged in-page call (e.g. under --single-process contention) would
// otherwise hang until the OVERALL deadline below catches it. Each evaluate
// gets its own short race with a safe fallback instead.
const EVAL_TIMEOUT_MS = 5_000
const SCREENSHOT_TIMEOUT_MS = 10_000
// Best-effort bound for closing a context we're abandoning because the
// overall deadline (or another error) already fired — don't let a hung
// close() add to how long a timed-out render keeps the function alive.
const CONTEXT_CLOSE_TIMEOUT_MS = 2_000
const DEFAULT_DEADLINE_MS = 45_000

// Races `promise` against a timer, clearing the timer as soon as EITHER side
// settles — a plain `Promise.race([p, timerPromise])` would leave the loser's
// timer scheduled (still holding its closure, still able to fire later and
// try to settle an already-settled promise) for as long as its own delay,
// which adds up across many renders in one warm, reused function instance.
function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => T | Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const fallback = onTimeout()
      if (fallback instanceof Error) reject(fallback)
      else resolve(fallback)
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

function boundedEvaluate<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return withTimeout(promise, EVAL_TIMEOUT_MS, () => fallback)
}

export async function renderComposed(args: {
  html: string
  shellOrigin: string
  viewport: ViewportKey
  crops?: boolean
  deadlineMs?: number
}): Promise<RenderResult> {
  const deadlineMs = args.deadlineMs ?? DEFAULT_DEADLINE_MS
  const t0 = Date.now()

  // Step tracking: `mark(next)` records how long the step we're LEAVING took,
  // then starts the clock for `next`. `currentStep` is read directly (not
  // through `steps`) by the timeout/error handler below, since the step in
  // progress at that moment never got a chance to call mark() itself.
  const steps: Record<string, number> = {}
  let currentStep = 'newContext'
  let stepStart = t0
  const mark = (next: string) => {
    steps[currentStep] = Date.now() - stepStart
    currentStep = next
    stepStart = Date.now()
  }

  let browser: Browser | null = null
  let context: BrowserContext | null = null

  const body = async (): Promise<RenderResult> => {
    browser = await getBrowser()
    const launchMs = Date.now() - t0
    // Reset the clock here (not at t0) so the 'newContext' step's recorded
    // duration is just the newContext() call, not also the browser-launch
    // wait already captured separately in `launchMs`.
    stepStart = Date.now()

    const vp = VIEWPORTS[args.viewport]
    context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.deviceScaleFactor,
      serviceWorkers: 'block',
    })
    mark('route')

    const shots: RenderShot[] = []
    let blockedRequests = 0
    let requests = 0
    await context.route('**/*', (route) => {
      requests++
      if (requests > MAX_RENDER_REQUESTS || !isAllowedRenderRequest(route.request().url(), args.shellOrigin)) {
        blockedRequests++
        return route.abort()
      }
      return route.continue()
    })
    mark('newPage')

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
    mark('setContent')
    // 'load' is the hard gate (bounded by PAGE_TIMEOUT_MS); a long-polling or
    // slow-drip asset on the shell's own origin must not be able to stall the
    // render for the full page timeout, so network-idle beyond 'load' is
    // only a bounded best-effort wait (next step, 'settle').
    await page.setContent(hardenForRender(args.html, args.shellOrigin), { waitUntil: 'load', timeout: PAGE_TIMEOUT_MS })
    mark('settle')
    await page.waitForLoadState('networkidle', { timeout: SETTLE_WAIT_MS }).catch(() => {})
    mark('fonts')
    // CDP evaluate is not subject to the page CSP; wait for webfonts so type
    // renders, but bound it too — a webfont that never resolves (blocked,
    // 404, etc.) must not hang the render.
    await boundedEvaluate(page.evaluate(() => document.fonts.ready.then(() => undefined)), undefined)
    mark('fold')

    shots.push({ kind: 'fold', png: await page.screenshot({ type: 'png', timeout: SCREENSHOT_TIMEOUT_MS }) })

    if (args.viewport === 'mobile') {
      mark('scroll')
      // A hung height check falls back to 0 (⇒ treated as "short") rather
      // than risking a further scroll+screenshot hang chasing a "next" shot
      // we can't reliably size.
      const pageHeight = await boundedEvaluate(page.evaluate(() => document.documentElement.scrollHeight), 0)
      if (pageHeight > vp.height * NEXT_SHOT_HEIGHT_FACTOR) {
        await boundedEvaluate(page.evaluate((h) => window.scrollTo(0, h), vp.height), undefined)
        mark('next')
        shots.push({ kind: 'next', png: await page.screenshot({ type: 'png', timeout: SCREENSHOT_TIMEOUT_MS }) })
      }
    } else if (args.crops) {
      for (const selector of CROP_SELECTORS) {
        if (shots.filter((s) => s.kind === 'block').length >= MAX_BLOCK_CROPS) break
        mark(`crop:${selector}`)
        const el = page.locator(selector).first()
        if ((await el.count()) === 0) continue
        shots.push({ kind: 'block', selector, png: await el.screenshot({ type: 'png', timeout: SCREENSHOT_TIMEOUT_MS }) })
      }
    }

    mark('close')
    await context.close().catch(() => {})
    steps[currentStep] = Date.now() - stepStart

    return { shots, timings: { launchMs, renderMs: Date.now() - t0 }, blockedRequests, steps }
  }

  try {
    return await withTimeout(
      body(),
      deadlineMs,
      () => new RenderTimeoutError(`Render timed out during step "${currentStep}" after ${deadlineMs}ms`)
    )
  } catch (err) {
    // Operational warning (not a debug log) — no secrets, just step names and durations.
    console.warn('[design-render] step timings', { step: currentStep, steps })
    const isTimeout = err instanceof RenderTimeoutError
    // `browser`/`context` are reassigned inside the `body` closure, not in
    // this outer scope directly — TS's control-flow narrowing doesn't follow
    // that across the closure boundary, so re-assert the declared (nullable)
    // types here rather than the (incorrectly) narrowed one.
    const finishedBrowser = browser as Browser | null
    const finishedContext = context as BrowserContext | null
    const disconnected = finishedBrowser != null && !finishedBrowser.isConnected()
    if (finishedContext) {
      await withTimeout(finishedContext.close().catch(() => {}), CONTEXT_CLOSE_TIMEOUT_MS, () => undefined)
    }
    if (isTimeout || disconnected) await recycleBrowser()
    throw err
  }
}
