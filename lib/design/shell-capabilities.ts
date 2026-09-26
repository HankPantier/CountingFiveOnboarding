// Server-only (safeGet). The DEPLOYED shell's half of the capability
// handshake: the template's root layout emits
// <meta name="c5-capabilities" content="fonts,style-axes,specimen"> (T1+).
// Absent meta on a reachable page = a template that predates T1 → []. An
// unreachable page is 'unverified' (callers keep the draft tier — see
// intersectWithShell). Verified reads are cached per job + repo for 60 s;
// failures (incl. the overall SHELL_READ_DEADLINE_MS timeout) are never cached. Never throws: the fetch goes through the same
// SSRF-guarded, timeout-bounded safeGet the preview shell uses.
import { safeGet } from '@/lib/audit/crawl'
import { getPreviewSiteUrl } from '@/lib/theme-preview/site-url'

export const SHELL_CAPABILITIES_META = 'c5-capabilities'
export type ShellCapabilities = { status: 'verified'; capabilities: string[] } | { status: 'unverified' }

const TOKEN_RE = /^[a-z0-9][a-z0-9-]{0,39}$/
const MAX_TOKENS = 20
const MAX_SCAN = 200_000
const TTL_MS = 60_000
const CACHE_MAX = 200
const cache = new Map<string, { at: number; value: ShellCapabilities }>()

export function __resetShellCapabilitiesCacheForTests(): void {
  cache.clear()
}

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag)
  return m ? m[2] : null
}

export function parseShellCapabilities(html: string): string[] {
  for (const match of html.slice(0, MAX_SCAN).matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0]
    if (attr(tag, 'name')?.trim().toLowerCase() !== SHELL_CAPABILITIES_META) continue
    const tokens = (attr(tag, 'content') ?? '')
      .split(/[\s,]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => TOKEN_RE.test(s))
    return [...new Set(tokens)].slice(0, MAX_TOKENS)
  }
  return []
}

// Overall wall-clock budget for one shell read (preview-URL lookup + fetch).
// safeGet alone can take ~6 hops × 10 s; callers run inside 30–60 s routes
// and the chat commit reserve, so a slow site degrades to 'unverified' fast.
export const SHELL_READ_DEADLINE_MS = 6_000
const UNVERIFIED: ShellCapabilities = { status: 'unverified' }

async function fetchShell(args: { jobId: string; githubRepo: string }): Promise<ShellCapabilities> {
  let siteUrl: string | null
  try {
    siteUrl = await getPreviewSiteUrl(args)
  } catch {
    return UNVERIFIED
  }
  if (!siteUrl) return UNVERIFIED
  const res = await safeGet(siteUrl).catch(() => null)
  // Only a final 2xx HTML page verifies; a final 3xx means safeGet gave up on
  // the redirect chain, so we never saw the shell.
  const html =
    res !== null &&
    res.status >= 200 &&
    res.status < 300 &&
    (!res.contentType || res.contentType.toLowerCase().includes('html'))
  if (!res || !html) return UNVERIFIED
  return { status: 'verified', capabilities: parseShellCapabilities(res.body) }
}

// Cached per job + repo (checked BEFORE resolving the preview URL, so a cache
// hit costs no DB or GitHub read).
export async function readShellCapabilities(
  args: { jobId: string; githubRepo: string },
  now: number = Date.now()
): Promise<ShellCapabilities> {
  const key = `${args.jobId}\u0000${args.githubRepo}`
  const hit = cache.get(key)
  if (hit && now - hit.at < TTL_MS) return hit.value

  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<ShellCapabilities>((resolve) => {
    timer = setTimeout(() => resolve(UNVERIFIED), SHELL_READ_DEADLINE_MS)
  })
  let value: ShellCapabilities
  try {
    value = await Promise.race([fetchShell(args).catch(() => UNVERIFIED), deadline])
  } finally {
    clearTimeout(timer)
  }
  if (value.status !== 'verified') return value
  if (cache.size >= CACHE_MAX) cache.clear()
  cache.set(key, { at: now, value })
  return value
}
