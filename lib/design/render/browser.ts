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

// Force the next getBrowser() call to launch a fresh Chromium process,
// regardless of what the current one reports via isConnected(). A browser
// that just timed out a render (e.g. wedged under @sparticuz/chromium's
// --single-process mode, which is known to be fragile across repeated
// contexts) may still self-report as "connected" even though it can no
// longer be trusted to serve another render — callers that know a render
// just timed out or errored on a disconnected browser call this explicitly
// rather than relying on getBrowser()'s own isConnected() heuristic.
export async function recycleBrowser(): Promise<void> {
  const current = browserPromise
  if (!current) return
  // Clear synchronously — no `await` between reading `current` and this
  // check — so we never clobber a promise a concurrent getBrowser() call has
  // already moved browserPromise on to (same identity discipline as above).
  if (browserPromise === current) browserPromise = null
  const existing = await current.catch(() => null)
  if (!existing) return
  await Promise.race([
    existing.close().catch(() => {}),
    new Promise<void>((resolve) => setTimeout(resolve, RECYCLE_CLOSE_TIMEOUT_MS)),
  ])
}

// Test-only: close the shared browser so vitest can exit cleanly.
export async function closeBrowserForTests(): Promise<void> {
  const b = browserPromise ? await browserPromise.catch(() => null) : null
  browserPromise = null
  await b?.close()
}
