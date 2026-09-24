// Late-launch cleanup for an abandoned render, exercised end-to-end through the
// REAL browser.ts cache + render-composed.ts (only playwright-core is mocked).
// A render whose deadline fires during 'launch' still gets the launched bundle
// back afterwards; it must close it only when it's an orphan, never when it's
// the healthy cached bundle a queued render is already using
// (final-findings.md item 2).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const launchMock = vi.fn()

vi.mock('playwright-core', () => ({
  chromium: {
    launch: (...args: unknown[]) => launchMock(...args),
  },
}))

const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')

function fakeBrowser() {
  let connected = true
  const page = {
    setDefaultTimeout: vi.fn(),
    on: vi.fn(),
    isClosed: vi.fn(() => !connected),
    setViewportSize: vi.fn(async () => undefined),
    setContent: vi.fn(async () => undefined),
    waitForLoadState: vi.fn(async () => undefined),
    evaluate: vi.fn(async () => 0),
    locator: vi.fn(() => ({ first: () => ({ count: async () => 0 }) })),
  }
  const cdp = {
    send: vi.fn(async (method: string) => (method === 'Page.captureScreenshot' ? { data: PNG_B64 } : {})),
  }
  const context = {
    route: vi.fn(async () => undefined),
    newPage: vi.fn(async () => page),
    newCDPSession: vi.fn(async () => cdp),
    close: vi.fn(async () => undefined),
  }
  return {
    page,
    cdp,
    context,
    isConnected: vi.fn(() => connected),
    disconnect: () => {
      connected = false
    },
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => {
      connected = false
    }),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const ARGS = { html: '<html><head></head><body>x</body></html>', shellOrigin: 'https://example.invalid/', viewport: 'desktop' as const }

async function catchErr(p: Promise<unknown>): Promise<Error> {
  try {
    await p
  } catch (err) {
    return err as Error
  }
  throw new Error('expected rejection')
}

beforeEach(() => {
  vi.resetModules()
  launchMock.mockReset()
  process.env.CHROMIUM_EXECUTABLE_PATH = '/fake/chrome'
  delete process.env.CHROMIUM_EXTRA_ARGS
  delete process.env.VERCEL
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  delete process.env.CHROMIUM_EXECUTABLE_PATH
  vi.restoreAllMocks()
})

describe('abandoned render with a late launch (real browser cache, mocked playwright)', () => {
  it('stale cache → slow relaunch → deadline in "launch": the new cached bundle a queued render acquires is NOT closed', async () => {
    const { renderComposed } = await import('./render-composed')

    // Warm the cache with b1, then make it stale.
    const b1 = fakeBrowser()
    launchMock.mockResolvedValueOnce(b1)
    await renderComposed(ARGS)
    b1.disconnect()

    // Render A: getRenderPage() sees the stale bundle, relaunches slowly; A's
    // deadline fires while still in 'launch'.
    const b2 = fakeBrowser()
    const slow = deferred<ReturnType<typeof fakeBrowser>>()
    launchMock.mockReturnValueOnce(slow.promise)
    const errA = await catchErr(renderComposed({ ...ARGS, deadlineMs: 150 }))
    expect(errA.name).toBe('RenderTimeoutError')
    expect(errA.message).toContain('"launch"')

    // Render B takes the lock and waits on the same in-flight relaunch.
    const renderB = renderComposed({ ...ARGS, deadlineMs: 5_000 })
    await sleep(20)
    slow.resolve(b2)

    await expect(renderB).resolves.toMatchObject({ shots: [{ kind: 'fold' }] })
    await sleep(20) // let A's abandoned body finish its late-launch cleanup
    expect(b2.close).not.toHaveBeenCalled()
    expect(b2.isConnected()).toBe(true)

    // The cache still holds b2: the next render reuses it without relaunching.
    await expect(renderComposed(ARGS)).resolves.toMatchObject({ shots: [{ kind: 'fold' }] })
    expect(launchMock).toHaveBeenCalledTimes(2)
    expect(b2.close).not.toHaveBeenCalled()
    expect(b2.context.newPage).toHaveBeenCalledTimes(1)
  }, 10_000)

  it('an orphan late bundle (no longer cached) IS closed, exactly once', async () => {
    const { renderComposed } = await import('./render-composed')

    // Cold start: A's snapshot is the fresh launch promise, so its timeout
    // path clears the cache; the launch then lands with nobody holding it.
    const late = fakeBrowser()
    const slow = deferred<ReturnType<typeof fakeBrowser>>()
    launchMock.mockReturnValueOnce(slow.promise)
    const renderA = catchErr(renderComposed({ ...ARGS, deadlineMs: 150 }))
    await sleep(250)
    slow.resolve(late)
    const errA = await renderA
    expect(errA.message).toContain('"launch"')
    await sleep(20)

    expect(late.close).toHaveBeenCalledTimes(1)
    expect(late.page.setContent).not.toHaveBeenCalled()

    // Nothing cached: the next render launches a fresh browser.
    const next = fakeBrowser()
    launchMock.mockResolvedValueOnce(next)
    await expect(renderComposed(ARGS)).resolves.toMatchObject({ shots: [{ kind: 'fold' }] })
    expect(launchMock).toHaveBeenCalledTimes(2)
    expect(late.close).toHaveBeenCalledTimes(1)
  }, 10_000)
})
