// Server-only. One warm headless Chromium per function instance (Fluid compute
// reuses instances across requests, so relaunching per render would waste the
// 2–5 s cold start). Vercel → @sparticuz/chromium; local dev →
// CHROMIUM_EXECUTABLE_PATH (a local Chrome). Both are loaded lazily so
// importing this module never touches a native binary.
import { chromium, type Browser } from 'playwright-core'

export class RendererUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RendererUnavailableError'
  }
}

// Thrown by renderComposed() when the overall render deadline elapses. Lives
// here (next to RendererUnavailableError) even though the deadline race lives
// in render-composed.ts, so both renderer-error types have one home. The
// render route checks this by `err.name` rather than `instanceof` — the
// module is lazily `import()`-ed there, and a name check is robust either way.
export class RenderTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RenderTimeoutError'
  }
}

let browserPromise: Promise<Browser> | null = null

const RECYCLE_CLOSE_TIMEOUT_MS = 3_000

// Best-effort bounded wait: resolves with `fallback` if `promise` doesn't
// settle — or itself rejects — within `ms`. Every recycle path below is
// pure best-effort cleanup, never something that should propagate an error
// up past a render that's already failing for its own reason, so this never
// rejects (unlike render-composed.ts's own `withTimeout`, which needs to).
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

async function launch(): Promise<Browser> {
  const localPath = process.env.CHROMIUM_EXECUTABLE_PATH
  if (localPath) return chromium.launch({ executablePath: localPath, headless: true })
  if (process.env.VERCEL) {
    const sparticuz = (await import('@sparticuz/chromium')).default
    sparticuz.setGraphicsMode = false
    return chromium.launch({ args: sparticuz.args, executablePath: await sparticuz.executablePath(), headless: true })
  }
  throw new RendererUnavailableError('No Chromium available — set CHROMIUM_EXECUTABLE_PATH for local rendering.')
}

export async function getBrowser(): Promise<Browser> {
  // Snapshot the promise we're evaluating so we can tell, after awaiting it,
  // whether another concurrent caller has already replaced it — the whole
  // point of single-flight relaunch is that only ONE of N concurrent callers
  // who observe a disconnected browser actually launches a new one; the rest
  // piggyback on that same in-flight promise instead of each starting their
  // own Chromium process (which would leak N-1 orphaned browsers).
  const current = browserPromise
  if (current) {
    const existing = await current.catch(() => null)
    if (existing?.isConnected()) return existing
    // Stale or failed — best-effort close so it doesn't linger as an orphan
    // process; failure to close a browser that's already dead is expected.
    await existing?.close().catch(() => {})
    if (browserPromise !== current) {
      // Another caller already noticed the same thing and is relaunching
      // (or has already relaunched) — recurse to observe THEIR promise
      // rather than racing a second launch.
      return getBrowser()
    }
  }
  const p = launch()
  browserPromise = p
  try {
    return await p
  } catch (err) {
    // Only clear if nobody else has already moved browserPromise on (e.g. a
    // later caller's own launch attempt) — never clobber a newer promise.
    if (browserPromise === p) browserPromise = null
    throw err
  }
}

// Exposes the raw browserPromise reference — never a fresh async-call
// wrapper — so a caller about to invoke getBrowser() can remember exactly
// which in-flight/cached promise it started with. Call this IMMEDIATELY
// after invoking getBrowser() (but before awaiting its result): calling an
// async function runs its synchronous prefix right away, and getBrowser()'s
// own synchronous prefix (which, in the cold-start case, already assigns a
// fresh browserPromise) has therefore already run by the time its call
// expression returns a pending promise — so this reads the SAME promise
// getBrowser() itself is now working with. Used only by renderComposed's
// timeout path (see recycleIfStill below); everywhere else, callers just
// use the resolved Browser from recycleBrowser(target).
export function currentBrowserPromise(): Promise<Browser> | null {
  return browserPromise
}

// Force the next getBrowser() call to launch a fresh Chromium process —
// scoped to the SPECIFIC browser a failing render was using, never "clear
// whatever's cached right now." Under concurrency (e.g. several renders on
// one warm, reused Vercel Fluid-compute instance) a late recycle from one
// request must not close a DIFFERENT, already-relaunched, healthy browser
// another request is now relying on: if the shared cache still holds
// `target`, clear it too (so the next getBrowser() call relaunches);
// otherwise the cache has already moved on, so leave it alone and just
// best-effort close `target` directly. A browser that just timed out a
// render (e.g. wedged under @sparticuz/chromium's --single-process mode)
// may still self-report as "connected", so callers that know a render just
// timed out or errored on a disconnected browser call this explicitly
// rather than relying on getBrowser()'s own isConnected() heuristic.
export async function recycleBrowser(target?: Browser): Promise<void> {
  if (!target) return
  const current = browserPromise
  const existing = current ? await withFallback(current.catch(() => null), RECYCLE_CLOSE_TIMEOUT_MS, null) : null
  if (existing === target && browserPromise === current) browserPromise = null
  await withFallback(target.close().catch(() => {}), RECYCLE_CLOSE_TIMEOUT_MS, undefined)
}

// Variant for when a render's deadline fires WHILE it's still inside
// `await getBrowser()` itself (e.g. a launch that never settles) — so there
// is no resolved Browser to hand recycleBrowser() above. `snapshot` must be
// captured via currentBrowserPromise() right after calling getBrowser(),
// before awaiting it. Only clears the cache if it STILL holds that exact
// same promise — never a newer one some other concurrent request has
// already moved on to — and is otherwise a no-op (there's nothing of this
// render's to safely close: the underlying launch, if it ever settles, is
// what a later getBrowser() call would inherit or supersede on its own).
export async function recycleIfStill(snapshot: Promise<Browser> | null): Promise<void> {
  if (!snapshot || browserPromise !== snapshot) return
  browserPromise = null
  const existing = await withFallback(snapshot.catch(() => null), RECYCLE_CLOSE_TIMEOUT_MS, null)
  if (existing) await withFallback(existing.close().catch(() => {}), RECYCLE_CLOSE_TIMEOUT_MS, undefined)
}

// Test-only: close the shared browser so vitest can exit cleanly.
export async function closeBrowserForTests(): Promise<void> {
  const b = browserPromise ? await browserPromise.catch(() => null) : null
  browserPromise = null
  await b?.close()
}
