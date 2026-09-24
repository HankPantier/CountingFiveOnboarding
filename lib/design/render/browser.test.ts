// Unit tests for the warm render bundle (browser + ONE context + ONE page)
// cached by browser.ts. No real Chromium is needed — playwright-core's
// chromium.launch is mocked so we can control exactly when each "launch"
// settles and assert how many browsers / contexts / pages were created under
// concurrent callers, recycles, and failed setups.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Browser, Page } from 'playwright-core'

const launchMock = vi.fn()

vi.mock('playwright-core', () => ({
  chromium: {
    launch: (...args: unknown[]) => launchMock(...args),
  },
}))

type RouteHandler = (route: FakeRoute) => unknown
type FakeRoute = { request: () => { url: () => string }; abort: ReturnType<typeof vi.fn>; continue: ReturnType<typeof vi.fn> }

function fakePage() {
  const listeners: Record<string, ((arg: unknown) => void)[]> = {}
  let closed = false
  return {
    listeners,
    setDefaultTimeout: vi.fn(),
    on: vi.fn((event: string, fn: (arg: unknown) => void) => {
      ;(listeners[event] ??= []).push(fn)
    }),
    isClosed: vi.fn(() => closed),
    markClosed: () => {
      closed = true
    },
  }
}

// Kept untyped (not cast to Browser) so call sites can still reach the mock
// methods directly; cast with `asBrowser()` only where a Browser-typed
// parameter is required (recycleBrowser's `target`).
function fakeBrowser(connected: boolean) {
  const page = fakePage()
  const cdp = { send: vi.fn(async () => ({})) }
  let routeHandler: RouteHandler | null = null
  const context = {
    route: vi.fn(async (_pattern: string, handler: RouteHandler) => {
      routeHandler = handler
    }),
    newPage: vi.fn(async () => page),
    newCDPSession: vi.fn(async () => cdp),
    close: vi.fn(async () => undefined),
  }
  return {
    page,
    cdp,
    context,
    route: (url: string) => {
      const r: FakeRoute = { request: () => ({ url: () => url }), abort: vi.fn(async () => undefined), continue: vi.fn(async () => undefined) }
      if (!routeHandler) throw new Error('no route handler installed')
      routeHandler(r)
      return r
    },
    isConnected: vi.fn(() => connected),
    newContext: vi.fn(async () => context),
    close: vi.fn(() => Promise.resolve()),
  }
}

function asBrowser(fake: ReturnType<typeof fakeBrowser>): Browser {
  return fake as unknown as Browser
}

