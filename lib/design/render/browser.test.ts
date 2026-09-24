// Unit tests for the single-flight warm-browser relaunch logic in getBrowser().
// No real Chromium is needed — playwright-core's chromium.launch is mocked so
// we can control exactly when each "launch" settles and assert how many
// times it was actually called under concurrent callers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Browser } from 'playwright-core'

const launchMock = vi.fn()

vi.mock('playwright-core', () => ({
  chromium: {
    launch: (...args: unknown[]) => launchMock(...args),
  },
}))

// Kept untyped (not cast to Browser) so call sites can still reach the mock
// methods directly (e.g. `.isConnected.mockReturnValue(...)`); cast with
// `asBrowser()` below only at the call sites that hand one to a
// Browser-typed parameter (recycleBrowser's `target`).
function fakeBrowser(connected: boolean) {
  return {
    isConnected: vi.fn(() => connected),
    close: vi.fn(() => Promise.resolve()),
  }
}

function asBrowser(fake: ReturnType<typeof fakeBrowser>): Browser {
  return fake as unknown as Browser
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

describe('getBrowser (mocked playwright-core)', () => {
  beforeEach(() => {
    vi.resetModules()
    launchMock.mockReset()
    process.env.CHROMIUM_EXECUTABLE_PATH = '/fake/chrome'
    delete process.env.VERCEL
  })

  afterEach(() => {
    delete process.env.CHROMIUM_EXECUTABLE_PATH
  })

  it('cold start: two concurrent callers produce exactly one launch and share the browser', async () => {
    const good = fakeBrowser(true)
    const d = deferred<ReturnType<typeof fakeBrowser>>()
    launchMock.mockReturnValueOnce(d.promise)
    const { getBrowser } = await import('./browser')

    const p1 = getBrowser()
    const p2 = getBrowser()
    d.resolve(good)
    const [b1, b2] = await Promise.all([p1, p2])

    expect(launchMock).toHaveBeenCalledTimes(1)
    expect(b1).toBe(good)
    expect(b2).toBe(good)
  })

  it('disconnected browser: two concurrent callers trigger exactly one relaunch', async () => {
    const stale = fakeBrowser(false)
    const fresh = fakeBrowser(true)
    launchMock.mockResolvedValueOnce(stale).mockResolvedValueOnce(fresh)
    const { getBrowser } = await import('./browser')

    // Warm the module state with the (already-disconnected) stale browser.
    const first = await getBrowser()
    expect(first).toBe(stale)
    expect(launchMock).toHaveBeenCalledTimes(1)

    // Two concurrent callers both observe the disconnected browser and race
    // to relaunch — only one of them should actually call launch() again;
    // the other must piggyback on that same in-flight promise.
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

  it('a rejected launch only clears browserPromise if it is still the current one (no double relaunch after failure)', async () => {
    // Regression guard for the identity check in the catch block: even when
    // a failed launch's rejection and a concurrent recursive retry interleave,
    // exactly one successful relaunch should occur — never two extra ones.
    const stale = fakeBrowser(false)
    const good = fakeBrowser(true)
    launchMock.mockResolvedValueOnce(stale).mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(good)
    const { getBrowser } = await import('./browser')

    const first = await getBrowser()
    expect(first).toBe(stale)

    const results = await Promise.allSettled([getBrowser(), getBrowser()])
    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')

    // One of the two concurrent callers takes the failing relaunch and
    // rejects; the other observes the failure, sees browserPromise was
    // cleared (it was still theirs to clear), and successfully relaunches.
    expect(rejected).toHaveLength(1)
    expect(fulfilled).toHaveLength(1)
    expect(launchMock).toHaveBeenCalledTimes(3)
  })

  it('recycleBrowser(target) clears the cached browser so the next getBrowser() relaunches exactly once', async () => {
    const first = fakeBrowser(true)
    const second = fakeBrowser(true)
    launchMock.mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const { getBrowser, recycleBrowser } = await import('./browser')

    const b1 = await getBrowser()
    expect(b1).toBe(first)
    expect(launchMock).toHaveBeenCalledTimes(1)

    await recycleBrowser(asBrowser(first))
    expect(first.close).toHaveBeenCalled()

    // Even though `first` still reports isConnected() === true, recycling
    // must force a fresh launch rather than reusing it — a browser that just
    // served a timed-out render can't be trusted by that heuristic alone.
    const b2 = await getBrowser()
    expect(b2).toBe(second)
    expect(launchMock).toHaveBeenCalledTimes(2)
  })

  it('recycleBrowser() with no target is a no-op (never clears or closes anything)', async () => {
    const first = fakeBrowser(true)
    launchMock.mockResolvedValueOnce(first)
    const { getBrowser, recycleBrowser } = await import('./browser')

    await getBrowser()
    await expect(recycleBrowser()).resolves.toBeUndefined()
    expect(first.close).not.toHaveBeenCalled()

    // The cache is untouched — a second getBrowser() reuses `first`, no relaunch.
    const b2 = await getBrowser()
    expect(b2).toBe(first)
    expect(launchMock).toHaveBeenCalledTimes(1)
  })

  it('recycleBrowser(target) does not hang if close() never resolves (bounded best-effort)', async () => {
    const stuck = { isConnected: vi.fn(() => true), close: vi.fn(() => new Promise(() => {})) }
    launchMock.mockResolvedValueOnce(stuck)
    const { getBrowser, recycleBrowser } = await import('./browser')

    const b = await getBrowser()
    await expect(recycleBrowser(b)).resolves.toBeUndefined()
  })

  it('recycleBrowser(X) after the cache moved to Y: Y stays cached and is not closed, X is closed', async () => {
    // The exact concurrency bug this round fixes: a late recycle call for a
    // FAILED render's own browser (X) must not touch a DIFFERENT, healthy
    // browser (Y) some other concurrent request has since cached.
    const x = fakeBrowser(false) // X went stale/disconnected from request A's point of view
    const y = fakeBrowser(true) // request B already relaunched to Y in the meantime
    launchMock.mockResolvedValueOnce(x).mockResolvedValueOnce(y)
    const { getBrowser, recycleBrowser } = await import('./browser')

    await getBrowser() // caches X
    // Simulate request B's own relaunch (X disconnected ⇒ getBrowser() relaunches to Y).
    const b = await getBrowser()
    expect(b).toBe(y)
    expect(launchMock).toHaveBeenCalledTimes(2)

    // Request A's late recycle call, still holding its OWN reference to X.
    await recycleBrowser(asBrowser(x))

    expect(x.close).toHaveBeenCalled()
    expect(y.close).not.toHaveBeenCalled()
    // The cache must still hold Y — a subsequent getBrowser() must NOT relaunch.
    const stillY = await getBrowser()
    expect(stillY).toBe(y)
    expect(launchMock).toHaveBeenCalledTimes(2)
  })

  it('recycleIfStill(snapshot) with a stale snapshot leaves the cache untouched', async () => {
    const stale = fakeBrowser(true)
    const fresh = fakeBrowser(true)
    launchMock.mockResolvedValueOnce(stale).mockResolvedValueOnce(fresh)
    const { getBrowser, currentBrowserPromise, recycleIfStill } = await import('./browser')

    expect(currentBrowserPromise()).toBeNull() // nothing launched yet

    await getBrowser() // caches `stale`
    const snapshotFromFirstLaunch = currentBrowserPromise()

    // Force a relaunch (simulating a DIFFERENT, later request's own getBrowser()
    // call moving the cache on to `fresh`) — the snapshot above is now stale.
    stale.isConnected.mockReturnValue(false)
    const b = await getBrowser()
    expect(b).toBe(fresh)
    expect(launchMock).toHaveBeenCalledTimes(2)

    // recycleIfStill with the OLD snapshot (from before the relaunch) must
    // be a no-op — it must not clear the cache out from under `fresh`.
    await recycleIfStill(snapshotFromFirstLaunch)
    const stillFresh = await getBrowser()
    expect(stillFresh).toBe(fresh)
    expect(launchMock).toHaveBeenCalledTimes(2)
  })

  it('recycleIfStill(snapshot) clears the cache when it still holds that exact promise', async () => {
    const first = fakeBrowser(true)
    const second = fakeBrowser(true)
    launchMock.mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const { getBrowser, currentBrowserPromise, recycleIfStill } = await import('./browser')

    const call = getBrowser()
    const snapshot = currentBrowserPromise()
    await call

    await recycleIfStill(snapshot)
    const b = await getBrowser()
    expect(b).toBe(second)
    expect(launchMock).toHaveBeenCalledTimes(2)
  })
})
