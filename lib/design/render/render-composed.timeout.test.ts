// Deadline / recycle / mutex / shared-page behavior for renderComposed(),
// fully mocked — no real Chromium needed. Separate file from
// render-composed.test.ts because this one mocks './browser' entirely,
// which would otherwise clash with that file's real-Chromium integration
// tests sharing the same module registry.
import { beforeEach, describe, it, expect, vi } from 'vitest'

const { recycleMock, recycleIfStillMock, releaseAbandonedMock, FakeRenderTimeoutError, state } = vi.hoisted(() => {
  class FakeRenderTimeoutError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'RenderTimeoutError'
    }
  }
  return {
    recycleMock: vi.fn(async (_b?: unknown) => undefined),
    recycleIfStillMock: vi.fn(async (_s?: unknown) => undefined),
    releaseAbandonedMock: vi.fn(async (_b?: unknown) => undefined),
    FakeRenderTimeoutError,
    state: { current: null as null | { shellOrigin: string; requestCount: number; blocked: number } },
  }
})

const IDLE_MARKER = '<title>idle</title>'

type SetContentImpl = (html: string) => Promise<void>

function makeBundle(setContentImpl: SetContentImpl = async () => undefined) {
  const page = {
    setContent: vi.fn((html: string) => setContentImpl(html)),
    setViewportSize: vi.fn(async () => undefined),
    waitForLoadState: vi.fn(async () => undefined),
    evaluate: vi.fn(async () => 2000),
    screenshot: vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47])),
    locator: vi.fn(() => ({ first: () => ({ count: async () => 0 }) })),
    isClosed: vi.fn(() => false),
  }
  const context = { close: vi.fn(async () => undefined), newPage: vi.fn(), route: vi.fn() }
  const browser = { isConnected: vi.fn(() => true), newContext: vi.fn(), close: vi.fn() }
  const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')
  const cdp = {
    send: vi.fn(async (method: string, _params?: unknown) => (method === 'Page.captureScreenshot' ? { data: PNG_B64 } : {})),
  }
  return { browser, context, page, cdp }
}

let bundle = makeBundle()

vi.mock('./browser', () => ({
  getRenderPage: vi.fn(async () => bundle),
  currentBrowserPromise: vi.fn(() => null),
  recycleBrowser: recycleMock,
  recycleIfStill: recycleIfStillMock,
  releaseAbandonedBundle: releaseAbandonedMock,
  beginRenderRequests: vi.fn((shellOrigin: string) => {
    state.current = { shellOrigin, requestCount: 0, blocked: 0 }
    return state.current
  }),
  endRenderRequests: vi.fn((s: unknown) => {
    if (state.current === s) state.current = null
  }),
  RenderTimeoutError: FakeRenderTimeoutError,
}))

import { renderComposed } from './render-composed'
import { getRenderPage, currentBrowserPromise, endRenderRequests } from './browser'

const ARGS = { html: '<html><head></head><body>x</body></html>', shellOrigin: 'https://example.invalid/' }

async function catchErr(p: Promise<unknown>): Promise<unknown> {
  try {
    await p
  } catch (err) {
    return err
  }
  throw new Error('expected rejection')
}

beforeEach(() => {
  bundle = makeBundle()
  recycleMock.mockClear()
  recycleIfStillMock.mockClear()
  releaseAbandonedMock.mockClear()
  vi.mocked(endRenderRequests).mockClear()
})

