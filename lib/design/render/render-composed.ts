// Server-only. Render one composed Design Studio document (live page shell +
// draft theme CSS) at a viewport and return PNG screenshots:
//   desktop → the above-the-fold shot + up to 3 block crops (crops: true)
//   mobile  → the fold + the next viewport down (skipped if the page is too
//             short to differ meaningfully from the fold)
// Every network request is filtered through isAllowedRenderRequest and capped
// (the shared context route handler in browser.ts).
// The page's own per-origin CSP (harden.ts's buildRenderCsp) is now a full
// allowlist and enforces itself on every redirect hop — Chromium blocks a
// disallowed fetch (e.g. a foreign-origin <img>) at the CSP layer BEFORE it
// ever reaches Playwright's route() handler, so it never increments the
// route-based counter above. `blockedRequests` counts both layers so callers
// get one honest "how many things did we refuse to load" number regardless
// of which layer caught it.
//
// Gate-discovered defects (task-4-findings-gate*.md): @sparticuz/chromium
// runs with --single-process on Vercel, and in that mode repeatedly creating
// and closing BrowserContexts/pages intermittently wedges context.newPage()
// forever (gate round 3 root cause). So:
//   - browser.ts caches ONE context + ONE page per browser; every render
//     reuses that page. Viewport + DPR are applied per render through CDP
//     (Emulation.setDeviceMetricsOverride); the request allowlist/cap is a
//     single context.route() handler reading per-render state
//     (beginRenderRequests/endRenderRequests).
//   - Renders are serialized per instance by a FIFO mutex so the shared page
//     is never used concurrently. Time spent queued counts toward the
//     deadline (step 'queue').
//   - After the shots, the page is reset to a tiny idle document (bounded)
//     to release the rendered DOM. The page/context are never closed in the
//     success path; on ANY error or timeout the whole bundle is recycled
//     (identity-scoped, see browser.ts) so the next render gets a fresh
//     Chromium instead of a page in an unknown state.
//   - The whole render still races an explicit deadline (default 45s) with
//     per-step timings, so a hang reports which step was stuck.
import {
  CROP_SELECTORS,
  PAGE_TIMEOUT_MS,
  VIEWPORTS,
  hardenForRender,
  type ViewportKey,
} from './harden'
import {
  beginRenderRequests,
  currentBrowserPromise,
  endRenderRequests,
  getRenderPage,
  recycleBrowser,
  recycleIfStill,
  RenderTimeoutError,
  type RenderBundle,
  type RenderRequestState,
} from './browser'

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
// Bound for resetting the shared page to the idle document after a render.
// A reset that doesn't finish in time marks the bundle suspect (recycled
// after this render returns) but never fails a render that already has its
// shots.
const RESET_TIMEOUT_MS = 2_000
const IDLE_HTML = '<!doctype html><title>idle</title>'
const DEFAULT_DEADLINE_MS = 45_000

// Thrown inside an abandoned render body (its deadline already fired) at the
// next step boundary, so it stops touching the shared page. Never surfaces:
// the caller already received the RenderTimeoutError.
class RenderAbandonedError extends Error {
  constructor() {
    super('render abandoned after its deadline')
    this.name = 'RenderAbandonedError'
  }
}

// FIFO async mutex: at most one render uses the shared page at a time.
// Each acquirer chains onto the previous tail, so waiters are granted in
// arrival order. The returned release function is idempotent.
let lockTail: Promise<void> = Promise.resolve()
function acquireRenderLock(): Promise<() => void> {
  const prev = lockTail
  let releaseLock!: () => void
  const mine = new Promise<void>((resolve) => {
    releaseLock = resolve
  })
  lockTail = prev.then(() => mine)
  let released = false
  const release = () => {
    if (released) return
    released = true
    releaseLock()
  }
  return prev.then(() => release)
}

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

