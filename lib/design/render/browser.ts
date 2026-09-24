// Server-only. One warm headless Chromium per function instance (Fluid compute
// reuses instances across requests, so relaunching per render would waste the
// 2–5 s cold start). Vercel → @sparticuz/chromium; local dev →
// CHROMIUM_EXECUTABLE_PATH (a local Chrome). Both are loaded lazily so
// importing this module never touches a native binary.
//
// Gate round 3 root cause (task-4-findings-gate-r3.md): @sparticuz/chromium
// REQUIRES --single-process on Vercel, and in single-process mode repeatedly
// creating/closing BrowserContexts + pages intermittently wedges
// context.newPage() forever. So a launch now creates ONE BrowserContext and
// ONE Page (plus one CDP session on it) and caches all of them together as a
// "render bundle"; renders reuse that page (per-render viewport/DPR via CDP
// emulation, per-render request policy via the module-level state below) and
// never create or close a context/page in the success path. A recycle closes
// the whole bundle (closing the browser closes its context and page).
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page, type Route } from 'playwright-core'
import { MAX_RENDER_REQUESTS, PAGE_TIMEOUT_MS, VIEWPORTS, isAllowedRenderRequest } from './harden'

export class RendererUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RendererUnavailableError'
  }
}

// Thrown by renderComposed() when the overall render deadline elapses. Lives
// here (next to RendererUnavailableError) so both renderer-error types have
// one home. The render route checks this by `err.name` rather than
// `instanceof` — the module is lazily `import()`-ed there.
export class RenderTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RenderTimeoutError'
  }
}

export type RenderBundle = {
  browser: Browser
  context: BrowserContext
  page: Page
  cdp: CDPSession
}

// ── Per-render request policy ────────────────────────────────────────────
// The context's route handler and the page's requestfailed listener are
// installed ONCE per bundle; both consult this mutable "current render"
// state, which renderComposed sets at the start of each render (under its
// render mutex, so there is at most one) and clears when it's done.
// Requests arriving while no render is active are aborted outright.
export type RenderRequestState = {
  // The bundle page this render drives. Each bundle's handlers only allow /
  // count requests when the active state belongs to THEIR page, so a stale
  // bundle (recycled, but whose close() hasn't taken effect yet) can never
  // load anything or skew the active render's counters.
  page: Page
  shellOrigin: string
  requestCount: number
  blocked: number
}

let activeRender: RenderRequestState | null = null

export function beginRenderRequests(shellOrigin: string, page: Page): RenderRequestState {
  const state: RenderRequestState = { page, shellOrigin, requestCount: 0, blocked: 0 }
  activeRender = state
  return state
}

// Identity-scoped: a late end from an abandoned (timed-out) render can never
// clear a newer render's state.
export function endRenderRequests(state: RenderRequestState | null): void {
  if (state && activeRender === state) activeRender = null
}

function handleRoute(route: Route, ownPage: Page): Promise<void> {
  const state = activeRender
  if (!state || state.page !== ownPage) return route.abort()
  state.requestCount++
  if (state.requestCount > MAX_RENDER_REQUESTS || !isAllowedRenderRequest(route.request().url(), state.shellOrigin)) {
    state.blocked++
    return route.abort()
  }
  return route.continue()
}

// A CSP-blocked fetch never reaches the route handler above (Chromium refuses
// it before dispatching it to the network layer) but does fire
// 'requestfailed' with this specific errorText — count it against the
// current render so `blockedRequests` covers both layers.
function handleRequestFailed(req: { failure(): { errorText: string } | null }, ownPage: Page): void {
  const state = activeRender
  if (state && state.page === ownPage && req.failure()?.errorText === 'csp') state.blocked++
}

// ── Bundle cache ─────────────────────────────────────────────────────────
let bundlePromise: Promise<RenderBundle> | null = null

const RECYCLE_CLOSE_TIMEOUT_MS = 3_000
// Bound for the post-launch setup (newContext/route/newPage/CDP). If it
// wedges, the just-launched browser is closed here rather than being left as
// an orphan nobody holds a reference to.
const SETUP_TIMEOUT_MS = 15_000

// Best-effort bounded wait: resolves with `fallback` if `promise` doesn't
// settle — or itself rejects — within `ms`. Never rejects.
function withFallback<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        clearTimeout(timer)
        resolve(fallback)
      }
    )
  })
}

// Browsers already asked to close. Several cleanup paths can reach the same
// browser (e.g. recycleIfStill's snapshot close AND an abandoned render's
// late-launch cleanup) — close each one only once.
const closing = new WeakSet<Browser>()

function closeBounded(browser: Browser): Promise<void> {
  if (closing.has(browser)) return Promise.resolve()
  closing.add(browser)
  return withFallback(browser.close().catch(() => {}), RECYCLE_CLOSE_TIMEOUT_MS, undefined)
}

// Local-only extra flags (space-separated), e.g.
// CHROMIUM_EXTRA_ARGS="--single-process --no-zygote" to reproduce the
// @sparticuz/chromium production mode against a local Chrome.
function localExtraArgs(): string[] {
  return (process.env.CHROMIUM_EXTRA_ARGS ?? '').split(/\s+/).filter(Boolean)
}

async function launchBrowser(): Promise<Browser> {
  const localPath = process.env.CHROMIUM_EXECUTABLE_PATH
  if (localPath) return chromium.launch({ executablePath: localPath, headless: true, args: localExtraArgs() })
  if (process.env.VERCEL) {
    const sparticuz = (await import('@sparticuz/chromium')).default
    sparticuz.setGraphicsMode = false
    return chromium.launch({ args: sparticuz.args, executablePath: await sparticuz.executablePath(), headless: true })
  }
  throw new RendererUnavailableError('No Chromium available — set CHROMIUM_EXECUTABLE_PATH for local rendering.')
}