function asPage(fake: ReturnType<typeof fakeBrowser>): Page {
  return fake.page as unknown as Page
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('getRenderPage / getBrowser (mocked playwright-core)', () => {
  beforeEach(() => {
    vi.resetModules()
    launchMock.mockReset()
    process.env.CHROMIUM_EXECUTABLE_PATH = '/fake/chrome'
    delete process.env.CHROMIUM_EXTRA_ARGS
    delete process.env.VERCEL
  })

  afterEach(() => {
    delete process.env.CHROMIUM_EXECUTABLE_PATH
    delete process.env.CHROMIUM_EXTRA_ARGS
  })

  it('cold start: two concurrent callers produce exactly one launch, one context, one page', async () => {
    const good = fakeBrowser(true)
    const d = deferred<ReturnType<typeof fakeBrowser>>()
    launchMock.mockReturnValueOnce(d.promise)
    const { getRenderPage } = await import('./browser')

    const p1 = getRenderPage()
    const p2 = getRenderPage()
    d.resolve(good)
    const [b1, b2] = await Promise.all([p1, p2])

    expect(launchMock).toHaveBeenCalledTimes(1)
    expect(good.newContext).toHaveBeenCalledTimes(1)
    expect(good.newContext).toHaveBeenCalledWith(
      expect.objectContaining({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
    )
    expect(good.context.route).toHaveBeenCalledTimes(1)
    expect(good.context.newPage).toHaveBeenCalledTimes(1)
    expect(good.context.newCDPSession).toHaveBeenCalledTimes(1)
    expect(b1).toBe(b2)
    expect(b1.browser).toBe(good)
    expect(b1.page).toBe(good.page)
    expect(b1.cdp).toBe(good.cdp)
  })

  it('warm reuse: repeated calls never create another context or page', async () => {
    const good = fakeBrowser(true)
    launchMock.mockResolvedValueOnce(good)
    const { getRenderPage } = await import('./browser')

    for (let i = 0; i < 5; i++) await getRenderPage()

    expect(launchMock).toHaveBeenCalledTimes(1)
    expect(good.newContext).toHaveBeenCalledTimes(1)
    expect(good.context.newPage).toHaveBeenCalledTimes(1)
    expect(good.context.close).not.toHaveBeenCalled()
  })

  it('a closed page counts as stale: the next call relaunches the whole bundle', async () => {
    const first = fakeBrowser(true)
    const second = fakeBrowser(true)
    launchMock.mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const { getRenderPage } = await import('./browser')

    await getRenderPage()
    first.page.markClosed()
    const b = await getRenderPage()

    expect(b.browser).toBe(second)
    expect(first.close).toHaveBeenCalled()
    expect(launchMock).toHaveBeenCalledTimes(2)
  })

  it('getBrowser() still returns the bundle browser (thin wrapper)', async () => {
    const good = fakeBrowser(true)
    launchMock.mockResolvedValueOnce(good)
    const { getBrowser } = await import('./browser')
    expect(await getBrowser()).toBe(good)
  })

  it('disconnected browser: two concurrent callers trigger exactly one relaunch', async () => {
    const stale = fakeBrowser(false)
    const fresh = fakeBrowser(true)
    launchMock.mockResolvedValueOnce(stale).mockResolvedValueOnce(fresh)
    const { getBrowser } = await import('./browser')

    const first = await getBrowser()
    expect(first).toBe(stale)
    expect(launchMock).toHaveBeenCalledTimes(1)

    const [b1, b2] = await Promise.all([getBrowser(), getBrowser()])

    expect(launchMock).toHaveBeenCalledTimes(2)
    expect(b1).toBe(fresh)
    expect(b2).toBe(fresh)
    expect(stale.close).toHaveBeenCalled()
  })

  it('a rejected launch does not poison later calls (a fresh call launches again and succeeds)', async () => {
    const good = fakeBrowser(true)
    launchMock.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(good)
    const { getBrowser } = await import('./browser')

    await expect(getBrowser()).rejects.toThrow('boom')
    const b = await getBrowser()

    expect(b).toBe(good)
    expect(launchMock).toHaveBeenCalledTimes(2)
  })

  it('a failed context/page setup closes the just-launched browser and does not poison later calls', async () => {
    const broken = fakeBrowser(true)
    broken.context.newPage.mockRejectedValueOnce(new Error('newPage failed'))
    const good = fakeBrowser(true)
    launchMock.mockResolvedValueOnce(broken).mockResolvedValueOnce(good)
    const { getRenderPage } = await import('./browser')

    await expect(getRenderPage()).rejects.toThrow('newPage failed')
    expect(broken.close).toHaveBeenCalled()
    const b = await getRenderPage()
    expect(b.browser).toBe(good)
  })

  it('a rejected launch only clears the cache if it is still the current one (no double relaunch after failure)', async () => {
    const stale = fakeBrowser(false)
    const good = fakeBrowser(true)
    launchMock.mockResolvedValueOnce(stale).mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(good)
    const { getBrowser } = await import('./browser')

    const first = await getBrowser()
    expect(first).toBe(stale)

    const results = await Promise.allSettled([getBrowser(), getBrowser()])
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(launchMock).toHaveBeenCalledTimes(3)
  })

  it('recycleBrowser(target) clears the cached bundle so the next call relaunches exactly once', async () => {
    const first = fakeBrowser(true)
    const second = fakeBrowser(true)
    launchMock.mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const { getRenderPage, recycleBrowser } = await import('./browser')

    const b1 = await getRenderPage()
    expect(b1.browser).toBe(first)

    await recycleBrowser(asBrowser(first))
    expect(first.close).toHaveBeenCalled()

    // Even though `first` still reports isConnected() === true, recycling
    // must force a fresh launch (new browser, new context, new page).
    const b2 = await getRenderPage()
    expect(b2.browser).toBe(second)
    expect(second.context.newPage).toHaveBeenCalledTimes(1)
    expect(launchMock).toHaveBeenCalledTimes(2)
  })

  it('recycleBrowser() with no target is a no-op (never clears or closes anything)', async () => {
    const first = fakeBrowser(true)
    launchMock.mockResolvedValueOnce(first)
    const { getBrowser, recycleBrowser } = await import('./browser')

    await getBrowser()
    await expect(recycleBrowser()).resolves.toBeUndefined()
    expect(first.close).not.toHaveBeenCalled()

    const b2 = await getBrowser()
    expect(b2).toBe(first)
    expect(launchMock).toHaveBeenCalledTimes(1)
  })

  it('recycleBrowser(target) does not hang if close() never resolves (bounded best-effort)', async () => {
    const stuck = fakeBrowser(true)
    stuck.close.mockImplementation(() => new Promise(() => {}))
    launchMock.mockResolvedValueOnce(stuck)
    const { getBrowser, recycleBrowser } = await import('./browser')

    const b = await getBrowser()
    await expect(recycleBrowser(b)).resolves.toBeUndefined()
  })

  it('recycleBrowser(X) after the cache moved to Y: Y stays cached and is not closed, X is closed', async () => {
    const x = fakeBrowser(false)
    const y = fakeBrowser(true)
    launchMock.mockResolvedValueOnce(x).mockResolvedValueOnce(y)
    const { getBrowser, recycleBrowser } = await import('./browser')

    await getBrowser() // caches X
    const b = await getBrowser() // X disconnected ⇒ relaunch to Y
    expect(b).toBe(y)

    await recycleBrowser(asBrowser(x))

    expect(x.close).toHaveBeenCalled()
    expect(y.close).not.toHaveBeenCalled()
    expect(await getBrowser()).toBe(y)
    expect(launchMock).toHaveBeenCalledTimes(2)
  })

  it('recycleIfStill(snapshot) with a stale snapshot leaves the cache untouched', async () => {
    const stale = fakeBrowser(true)
    const fresh = fakeBrowser(true)
    launchMock.mockResolvedValueOnce(stale).mockResolvedValueOnce(fresh)
    const { getBrowser, currentBrowserPromise, recycleIfStill } = await import('./browser')

    expect(currentBrowserPromise()).toBeNull()

    await getBrowser()
    const snapshotFromFirstLaunch = currentBrowserPromise()

    stale.isConnected.mockReturnValue(false)
    expect(await getBrowser()).toBe(fresh)

    await recycleIfStill(snapshotFromFirstLaunch)
    expect(await getBrowser()).toBe(fresh)
    expect(launchMock).toHaveBeenCalledTimes(2)
  })

  it('recycleIfStill(snapshot) clears the cache when it still holds that exact promise', async () => {
    const first = fakeBrowser(true)
    const second = fakeBrowser(true)
    launchMock.mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const { getRenderPage, currentBrowserPromise, recycleIfStill } = await import('./browser')

    const call = getRenderPage()
    const snapshot = currentBrowserPromise()
    await call

    await recycleIfStill(snapshot)
    expect(first.close).toHaveBeenCalled()
    const b = await getRenderPage()
    expect(b.browser).toBe(second)
    expect(launchMock).toHaveBeenCalledTimes(2)
  })

  it('local mode appends CHROMIUM_EXTRA_ARGS to the launch args', async () => {
    process.env.CHROMIUM_EXTRA_ARGS = '--single-process  --no-zygote'
    launchMock.mockResolvedValueOnce(fakeBrowser(true))
    const { getRenderPage } = await import('./browser')
    await getRenderPage()
    expect(launchMock).toHaveBeenCalledWith(expect.objectContaining({ args: ['--single-process', '--no-zygote'] }))
  })
})

describe('per-render request policy on the shared context (mocked playwright-core)', () => {
  beforeEach(() => {
    vi.resetModules()
    launchMock.mockReset()
    process.env.CHROMIUM_EXECUTABLE_PATH = '/fake/chrome'
    delete process.env.VERCEL
  })

  afterEach(() => {
    delete process.env.CHROMIUM_EXECUTABLE_PATH
  })

  it('aborts every request when no render is active', async () => {
    const b = fakeBrowser(true)
    launchMock.mockResolvedValueOnce(b)
    const { getRenderPage } = await import('./browser')
    await getRenderPage()

    const r = b.route('https://example.invalid/app.css')
    expect(r.abort).toHaveBeenCalled()
    expect(r.continue).not.toHaveBeenCalled()
  })

  it('applies the active render origin + cap and counts blocks (route aborts + CSP requestfailed) on that render only', async () => {
    const b = fakeBrowser(true)
    launchMock.mockResolvedValueOnce(b)
    const { getRenderPage, beginRenderRequests, endRenderRequests } = await import('./browser')
    const { MAX_RENDER_REQUESTS } = await import('./harden')
    await getRenderPage()

    const state = beginRenderRequests('https://example.invalid/', asPage(b))
    expect(b.route('https://example.invalid/app.css').continue).toHaveBeenCalled()
    expect(b.route('https://evil.test/x.png').abort).toHaveBeenCalled()
    expect(state.blocked).toBe(1)

    // A CSP-refused fetch surfaces as page 'requestfailed' with errorText 'csp'.
    for (const fn of b.page.listeners.requestfailed ?? []) fn({ failure: () => ({ errorText: 'csp' }) })
    for (const fn of b.page.listeners.requestfailed ?? []) fn({ failure: () => ({ errorText: 'net::ERR_ABORTED' }) })
    expect(state.blocked).toBe(2)

    for (let i = state.requestCount; i < MAX_RENDER_REQUESTS; i++) b.route('https://example.invalid/a.css')
    expect(b.route('https://example.invalid/over-cap.css').abort).toHaveBeenCalled()
    expect(state.blocked).toBe(3)

    endRenderRequests(state)
    expect(b.route('https://example.invalid/app.css').abort).toHaveBeenCalled()
    for (const fn of b.page.listeners.requestfailed ?? []) fn({ failure: () => ({ errorText: 'csp' }) })
    expect(state.blocked).toBe(3) // nothing attributed after the render ended
  })

  it('endRenderRequests(stale) never clears a newer render state', async () => {
    const b = fakeBrowser(true)
    launchMock.mockResolvedValueOnce(b)
    const { getRenderPage, beginRenderRequests, endRenderRequests } = await import('./browser')
    await getRenderPage()

    const old = beginRenderRequests('https://old.invalid/', asPage(b))
    const current = beginRenderRequests('https://example.invalid/', asPage(b))
    endRenderRequests(old)
    expect(b.route('https://example.invalid/app.css').continue).toHaveBeenCalled()
    expect(current.requestCount).toBe(1)
  })

  it('requests from a stale (recycled-but-not-closed) bundle page are aborted and not counted against the active render', async () => {
    const stale = fakeBrowser(true)
    const current = fakeBrowser(true)
    launchMock.mockResolvedValueOnce(stale).mockResolvedValueOnce(current)
    const { getRenderPage, recycleBrowser, beginRenderRequests } = await import('./browser')

    await getRenderPage()
    // The fake close() resolves without killing anything, so the stale page's
    // handlers are still live — exactly the wedged-browser case.
    await recycleBrowser(asBrowser(stale))
    const b = await getRenderPage()
    expect(b.browser).toBe(current)

    const state = beginRenderRequests('https://example.invalid/', asPage(current))

    const fromStale = stale.route('https://example.invalid/app.css')
    expect(fromStale.abort).toHaveBeenCalled()
    expect(fromStale.continue).not.toHaveBeenCalled()
    for (const fn of stale.page.listeners.requestfailed ?? []) fn({ failure: () => ({ errorText: 'csp' }) })
    expect(state.requestCount).toBe(0)
    expect(state.blocked).toBe(0)

    expect(current.route('https://example.invalid/app.css').continue).toHaveBeenCalled()
    for (const fn of current.page.listeners.requestfailed ?? []) fn({ failure: () => ({ errorText: 'csp' }) })
    expect(state.requestCount).toBe(1)
    expect(state.blocked).toBe(1)
  })
})
