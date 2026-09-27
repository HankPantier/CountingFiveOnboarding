import { describe, expect, it, vi } from 'vitest'
import { SHELL_RETRY_DELAY_MS, fetchShellWithRetry, shouldRetryShell, type ShellFetchResult } from './shell-fetch'

const OK: ShellFetchResult = { ok: true, shellHtml: '<html></html>' }
const NOT_REVALTUS: ShellFetchResult = {
  ok: false,
  status: 422,
  code: 'not_revaltus',
  error: "https://www.acmecpa.com isn't the Revaltus-built site (it may be the client's old site before DNS cutover). Set the preview URL to the site's Vercel address, e.g. https://<project>.vercel.app.",
}
const UNREACHABLE: ShellFetchResult = { ok: false, status: 502, error: 'Could not reach the live site (blocked or unreachable).' }

describe('fetchShellWithRetry', () => {
  it('retries a 422 not_revaltus once after ~3 s when the URL is not an override, and returns the retry', async () => {
    const fetchShell = vi.fn<() => Promise<ShellFetchResult>>().mockResolvedValueOnce(NOT_REVALTUS).mockResolvedValueOnce(OK)
    const sleep = vi.fn(async (_ms: number) => {})
    expect(await fetchShellWithRetry(fetchShell, 'siteUrl', sleep)).toEqual({ result: OK, retried: true })
    expect(sleep).toHaveBeenCalledWith(SHELL_RETRY_DELAY_MS)
    expect(SHELL_RETRY_DELAY_MS).toBe(3000)
    expect(fetchShell).toHaveBeenCalledTimes(2)
  })

  it('retries only once: a second 422 is returned as is', async () => {
    const fetchShell = vi.fn<() => Promise<ShellFetchResult>>().mockResolvedValue(NOT_REVALTUS)
    expect(await fetchShellWithRetry(fetchShell, 'vercel', async () => {})).toEqual({ result: NOT_REVALTUS, retried: true })
    expect(fetchShell).toHaveBeenCalledTimes(2)
  })

  it("does not retry an operator override's 422 — that URL really isn't the Revaltus site", async () => {
    const fetchShell = vi.fn<() => Promise<ShellFetchResult>>().mockResolvedValue(NOT_REVALTUS)
    const sleep = vi.fn(async (_ms: number) => {})
    expect(await fetchShellWithRetry(fetchShell, 'override', sleep)).toEqual({ result: NOT_REVALTUS, retried: false })
    expect(sleep).not.toHaveBeenCalled()
    expect(fetchShell).toHaveBeenCalledTimes(1)
  })

  it('does not retry success or other errors', async () => {
    expect(shouldRetryShell(OK, 'siteUrl')).toBe(false)
    expect(shouldRetryShell(UNREACHABLE, 'siteUrl')).toBe(false)
    expect(shouldRetryShell({ ok: false, status: 422, error: 'https only' }, 'siteUrl')).toBe(false)
    expect(shouldRetryShell(NOT_REVALTUS, undefined)).toBe(true)
  })
})