async function setupBundle(browser: Browser): Promise<RenderBundle> {
  const context = await browser.newContext({
    viewport: { width: VIEWPORTS.desktop.width, height: VIEWPORTS.desktop.height },
    deviceScaleFactor: VIEWPORTS.desktop.deviceScaleFactor,
    serviceWorkers: 'block',
  })
  const page = await context.newPage()
  page.setDefaultTimeout(PAGE_TIMEOUT_MS)
  // Installed after the page exists (context routes apply to existing pages
  // too) so both handlers can be bound to this bundle's own page. The blank
  // initial page makes no requests before this point.
  await context.route('**/*', (route) => handleRoute(route, page))
  page.on('requestfailed', (req) => handleRequestFailed(req, page))
  const cdp = await context.newCDPSession(page)
  return { browser, context, page, cdp }
}

async function launchBundle(): Promise<RenderBundle> {
  const browser = await launchBrowser()
  const setup = setupBundle(browser)
  const timeout = new Error(`Renderer setup did not finish within ${SETUP_TIMEOUT_MS}ms`)
  const outcome = await withFallback<RenderBundle | Error>(
    setup.catch((err: unknown) => (err instanceof Error ? err : new Error(String(err)))),
    SETUP_TIMEOUT_MS,
    timeout
  )
  if (outcome instanceof Error) {
    await closeBounded(browser)
    throw outcome
  }
  return outcome
}

function isHealthy(bundle: RenderBundle): boolean {
  return bundle.browser.isConnected() && !bundle.page.isClosed()
}

export async function getRenderPage(): Promise<RenderBundle> {
  // Snapshot the promise we're evaluating so we can tell, after awaiting it,
  // whether another concurrent caller has already replaced it — only ONE of
  // N concurrent callers who observe a stale bundle actually relaunches; the
  // rest piggyback on that same in-flight promise (no orphaned Chromiums).
  const current = bundlePromise
  if (current) {
    const existing = await current.catch(() => null)
    if (existing && isHealthy(existing)) return existing
    // Stale or failed — best-effort close so it doesn't linger as an orphan.
    if (existing) await closeBounded(existing.browser)
    if (bundlePromise !== current) return getRenderPage()
  }
  const p = launchBundle()
  bundlePromise = p
  try {
    return await p
  } catch (err) {
    // Only clear if nobody else has already moved the cache on.
    if (bundlePromise === p) bundlePromise = null
    throw err
  }
}

// Thin wrapper kept for callers that only need the Browser.
export async function getBrowser(): Promise<Browser> {
  return (await getRenderPage()).browser
}

// Exposes the raw cached promise reference — never a fresh wrapper — so a
// caller about to await getRenderPage() can remember which in-flight/cached
// promise it started with. Call this IMMEDIATELY after invoking
// getRenderPage() (before awaiting it). CAVEAT: this is only the NEW launch
// promise on a cold start (empty cache — getRenderPage assigns it
// synchronously). When the cache holds a bundle, getRenderPage first awaits
// that bundle's health check, so the snapshot is the OLD cached promise even
// if it turns out stale and a relaunch replaces it afterwards; recycleIfStill
// then correctly does nothing (the cache has moved on) and the late-landing
// bundle is handled by releaseAbandonedBundle below instead. Used only by
// renderComposed's timeout path.
export function currentBrowserPromise(): Promise<RenderBundle> | null {
  return bundlePromise
}

// Force the next getRenderPage() to launch a fresh bundle — scoped to the
// SPECIFIC browser a failing render was using. If the cache still holds that
// browser's bundle, clear it; otherwise the cache has already moved on to a
// different, healthy bundle another request relies on, so leave it alone and
// just best-effort close `target`. Closing the browser closes its context
// and page with it.
export async function recycleBrowser(target?: Browser): Promise<void> {
  if (!target) return
  const current = bundlePromise
  const existing = current ? await withFallback(current.catch(() => null), RECYCLE_CLOSE_TIMEOUT_MS, null) : null
  if (existing?.browser === target && bundlePromise === current) bundlePromise = null
  await closeBounded(target)
}

// Variant for when a render's deadline fires WHILE it's still inside
// `await getRenderPage()` (no resolved bundle in hand). Only clears the
// cache if it STILL holds that exact snapshot — never a newer one.
export async function recycleIfStill(snapshot: Promise<RenderBundle> | null): Promise<void> {
  if (!snapshot || bundlePromise !== snapshot) return
  bundlePromise = null
  const existing = await withFallback(snapshot.catch(() => null), RECYCLE_CLOSE_TIMEOUT_MS, null)
  if (existing) await closeBounded(existing.browser)
}

// For a render whose deadline fired while its getRenderPage() was in flight
// and which got the bundle back only afterwards. If that bundle is the one
// currently cached AND healthy, it is the warm browser other renders (e.g.
// one queued behind the abandoned render, which awaited the same launch)
// are using — leave it alone. Otherwise it is an orphan (or a broken cached
// bundle): recycle it (clears the cache only if it's still cached, then a
// bounded close that is a no-op if another path already closed it).
export async function releaseAbandonedBundle(bundle: RenderBundle): Promise<void> {
  const current = bundlePromise
  const cached = current ? await withFallback(current.catch(() => null), RECYCLE_CLOSE_TIMEOUT_MS, null) : null
  if (cached === bundle && bundlePromise === current && isHealthy(bundle)) return
  await recycleBrowser(bundle.browser)
}

// Test-only: close the shared browser so vitest can exit cleanly.
export async function closeBrowserForTests(): Promise<void> {
  const b = bundlePromise ? await bundlePromise.catch(() => null) : null
  bundlePromise = null
  activeRender = null
  await b?.browser.close()
}