// Viewport-sized PNG of what's currently on screen, captured through the
// bundle's own CDP session — the one that carries this render's
// Emulation.setDeviceMetricsOverride. Playwright's page.screenshot() goes
// through ITS own CDP session, whose device metrics still say DPR 1, and
// would return a mobile fold at CSS size (390×844) instead of 780×1688.
async function captureViewport(cdp: RenderBundle['cdp']): Promise<Buffer> {
  const shot = await withTimeout(
    cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }),
    SCREENSHOT_TIMEOUT_MS,
    () => new Error(`Viewport screenshot did not finish within ${SCREENSHOT_TIMEOUT_MS}ms`)
  )
  return Buffer.from(shot.data, 'base64')
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
  // then starts the clock for `next`. `currentStep` is read directly by the
  // timeout/error handler, since the step in progress never got to call
  // mark() itself. Starts at 'queue' (waiting for the render mutex). Once
  // the deadline has fired, mark() throws so an abandoned body stops at its
  // next step boundary instead of continuing to drive the shared page.
  const steps: Record<string, number> = {}
  let currentStep = 'queue'
  let stepStart = t0
  let cancelled = false
  const mark = (next: string) => {
    steps[currentStep] = Date.now() - stepStart
    currentStep = next
    stepStart = Date.now()
    if (cancelled) throw new RenderAbandonedError()
  }

  let release: (() => void) | null = null
  let bundle: RenderBundle | null = null
  let requestState: RenderRequestState | null = null
  // Captured right after calling getRenderPage() (before awaiting it) so a
  // deadline that fires before it resolves can ask recycleIfStill() to clear
  // the cache ONLY if it still holds this exact promise.
  let bundleSnapshot: Promise<RenderBundle> | null = null
  // Set when the idle reset didn't complete: the render succeeded, but the
  // shared page is in an unknown state, so recycle it before the next one.
  let suspect = false

  const body = async (): Promise<RenderResult> => {
    const granted = await acquireRenderLock()
    if (cancelled) {
      // Our deadline fired while we were queued — pass the lock straight on.
      granted()
      throw new RenderAbandonedError()
    }
    release = granted
    mark('launch')

    const bundleCall = getRenderPage()
    bundleSnapshot = currentBrowserPromise()
    const acquired = await bundleCall
    bundle = acquired
    const launchMs = Date.now() - stepStart
    mark('emulate')

    const { page, cdp } = acquired
    const vp = VIEWPORTS[args.viewport]
    // Playwright's own setViewportSize re-sends its device-metrics override
    // with the CONTEXT's deviceScaleFactor (1), so the CDP override with this
    // render's DPR must come after it.
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: vp.deviceScaleFactor,
      mobile: args.viewport === 'mobile',
    })
    mark('setContent')
    // Synchronously after mark() (which throws if abandoned), so an abandoned
    // body can never install its state over a newer render's.
    const reqs = beginRenderRequests(args.shellOrigin)
    requestState = reqs

    const shots: RenderShot[] = []
    // 'load' is the hard gate (bounded by PAGE_TIMEOUT_MS); network-idle
    // beyond 'load' is only a bounded best-effort wait (step 'settle').
    await page.setContent(hardenForRender(args.html, args.shellOrigin), { waitUntil: 'load', timeout: PAGE_TIMEOUT_MS })
    mark('settle')
    await page.waitForLoadState('networkidle', { timeout: SETTLE_WAIT_MS }).catch(() => {})
    mark('fonts')
    // CDP evaluate is not subject to the page CSP; wait for webfonts so type
    // renders, but bounded — a webfont that never resolves must not hang.
    await boundedEvaluate(page.evaluate(() => document.fonts.ready.then(() => undefined)), undefined)
    mark('fold')

    shots.push({ kind: 'fold', png: await captureViewport(cdp) })

    if (args.viewport === 'mobile') {
      mark('scroll')
      // A hung height check falls back to 0 (⇒ treated as "short") rather
      // than risking a further scroll+screenshot hang.
      const pageHeight = await boundedEvaluate(page.evaluate(() => document.documentElement.scrollHeight), 0)
      if (pageHeight > vp.height * NEXT_SHOT_HEIGHT_FACTOR) {
        await boundedEvaluate(page.evaluate((h) => window.scrollTo(0, h), vp.height), undefined)
        mark('next')
        shots.push({ kind: 'next', png: await captureViewport(cdp) })
      }
    } else if (args.crops) {
      // Element crops keep Playwright's locator screenshot: desktop is DPR 1,
      // which matches the context's own device metrics, so its session
      // captures at the right scale.
      for (const selector of CROP_SELECTORS) {
        if (shots.filter((s) => s.kind === 'block').length >= MAX_BLOCK_CROPS) break
        mark(`crop:${selector}`)
        const el = page.locator(selector).first()
        if ((await el.count()) === 0) continue
        shots.push({ kind: 'block', selector, png: await el.screenshot({ type: 'png', timeout: SCREENSHOT_TIMEOUT_MS }) })
      }
    }

    const blockedRequests = reqs.blocked
    mark('reset')
    endRenderRequests(reqs)
    // Release the rendered DOM (and reset scroll) without closing anything.
    const reset = await withTimeout(
      page.setContent(IDLE_HTML, { waitUntil: 'domcontentloaded', timeout: RESET_TIMEOUT_MS }).then(
        () => true,
        () => false
      ),
      RESET_TIMEOUT_MS,
      () => false
    )
    if (!reset) suspect = true
    steps[currentStep] = Date.now() - stepStart

    return { shots, timings: { launchMs, renderMs: Date.now() - t0 }, blockedRequests, steps }
  }

  try {
    const result = await withTimeout(body(), deadlineMs, () => {
      cancelled = true
      return new RenderTimeoutError(`Render timed out during step "${currentStep}" after ${deadlineMs}ms`)
    })
    const used = bundle as RenderBundle | null
    if (suspect && used) {
      console.warn('[design-render] idle reset did not finish; recycling the renderer', { steps })
      await recycleBrowser(used.browser)
    }
    return result
  } catch (err) {
    cancelled = true
    // Operational warning (not a debug log) — no secrets, just step names and durations.
    console.warn('[design-render] step timings', { step: currentStep, steps })
    const isTimeout = err instanceof RenderTimeoutError
    // `bundle`/`bundleSnapshot` are assigned inside the `body` closure — TS's
    // narrowing doesn't follow that, so re-assert the declared types here.
    const used = bundle as RenderBundle | null
    const snapshot = bundleSnapshot as Promise<RenderBundle> | null
    if (used) {
      // The shared page is in an unknown state after ANY failure — recycle
      // this render's own bundle (identity-scoped: never a newer one).
      await recycleBrowser(used.browser)
    } else if (isTimeout && snapshot) {
      // The deadline fired inside getRenderPage() itself (no bundle in hand).
      await recycleIfStill(snapshot)
    }
    // A timeout while still queued (no bundle, no snapshot) recycles
    // nothing: the holder's own deadline owns the page's fate.
    throw err
  } finally {
    endRenderRequests(requestState)
    // Released only after any recycle above, so the next queued render
    // starts on a fresh bundle rather than the one being torn down.
    const heldRelease = release as (() => void) | null
    heldRelease?.()
  }
}
