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

let browserPromise: Promise<Browser> | null = null

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
  if (browserPromise) {
    const existing = await browserPromise.catch(() => null)
    if (existing?.isConnected()) return existing
  }
  browserPromise = launch()
  try {
    return await browserPromise
  } catch (err) {
    browserPromise = null
    throw err
  }
}

// Test-only: close the shared browser so vitest can exit cleanly.
export async function closeBrowserForTests(): Promise<void> {
  const b = browserPromise ? await browserPromise.catch(() => null) : null
  browserPromise = null
  await b?.close()
}
