// Deadline/recycle behavior for renderComposed(), fully mocked — no real
// Chromium needed. Separate file from render-composed.test.ts because this
// one mocks './browser' entirely (a fake page whose setContent() never
// resolves), which would otherwise clash with that file's real-Chromium
// integration tests sharing the same module registry.
import { describe, it, expect, vi } from 'vitest'

const { recycleMock, FakeRenderTimeoutError } = vi.hoisted(() => {
  class FakeRenderTimeoutError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'RenderTimeoutError'
    }
  }
  return { recycleMock: vi.fn(async () => undefined), FakeRenderTimeoutError }
})

function fakePage() {
  return {
    setDefaultTimeout: vi.fn(),
    on: vi.fn(),
    // Never resolves — this is the wedged step the deadline race must catch.
    setContent: vi.fn(() => new Promise(() => {})),
    waitForLoadState: vi.fn(async () => undefined),
    evaluate: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47])),
    locator: vi.fn(() => ({ first: () => ({ count: async () => 0 }) })),
  }
}

function fakeContext() {
  const page = fakePage()
  return {
    route: vi.fn(async () => undefined),
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => undefined),
  }
}

function fakeBrowser() {
  return {
    isConnected: vi.fn(() => true),
    newContext: vi.fn(async () => fakeContext()),
  }
}

vi.mock('./browser', () => ({
  getBrowser: vi.fn(async () => fakeBrowser()),
  recycleBrowser: recycleMock,
  RenderTimeoutError: FakeRenderTimeoutError,
}))

import { renderComposed } from './render-composed'

describe('renderComposed deadline (mocked browser, no real Chromium)', () => {
  it('throws RenderTimeoutError within ~deadlineMs when a step hangs, and recycles the browser', async () => {
    recycleMock.mockClear()
    const t0 = Date.now()

    let caught: unknown
    try {
      await renderComposed({
        html: '<html><head></head><body>x</body></html>',
        shellOrigin: 'https://example.invalid/',
        viewport: 'desktop',
        deadlineMs: 200,
      })
    } catch (err) {
      caught = err
    }
    const elapsed = Date.now() - t0

    expect(caught).toBeInstanceOf(FakeRenderTimeoutError)
    expect((caught as Error).name).toBe('RenderTimeoutError')
    expect((caught as Error).message).toMatch(/timed out/i)
    // Comfortably under the 45s default deadline — proves the SHORT
    // deadlineMs actually governs, not the fallback.
    expect(elapsed).toBeLessThan(5_000)
    expect(recycleMock).toHaveBeenCalledTimes(1)
  }, 10_000)
})
