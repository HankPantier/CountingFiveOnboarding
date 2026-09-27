// Client-safe. Theme Studio's fetch of the preview shell, with one delayed
// retry for the case the first open after a cold Vercel-address lookup hits:
// the lookup timed out, so that request fell back to site.config siteUrl (the
// client's OLD site before cutover) and the shell route answered 422
// not_revaltus — while the lookup kept running and cached the Vercel address
// in the background. One retry ~3 s later picks the cached address up instead
// of showing a misleading "isn't the Revaltus-built site" message. An operator
// override is the operator's choice: its 422 is real and is not retried.

export const SHELL_RETRY_DELAY_MS = 3_000

export type ShellFetchResult =
  | { ok: true; shellHtml: string }
  | { ok: false; status: number; error: string; code?: string }

export type PreviewSource = 'override' | 'vercel' | 'siteUrl'

export const shouldRetryShell = (r: ShellFetchResult, source: PreviewSource | undefined): boolean =>
  !r.ok && r.status === 422 && r.code === 'not_revaltus' && source !== 'override'

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function fetchShellWithRetry(
  fetchShell: () => Promise<ShellFetchResult>,
  source: PreviewSource | undefined,
  sleep: (ms: number) => Promise<void> = defaultSleep
): Promise<{ result: ShellFetchResult; retried: boolean }> {
  const first = await fetchShell()
  if (!shouldRetryShell(first, source)) return { result: first, retried: false }
  await sleep(SHELL_RETRY_DELAY_MS)
  return { result: await fetchShell(), retried: true }
}