describe('renderComposed deadline (mocked browser, no real Chromium)', () => {
  it('throws RenderTimeoutError within ~deadlineMs when a step hangs, and recycles the browser it was using', async () => {
    bundle = makeBundle(() => new Promise(() => {}))
    const t0 = Date.now()
    const caught = await catchErr(renderComposed({ ...ARGS, viewport: 'desktop', deadlineMs: 200 }))
    const elapsed = Date.now() - t0

    expect(caught).toBeInstanceOf(FakeRenderTimeoutError)
    expect((caught as Error).message).toMatch(/timed out during step "setContent"/)
    expect(elapsed).toBeLessThan(5_000)
    expect(recycleMock).toHaveBeenCalledTimes(1)
    expect(recycleMock).toHaveBeenCalledWith(bundle.browser)
    expect(recycleIfStillMock).not.toHaveBeenCalled()
    expect(vi.mocked(endRenderRequests)).toHaveBeenCalled()
  }, 10_000)

  it('reports a hang inside getRenderPage() itself as step "launch" and recycles via the snapshot', async () => {
    vi.mocked(getRenderPage).mockImplementationOnce(() => new Promise(() => {}))
    const snapshotToken = Symbol('snapshot') as unknown as ReturnType<typeof currentBrowserPromise>
    vi.mocked(currentBrowserPromise).mockReturnValueOnce(snapshotToken)

    const caught = await catchErr(renderComposed({ ...ARGS, viewport: 'desktop', deadlineMs: 200 }))

    expect(caught).toBeInstanceOf(FakeRenderTimeoutError)
    expect((caught as Error).message).toContain('"launch"')
    expect(recycleIfStillMock).toHaveBeenCalledWith(snapshotToken)
    expect(recycleMock).not.toHaveBeenCalled()
  }, 10_000)

  it('a launch that completes AFTER the deadline hands its late bundle to releaseAbandonedBundle exactly once, never drives it', async () => {
    let resolveLaunch!: (b: typeof bundle) => void
    // The fake bundle is structurally partial, so hand it back through an
    // untyped promise rather than claiming it's a full RenderBundle.
    vi.mocked(getRenderPage).mockImplementationOnce(
      () => new Promise<typeof bundle>((r) => (resolveLaunch = r)) as unknown as ReturnType<typeof getRenderPage>
    )

    const caught = await catchErr(renderComposed({ ...ARGS, viewport: 'desktop', deadlineMs: 150 }))
    expect((caught as Error).message).toContain('"launch"')
    expect(recycleMock).not.toHaveBeenCalled()

    const late = makeBundle()
    resolveLaunch(late)
    await new Promise((r) => setTimeout(r, 20))

    // Orphan-vs-cached decision (and the close) live in browser.ts — covered
    // end-to-end in render-composed.late-launch.test.ts.
    expect(releaseAbandonedMock).toHaveBeenCalledTimes(1)
    expect(releaseAbandonedMock).toHaveBeenCalledWith(late)
    expect(recycleMock).not.toHaveBeenCalled()
    expect(late.page.setContent).not.toHaveBeenCalled()
    expect(late.cdp.send).not.toHaveBeenCalled()
  }, 10_000)

  it('recycles the bundle after ANY render error, not just timeouts (shared page state is unknown)', async () => {
    bundle = makeBundle(async (html) => {
      if (!html.includes(IDLE_MARKER)) throw new Error('navigation failed')
    })
    const caught = await catchErr(renderComposed({ ...ARGS, viewport: 'desktop' }))
    expect((caught as Error).message).toBe('navigation failed')
    expect(recycleMock).toHaveBeenCalledWith(bundle.browser)
  })
})

describe('renderComposed on the shared page (mocked browser)', () => {
  it('success path: CDP emulation per viewport, idle reset, never closes the context/page, no recycle', async () => {
    const r = await renderComposed({ ...ARGS, viewport: 'mobile' })

    expect(bundle.page.setViewportSize).toHaveBeenCalledWith({ width: 390, height: 844 })
    expect(bundle.cdp.send).toHaveBeenCalledWith('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    })
    // Emulation lands AFTER Playwright's own setViewportSize (which would
    // otherwise reset the DPR to the context's 1).
    const vpOrder = bundle.page.setViewportSize.mock.invocationCallOrder[0]
    const cdpOrder = bundle.cdp.send.mock.invocationCallOrder[0]
    expect(cdpOrder).toBeGreaterThan(vpOrder)

    const htmls = bundle.page.setContent.mock.calls.map((c) => c[0])
    expect(htmls).toHaveLength(2)
    expect(htmls[1]).toContain(IDLE_MARKER)
    expect(bundle.context.close).not.toHaveBeenCalled()
    expect(bundle.context.newPage).not.toHaveBeenCalled()
    expect(bundle.browser.newContext).not.toHaveBeenCalled()
    expect(recycleMock).not.toHaveBeenCalled()
    expect(r.shots.map((s) => s.kind)).toEqual(['fold', 'next'])
    // Viewport shots go through the SAME CDP session that carries the DPR
    // override — Playwright's page.screenshot() uses its own session and
    // would capture at CSS size (390×844) instead of 780×1688.
    const captures = bundle.cdp.send.mock.calls.filter((c) => c[0] === 'Page.captureScreenshot')
    expect(captures).toHaveLength(2)
    expect(captures[0][1]).toMatchObject({ format: 'png', captureBeyondViewport: false })
    expect(bundle.page.screenshot).not.toHaveBeenCalled()
    for (const s of r.shots) expect(s.png.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true)
    expect(Object.keys(r.steps)).toEqual(expect.arrayContaining(['queue', 'launch', 'emulate', 'setContent', 'reset']))
    expect(r.steps).not.toHaveProperty('newContext')
    expect(r.steps).not.toHaveProperty('newPage')
  })

  it('desktop emulation uses mobile:false and DPR 1', async () => {
    await renderComposed({ ...ARGS, viewport: 'desktop' })
    expect(bundle.cdp.send).toHaveBeenCalledWith('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })
  })

  it('reports blockedRequests from the per-render request state', async () => {
    bundle = makeBundle(async (html) => {
      if (!html.includes(IDLE_MARKER) && state.current) state.current.blocked += 3
    })
    const r = await renderComposed({ ...ARGS, viewport: 'desktop' })
    expect(r.blockedRequests).toBe(3)
  })

  it('an idle-reset hang does not fail the render but recycles the bundle', async () => {
    bundle = makeBundle((html) => (html.includes(IDLE_MARKER) ? new Promise(() => {}) : Promise.resolve()))
    const r = await renderComposed({ ...ARGS, viewport: 'desktop' })
    expect(r.shots[0].kind).toBe('fold')
    expect(recycleMock).toHaveBeenCalledWith(bundle.browser)
  }, 10_000)
})

describe('renderComposed viewport capture bound (mocked browser)', () => {
  it('a hung CDP capture times out as a render error and recycles', async () => {
    bundle.cdp.send.mockImplementation(async (method: string) =>
      method === 'Page.captureScreenshot' ? new Promise(() => {}) : {}
    )
    const caught = await catchErr(renderComposed({ ...ARGS, viewport: 'desktop', deadlineMs: 500 }))
    expect((caught as Error).message).toMatch(/"fold"/)
    expect(recycleMock).toHaveBeenCalledWith(bundle.browser)
  }, 10_000)
})

describe('renderComposed render mutex (mocked browser)', () => {
  it('serializes concurrent renders on the shared page (never two in flight) and both succeed', async () => {
    let active = 0
    let maxActive = 0
    bundle = makeBundle(async (html) => {
      if (html.includes(IDLE_MARKER)) return
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 50))
      active--
    })
    const [a, b] = await Promise.all([
      renderComposed({ ...ARGS, viewport: 'desktop' }),
      renderComposed({ ...ARGS, viewport: 'mobile' }),
    ])
    expect(maxActive).toBe(1)
    expect(a.shots[0].kind).toBe('fold')
    expect(b.shots[0].kind).toBe('fold')
  })

  it('a queued render that cannot start before its deadline throws RenderTimeoutError step "queue" (no recycle)', async () => {
    vi.mocked(getRenderPage).mockClear()
    let releaseFirst!: () => void
    bundle = makeBundle((html) =>
      html.includes(IDLE_MARKER) ? Promise.resolve() : new Promise<void>((r) => (releaseFirst = r))
    )
    const oldBundle = bundle
    const first = renderComposed({ ...ARGS, viewport: 'desktop', deadlineMs: 5_000 })
    const caught = await catchErr(renderComposed({ ...ARGS, viewport: 'desktop', deadlineMs: 150 }))
    expect(caught).toBeInstanceOf(FakeRenderTimeoutError)
    expect((caught as Error).message).toContain('"queue"')
    expect(recycleMock).not.toHaveBeenCalled()

    // Swap the bundle BEFORE the first render releases the lock: if the
    // abandoned waiter (next in FIFO order) went on to render, it would call
    // getRenderPage() and drive THIS new bundle's page.
    bundle = makeBundle()
    releaseFirst()
    await expect(first).resolves.toMatchObject({ shots: [{ kind: 'fold' }] })
    await new Promise((r) => setTimeout(r, 20)) // let the abandoned waiter take (and pass on) its turn
    expect(vi.mocked(getRenderPage)).toHaveBeenCalledTimes(1) // the first render's only
    expect(bundle.page.setContent).not.toHaveBeenCalled()
    expect(oldBundle.page.setContent).toHaveBeenCalledTimes(2) // first's content + idle reset only

    // And the queue isn't blocked: a third render runs normally.
    await expect(renderComposed({ ...ARGS, viewport: 'desktop', deadlineMs: 2_000 })).resolves.toBeTruthy()
    expect(vi.mocked(getRenderPage)).toHaveBeenCalledTimes(2)
    expect(bundle.page.setContent).toHaveBeenCalledTimes(2)
  }, 10_000)

  it('a render that acquires the lock with < 10s of budget left fails fast as "queue", never touches or recycles the bundle', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      vi.mocked(getRenderPage).mockClear()
      let releaseFirst!: () => void
      bundle = makeBundle((html) =>
        html.includes(IDLE_MARKER) ? Promise.resolve() : new Promise<void>((r) => (releaseFirst = r))
      )
      const first = renderComposed({ ...ARGS, viewport: 'desktop' }) // default 45s deadline
      const second = catchErr(renderComposed({ ...ARGS, viewport: 'desktop' })) // default 45s deadline
      await vi.advanceTimersByTimeAsync(36_000)
      releaseFirst() // second acquires with ~9s of its 45s left
      await vi.advanceTimersByTimeAsync(10)
      await expect(first).resolves.toMatchObject({ shots: [{ kind: 'fold' }] })

      const caught = await second
      expect(caught).toBeInstanceOf(FakeRenderTimeoutError)
      expect((caught as Error).message).toContain('"queue"')
      expect(vi.mocked(getRenderPage)).toHaveBeenCalledTimes(1) // only the first render's
      expect(recycleMock).not.toHaveBeenCalled()
      expect(recycleIfStillMock).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
    // The lock was released: the next render proceeds normally.
    bundle = makeBundle()
    await expect(renderComposed({ ...ARGS, viewport: 'desktop' })).resolves.toMatchObject({ shots: [{ kind: 'fold' }] })
    expect(recycleMock).not.toHaveBeenCalled()
  }, 10_000)

  it('a timed-out render releases the lock so the next render runs', async () => {
    bundle = makeBundle(() => new Promise(() => {}))
    await catchErr(renderComposed({ ...ARGS, viewport: 'desktop', deadlineMs: 150 }))
    bundle = makeBundle()
    await expect(renderComposed({ ...ARGS, viewport: 'desktop', deadlineMs: 2_000 })).resolves.toBeTruthy()
  }, 10_000)
})
